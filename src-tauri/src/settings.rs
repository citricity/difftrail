//! User preferences, stored as JSON in the OS configuration directory.
//!
//! Reading and writing are split from the Tauri commands so the behaviour that
//! actually matters — defaults, clamping, and what a damaged file does — is
//! testable without a running app.
//!
//! Nothing here is allowed to stop Diff Trek starting. A missing file, an
//! unreadable one, or one holding nonsense all resolve to the defaults, because
//! a preference is never worth an error screen in front of the diff.

use crate::error::{AppError, AppResult, ErrorKind};
use serde::{Deserialize, Deserializer, Serialize};
use std::path::{Path, PathBuf};

/// Where wrapping is allowed to land, in characters.
///
/// The frontend turns this number into row heights by plain arithmetic, so a
/// zero or a negative would not merely look wrong — it would divide the row
/// model by zero. Clamping here means the frontend can trust what it is given.
const MIN_WRAP_LENGTH: u32 = 40;
const MAX_WRAP_LENGTH: u32 = 1000;
const DEFAULT_WRAP_LENGTH: u32 = 120;

const FILE_NAME: &str = "settings.json";

/// How a file's diff is laid out.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    /// One column, deletions and additions interleaved.
    #[default]
    Unified,
    /// Two panes, the original on the left and the working copy on the right.
    Split,
}

/// Reads a view mode without letting an unrecognised one poison the file.
///
/// A plain derive would make `"viewMode": "sideBySide"` — a value from some
/// future version, or a typo — fail the whole document, taking the wrap
/// settings down with it. One unknown field is not worth forgetting everything
/// else the user chose.
fn lenient_view_mode<'de, D: Deserializer<'de>>(de: D) -> Result<ViewMode, D::Error> {
    let raw = serde_json::Value::deserialize(de)?;
    Ok(match raw.as_str() {
        Some("split") => ViewMode::Split,
        _ => ViewMode::default(),
    })
}

/// Whether and where long lines wrap.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WrapMode {
    /// Long lines scroll horizontally.
    #[default]
    Off,
    /// Long lines wrap at `wrap_length`.
    Column,
    /// Long lines wrap at the edge of the viewport. The frontend works the
    /// column out from the window width; nothing about it is stored.
    Auto,
}

/// Reads a wrap mode, accepting the boolean earlier versions wrote.
///
/// `"wrap": true` meant a fixed column — there was no other kind — so it reads
/// as `Column`, and a settings file from before `auto` existed keeps doing what
/// it did. Anything unrecognised is `Off`, for the same reason as
/// `lenient_view_mode`: one odd field must not discard the rest of the file.
fn lenient_wrap_mode<'de, D: Deserializer<'de>>(de: D) -> Result<WrapMode, D::Error> {
    let raw = serde_json::Value::deserialize(de)?;
    Ok(match raw {
        serde_json::Value::Bool(true) => WrapMode::Column,
        serde_json::Value::String(value) => match value.as_str() {
            "column" => WrapMode::Column,
            "auto" => WrapMode::Auto,
            _ => WrapMode::Off,
        },
        _ => WrapMode::Off,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Whether long lines wrap rather than scrolling horizontally, and where.
    #[serde(default, deserialize_with = "lenient_wrap_mode")]
    pub wrap: WrapMode,
    /// The column `WrapMode::Column` wraps at. Kept independently of `wrap`, so
    /// switching to another mode and back does not forget the chosen width.
    pub wrap_length: u32,
    /// The layout a window opens with. The toolbar switches the view for the
    /// session without disturbing this, so the two are deliberately distinct:
    /// this is the starting point, not the current state.
    #[serde(default, deserialize_with = "lenient_view_mode")]
    pub default_view_mode: ViewMode,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            wrap: WrapMode::Off,
            wrap_length: DEFAULT_WRAP_LENGTH,
            default_view_mode: ViewMode::Unified,
        }
    }
}

impl Settings {
    /// Brings a value from disk or from the frontend into range.
    pub fn sanitised(self) -> Self {
        Self {
            wrap: self.wrap,
            wrap_length: self.wrap_length.clamp(MIN_WRAP_LENGTH, MAX_WRAP_LENGTH),
            default_view_mode: self.default_view_mode,
        }
    }
}

pub fn file_path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_NAME)
}

/// Reads the settings file, falling back to defaults for anything unusable.
pub fn load_from(path: &Path) -> Settings {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return Settings::default();
    };

    match serde_json::from_str::<Settings>(&contents) {
        Ok(settings) => settings.sanitised(),
        Err(err) => {
            // Worth saying out loud — the next save overwrites it — but not
            // worth refusing to start over.
            eprintln!("[difftrek] ignoring unreadable {}: {err}", path.display());
            Settings::default()
        }
    }
}

/// Writes the settings file, creating its directory if need be.
///
/// Written to a temporary file and renamed, so an interrupted write leaves the
/// previous settings intact rather than a half-written file that the next load
/// would discard.
pub fn save_to(path: &Path, settings: Settings) -> AppResult<()> {
    let settings = settings.sanitised();

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| write_error(path, err))?;
    }

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|err| AppError::new(ErrorKind::SettingsFailed, "Could not encode settings.")
            .with_detail(err.to_string()))?;

    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, format!("{json}\n")).map_err(|err| write_error(path, err))?;
    std::fs::rename(&temporary, path).map_err(|err| write_error(path, err))?;

    Ok(())
}

