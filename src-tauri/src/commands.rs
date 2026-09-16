//! The Tauri command surface.
//!
//! This is the entire frontend/backend boundary. Commands stay thin: resolve
//! state, call into `git`, return domain types. No presentation logic here,
//! and no Git logic in the frontend.

use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::model::{ChangedFile, FileDiff, RepositoryInfo};
use crate::git_alias::{self, AliasStatus, ConfigTarget};
use crate::git::repository::{self, Side, DEFAULT_MAX_DIFF_BYTES};
use crate::launch::{self, resolve_launch_directory, LaunchOptions};
use crate::settings::{self, Settings};
use crate::state::AppState;
use tauri::{Manager, Runtime, State};

/// Where `settings.json` lives, per the platform's own conventions.
fn settings_path<R: Runtime>(app: &tauri::AppHandle<R>) -> std::path::PathBuf {
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    settings::file_path(&config_dir)
}

/// Current preferences.
///
/// Infallible by design: a missing or damaged file reads as the defaults, so
/// the UI always has something to render and never blocks on this.
#[tauri::command]
pub fn get_settings<R: Runtime>(app: tauri::AppHandle<R>) -> Settings {
    settings::load_from(&settings_path(&app))
}

/// Stores preferences, returning what was actually stored.
///
/// The value comes back because it is clamped on the way in, and the UI should
/// show what it got rather than what it asked for.
#[tauri::command]
pub fn set_settings<R: Runtime>(
    app: tauri::AppHandle<R>,
    settings: Settings,
) -> AppResult<Settings> {
    let path = settings_path(&app);
    settings::save_to(&path, settings)?;
    Ok(settings.sanitised())
}

/// How the app was launched.
///
/// The frontend reads this once before anything else. Under `--example` it
/// serves its own sample diff and never calls the commands below, which is why
/// nothing here has to know about example mode.
#[tauri::command]
pub fn get_launch_options() -> LaunchOptions {
    launch::launch_options()
}

#[tauri::command]
pub fn get_repository_info(state: State<'_, AppState>) -> AppResult<RepositoryInfo> {
    let start = resolve_launch_directory();
    let root = repository::discover(&start)?;
    state.set_root(root.clone());
    repository::info(&root)
}

#[tauri::command]
pub fn get_changed_files(state: State<'_, AppState>) -> AppResult<Vec<ChangedFile>> {
    let root = state.root()?;
    let files = repository::changed_files(&root)?;
    state.set_files(files.clone());
    Ok(files)
}

/// Loads one file's diff.
///
/// `max_bytes` lets the UI re-request a diff it previously received as
/// `truncated`, without changing the default budget for everything else.
#[tauri::command]
pub fn get_file_diff(
    state: State<'_, AppState>,
    path: String,
    max_bytes: Option<usize>,
) -> AppResult<FileDiff> {
    let root = state.root()?;
    let meta = state.file(&path)?;
    repository::file_diff(&root, &meta, max_bytes.unwrap_or(DEFAULT_MAX_DIFF_BYTES))
}

#[tauri::command]
pub fn get_file_contents(
    state: State<'_, AppState>,
    path: String,
    side: String,
) -> AppResult<String> {
    let root = state.root()?;
    let meta = state.file(&path)?;

    if meta.binary {
        return Err(AppError::new(
            ErrorKind::BinaryFile,
            format!("{path} is a binary file."),
        ));
    }

    repository::file_contents(&root, &path, Side::parse(&side)?)
}

/// One side of a changed image, as raw bytes.
///
/// Returned as an `ipc::Response` so the bytes cross the boundary as a binary
/// body — the webview receives an `ArrayBuffer` — rather than as a JSON array
/// of numbers several times the size. The original side of a rename is read
/// from the path it had before.
#[tauri::command]
pub fn get_image_bytes(
    state: State<'_, AppState>,
    path: String,
    side: String,
) -> AppResult<tauri::ipc::Response> {
    let root = state.root()?;
    let meta = state.file(&path)?;
    let side = Side::parse(&side)?;

    let source = match side {
        Side::Original => meta.old_path.as_deref().unwrap_or(&meta.path),
        Side::Working => &meta.path,
    };

    repository::image_bytes(&root, source, side).map(tauri::ipc::Response::new)
}

/// What installing the `git dt` alias would do: the command, the executable it
/// would launch, and any alias already in its place. Read-only.
#[tauri::command]
pub fn get_git_alias_status() -> AppResult<AliasStatus> {
    git_alias::status(&git_alias::current_binary()?, &ConfigTarget::Global)
}

/// Installs the `git dt` alias in the user's global Git configuration,
/// pointing at this executable. Only ever called after the user confirms.
#[tauri::command]
pub fn install_git_alias() -> AppResult<AliasStatus> {
    git_alias::install(&git_alias::current_binary()?, &ConfigTarget::Global)
}
