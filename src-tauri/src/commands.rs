//! The Tauri command surface.
//!
//! This is the entire frontend/backend boundary. Commands stay thin: resolve
//! state, call into `git`, return domain types. No presentation logic here,
//! and no Git logic in the frontend.

use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::model::{ChangedFile, FileDiff, RepositoryInfo};
use crate::git::repository::{self, Side, DEFAULT_MAX_DIFF_BYTES};
use crate::launch::resolve_launch_directory;
use crate::state::AppState;
use tauri::State;

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
