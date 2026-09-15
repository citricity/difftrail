//! User preferences, stored as JSON in the OS configuration directory.
//!
//! Reading and writing are split from the Tauri commands so the behaviour that
//! actually matters — defaults, clamping, and what a damaged file does — is
//! testable without a running app.
//!
//! Nothing here is allowed to stop Diff Trail starting. A missing file, an
//! unreadable one, or one holding nonsense all resolve to the defaults, because
//! a preference is never worth an error screen in front of the diff.

use crate::error::{AppError, AppResult, ErrorKind};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Whether long lines wrap rather than scrolling horizontally.
    pub wrap: bool,
    /// The column they wrap at. Kept independently of `wrap`, so turning
    /// wrapping off and on again does not forget the chosen width.
    pub wrap_length: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            wrap: false,
            wrap_length: DEFAULT_WRAP_LENGTH,
        }
    }
}

impl Settings {
    /// Brings a value from disk or from the frontend into range.
    pub fn sanitised(self) -> Self {
        Self {
            wrap: self.wrap,
            wrap_length: self.wrap_length.clamp(MIN_WRAP_LENGTH, MAX_WRAP_LENGTH),
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
            eprintln!("[difftrail] ignoring unreadable {}: {err}", path.display());
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
        "Diff Trail could not save your settings.",
    )
    .with_detail(format!("{}: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("difftrail-settings-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn wrapping_is_off_by_default_but_remembers_a_length() {
        let settings = Settings::default();
        assert!(!settings.wrap);
        assert_eq!(settings.wrap_length, 120);
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
        assert!(settings.wrap);
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
                wrap: true,
                wrap_length: 100_000,
            },
        )
        .unwrap();
        assert_eq!(load_from(&path).wrap_length, 1000);
    }

    #[test]
    fn saving_then_loading_round_trips() {
        let path = temp_dir("roundtrip").join("settings.json");
        let settings = Settings {
            wrap: true,
            wrap_length: 100,
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