fn write_error(path: &Path, err: std::io::Error) -> AppError {
    AppError::new(
        ErrorKind::SettingsFailed,
        "Diff Trek could not save your settings.",
    )
    .with_detail(format!("{}: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("difftrek-settings-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn wrapping_is_off_by_default_but_remembers_a_length() {
        let settings = Settings::default();
        assert_eq!(settings.wrap, WrapMode::Off);
        assert_eq!(settings.wrap_length, 120);
        assert_eq!(settings.default_view_mode, ViewMode::Unified);
    }

    #[test]
    fn the_view_mode_round_trips() {
        let path = temp_dir("viewmode").join("settings.json");
        let settings = Settings {
            default_view_mode: ViewMode::Split,
            ..Settings::default()
        };

        save_to(&path, settings).unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("\"split\""));
        assert_eq!(load_from(&path), settings);
    }

    #[test]
    fn an_unknown_view_mode_costs_only_itself() {
        // The rest of the file has to survive it, or a value from a future
        // version would silently reset everything the user chose.
        let path = temp_dir("unknown-viewmode").join("settings.json");
        std::fs::write(
            &path,
            r#"{"wrap": true, "wrapLength": 90, "defaultViewMode": "sideBySide"}"#,
        )
        .unwrap();

        let settings = load_from(&path);
        assert_eq!(settings.wrap, WrapMode::Column);
        assert_eq!(settings.wrap_length, 90);
        assert_eq!(settings.default_view_mode, ViewMode::Unified);
    }

    #[test]
    fn auto_wrapping_round_trips_as_a_string() {
        let path = temp_dir("auto").join("settings.json");
        let settings = Settings {
            wrap: WrapMode::Auto,
            ..Settings::default()
        };

        save_to(&path, settings).unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("\"auto\""));
        assert_eq!(load_from(&path), settings);
    }

    #[test]
    fn the_boolean_an_earlier_version_wrote_still_reads() {
        // `true` was the only kind of wrapping there was: a fixed column.
        let path = temp_dir("legacy-wrap").join("settings.json");

        std::fs::write(&path, r#"{"wrap": true, "wrapLength": 90}"#).unwrap();
        let settings = load_from(&path);
        assert_eq!(settings.wrap, WrapMode::Column);
        assert_eq!(settings.wrap_length, 90);

        std::fs::write(&path, r#"{"wrap": false, "wrapLength": 90}"#).unwrap();
        assert_eq!(load_from(&path).wrap, WrapMode::Off);
    }

    #[test]
    fn an_unknown_wrap_mode_costs_only_itself() {
        let path = temp_dir("unknown-wrap").join("settings.json");
        std::fs::write(
            &path,
            r#"{"wrap": "soft", "wrapLength": 90, "defaultViewMode": "split"}"#,
        )
        .unwrap();

        let settings = load_from(&path);
        assert_eq!(settings.wrap, WrapMode::Off);
        assert_eq!(settings.wrap_length, 90);
        assert_eq!(settings.default_view_mode, ViewMode::Split);
    }

    #[test]
    fn a_missing_file_reads_as_defaults() {
        let path = temp_dir("missing").join("settings.json");
        assert_eq!(load_from(&path), Settings::default());
    }

    #[test]
    fn a_damaged_file_reads_as_defaults_rather_than_failing() {
        let path = temp_dir("damaged").join("settings.json");
        std::fs::write(&path, "{ not json at all").unwrap();
        assert_eq!(load_from(&path), Settings::default());
    }

    #[test]
    fn a_partial_file_keeps_the_defaults_for_what_it_omits() {
        let path = temp_dir("partial").join("settings.json");
        std::fs::write(&path, r#"{"wrap": true}"#).unwrap();

        let settings = load_from(&path);
        assert_eq!(settings.wrap, WrapMode::Column);
        assert_eq!(settings.wrap_length, 120);
    }

    #[test]
    fn an_out_of_range_length_is_clamped_on_the_way_in_and_out() {
        let path = temp_dir("clamp").join("settings.json");

        std::fs::write(&path, r#"{"wrap": true, "wrapLength": 0}"#).unwrap();
        assert_eq!(load_from(&path).wrap_length, 40);

        save_to(
            &path,
            Settings {
                wrap: WrapMode::Column,
                wrap_length: 100_000,
                ..Settings::default()
            },
        )
        .unwrap();
        assert_eq!(load_from(&path).wrap_length, 1000);
    }

    #[test]
    fn saving_then_loading_round_trips() {
        let path = temp_dir("roundtrip").join("settings.json");
        let settings = Settings {
            wrap: WrapMode::Column,
            wrap_length: 100,
            ..Settings::default()
        };

        save_to(&path, settings).unwrap();
        assert_eq!(load_from(&path), settings);
    }

    #[test]
    fn saving_creates_the_directory_it_needs() {
        let path = temp_dir("nested").join("deeper").join("settings.json");
        save_to(&path, Settings::default()).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn saving_leaves_no_temporary_file_behind() {
        let path = temp_dir("tidy").join("settings.json");
        save_to(&path, Settings::default()).unwrap();
        assert!(!path.with_extension("json.tmp").exists());
    }
}
