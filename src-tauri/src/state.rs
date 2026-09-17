//! Process-wide state: which repository we opened, what it is being compared
//! across, and the changed-file list we last read from it.
//!
//! The file list is cached because every `get_file_diff` call needs the
//! metadata (status, rename pair, binary flag) for the path it was given, and
//! re-running `git diff --name-status` per file would be wasteful.

use crate::error::{AppError, AppResult};
use crate::git::model::ChangedFile;
use crate::git::revision::Comparison;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    root: Option<PathBuf>,
    comparison: Comparison,
    files: Vec<ChangedFile>,
}

impl AppState {
    /// Opens a repository, and what to compare in it. Always set together, so
    /// a root can never be paired with another repository's commits.
    pub fn set_root(&self, root: PathBuf, comparison: Comparison) {
        let mut inner = self.lock();
        inner.root = Some(root);
        inner.comparison = comparison;
        inner.files.clear();
    }

    pub fn comparison(&self) -> Comparison {
        self.lock().comparison.clone()
    }

    pub fn root(&self) -> AppResult<PathBuf> {
        self.lock()
            .root
            .clone()
            .ok_or_else(AppError::not_a_repository)
    }

    pub fn set_files(&self, files: Vec<ChangedFile>) {
        self.lock().files = files;
    }

    pub fn file(&self, path: &str) -> AppResult<ChangedFile> {
        self.lock()
            .files
            .iter()
            .find(|file| file.path == path)
            .cloned()
            .ok_or_else(|| AppError::file_not_found(path))
    }

    /// A poisoned lock means another command panicked. Recovering the guard is
    /// safe here: the cached data is plain values, not a half-updated
    /// invariant, and refusing every later command would be worse.
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|err| err.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::model::FileStatus;

    fn file(path: &str) -> ChangedFile {
        ChangedFile {
            id: path.to_string(),
            path: path.to_string(),
            old_path: None,
            status: FileStatus::Modified,
            additions: Some(1),
            deletions: Some(0),
            binary: false,
        }
    }

    #[test]
    fn root_is_required_before_use() {
        let state = AppState::default();
        assert!(state.root().is_err());

        state.set_root(PathBuf::from("/tmp/repo"), Comparison::WorkingTree);
        assert_eq!(state.root().unwrap(), PathBuf::from("/tmp/repo"));
    }

    #[test]
    fn looks_up_cached_metadata_by_path() {
        let state = AppState::default();
        state.set_files(vec![file("a.ts"), file("b.ts")]);

        assert_eq!(state.file("b.ts").unwrap().path, "b.ts");
        assert!(state.file("missing.ts").is_err());
    }

    #[test]
    fn changing_repository_clears_stale_file_list() {
        let state = AppState::default();
        state.set_files(vec![file("a.ts")]);
        state.set_root(PathBuf::from("/tmp/other"), Comparison::WorkingTree);

        assert!(state.file("a.ts").is_err());
    }
}
