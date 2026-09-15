//! Application-level errors.
//!
//! Git failures are classified here rather than leaking raw stderr to the UI:
//! the frontend switches on `kind`, shows `message`, and logs `detail`.

use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// The launch directory is not inside a Git working tree.
    NotARepository,
    /// `git` could not be executed at all.
    GitUnavailable,
    /// The repository has no commits, so there is no HEAD to compare against.
    EmptyRepository,
    /// The requested path is not part of the current diff.
    FileNotFound,
    /// The file changed but its contents are not text.
    BinaryFile,
    PermissionDenied,
    /// Git ran but produced output we could not make sense of.
    InvalidDiff,
    /// Git ran and failed for a reason we do not specifically recognise.
    GitCommandFailed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub kind: ErrorKind,
    /// Short, user-facing. One sentence, no stack traces.
    pub message: String,
    /// Diagnostic detail for the console. May be long.
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn not_a_repository() -> Self {
        Self::new(
            ErrorKind::NotARepository,
            "This directory is not inside a Git repository.",
        )
    }

    pub fn file_not_found(path: &str) -> Self {
        Self::new(
            ErrorKind::FileNotFound,
            format!("{path} is no longer part of the working tree diff."),
        )
    }

    /// Classifies a failed `git` invocation from its stderr.
    pub fn from_git_stderr(stderr: &str) -> Self {
        let lower = stderr.to_lowercase();

        let kind = if lower.contains("not a git repository") {
            ErrorKind::NotARepository
        } else if lower.contains("permission denied") {
            ErrorKind::PermissionDenied
        } else if lower.contains("does not have any commits yet")
            || lower.contains("unknown revision")
        {
            ErrorKind::EmptyRepository
        } else {
            ErrorKind::GitCommandFailed
        };

        let message = match kind {
            ErrorKind::NotARepository => "This directory is not inside a Git repository.",
            ErrorKind::PermissionDenied => "Diff Trail does not have permission to read this file.",
            ErrorKind::EmptyRepository => "This repository has no commits yet.",
            _ => "Git reported an error.",
        };

        Self::new(kind, message).with_detail(stderr.trim())
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_missing_repository() {
        let error = AppError::from_git_stderr("fatal: not a git repository (or any parent)");
        assert_eq!(error.kind, ErrorKind::NotARepository);
        assert!(error.detail.is_some());
    }

    #[test]
    fn classifies_permission_denied() {
        let error = AppError::from_git_stderr("error: open('x'): Permission denied");
        assert_eq!(error.kind, ErrorKind::PermissionDenied);
    }

    #[test]
    fn classifies_repository_without_commits() {
        let error =
            AppError::from_git_stderr("fatal: your current branch 'main' does not have any commits yet");
        assert_eq!(error.kind, ErrorKind::EmptyRepository);
    }

    #[test]
    fn falls_back_to_generic_failure() {
        let error = AppError::from_git_stderr("fatal: something unexpected");
        assert_eq!(error.kind, ErrorKind::GitCommandFailed);
        assert_eq!(error.message, "Git reported an error.");
    }
}
