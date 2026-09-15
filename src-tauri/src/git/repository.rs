//! Repository discovery and the working-tree diff.
//!
//! Git semantics, stated once: Diff Trail shows **unstaged changes to tracked
//! files**, which is exactly what a bare `git diff` reports — the index
//! compared against the working tree. Changes that have been staged are
//! therefore excluded, and untracked files never appear (v2 feature).
//! This matches `git difftool --dir-diff --no-symlinks`, which is where the
//! design started, without needing its temporary directories.

use super::command::{literal_pathspec, run};
use super::model::{ChangedFile, FileDiff, RepositoryInfo};
use super::parse::{merge_changed_files, parse_file_diff, parse_name_status, parse_numstat};
use crate::error::{AppError, AppResult, ErrorKind};
use std::path::{Path, PathBuf};

/// Number of unchanged lines shown around each change.
const CONTEXT_LINES: u32 = 3;

/// Diffs larger than this are reported as `truncated` instead of parsed, so a
/// single enormous file cannot stall the UI. The user can request it anyway.
pub const DEFAULT_MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;

/// Finds the working tree root containing `start`.
pub fn discover(start: &Path) -> AppResult<PathBuf> {
    if !start.exists() {
        return Err(AppError::not_a_repository()
            .with_detail(format!("{} does not exist", start.display())));
    }

    let output = run(start, &["rev-parse", "--show-toplevel"])?;
    let root = output.text().trim().to_string();

    if root.is_empty() {
        return Err(AppError::not_a_repository());
    }

    Ok(PathBuf::from(root))
}

/// Reads branch, HEAD and display name for the repository header.
///
/// A repository with no commits is not an error here: the header still renders,
/// and the (empty) changed-file list follows.
pub fn info(root: &Path) -> AppResult<RepositoryInfo> {
    let branch = run(root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|output| output.text().trim().to_string())
        .filter(|branch| !branch.is_empty());

    let detached = branch.as_deref() == Some("HEAD");

    let head = run(root, &["rev-parse", "--short", "HEAD"])
        .ok()
        .map(|output| output.text().trim().to_string())
        .filter(|head| !head.is_empty());

    let name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());

    Ok(RepositoryInfo {
        root: root.to_string_lossy().into_owned(),
        name,
        branch: if detached { None } else { branch },
        head,
        detached,
    })
}

/// Lists every tracked file with unstaged modifications.
///
/// Two cheap Git calls, no diff bodies — this is what lets the document
/// skeleton render before any content has been read.
pub fn changed_files(root: &Path) -> AppResult<Vec<ChangedFile>> {
    let name_status = run(root, &["diff", "--name-status", "-z", "--find-renames"])?;
    let numstat = run(root, &["diff", "--numstat", "-z", "--find-renames"])?;

    Ok(merge_changed_files(
        parse_name_status(&name_status.text()),
        parse_numstat(&numstat.text()),
    ))
}

/// Loads and parses the diff for one file.
///
/// `meta` must come from [`changed_files`]; it carries the status and rename
/// information that the diff body alone does not reliably provide.
pub fn file_diff(root: &Path, meta: &ChangedFile, max_bytes: usize) -> AppResult<FileDiff> {
    if meta.binary {
        return Ok(FileDiff {
            id: meta.id.clone(),
            path: meta.path.clone(),
            old_path: meta.old_path.clone(),
            status: meta.status,
            binary: true,
            truncated: false,
            additions: 0,
            deletions: 0,
            max_line_length: 0,
            hunks: Vec::new(),
        });
    }

    let context = format!("--unified={CONTEXT_LINES}");
    let pathspec = literal_pathspec(&meta.path);

    let mut args = vec![
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--find-renames",
        &context,
        "--",
        &pathspec,
    ];

    // For a rename, Git needs both sides named or it reports nothing.
    let old_pathspec;
    if let Some(old_path) = &meta.old_path {
        old_pathspec = literal_pathspec(old_path);
        args.push(&old_pathspec);
    }

    let output = run(root, &args)?;

    if output.stdout.len() > max_bytes {
        return Ok(FileDiff {
            id: meta.id.clone(),
            path: meta.path.clone(),
            old_path: meta.old_path.clone(),
            status: meta.status,
            binary: false,
            truncated: true,
            additions: meta.additions.unwrap_or(0),
            deletions: meta.deletions.unwrap_or(0),
            max_line_length: 0,
            hunks: Vec::new(),
        });
    }

    Ok(parse_file_diff(meta, &output.text()))
}

/// Which side of the comparison to read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    /// The staged/committed version — the left-hand side of the diff.
    Original,
    /// The file as it exists on disk right now.
    Working,
}

impl Side {
    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "original" => Ok(Self::Original),
            "working" => Ok(Self::Working),
            other => Err(AppError::new(
                ErrorKind::InvalidDiff,
                "Unknown file side requested.",
            )
            .with_detail(format!("side={other}"))),
        }
    }
}

/// Reads one whole side of a file, for expanding context beyond the hunks.
pub fn file_contents(root: &Path, path: &str, side: Side) -> AppResult<String> {
    match side {
        Side::Original => {
            // `:path` is the index version, which is the left side of `git diff`.
            let spec = format!(":{path}");
            let output = run(root, &["show", &spec])?;
            Ok(output.text())
        }
        Side::Working => {
            let full = root.join(path);
            std::fs::read(&full)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
                .map_err(|err| match err.kind() {
                    std::io::ErrorKind::NotFound => AppError::file_not_found(path),
                    std::io::ErrorKind::PermissionDenied => AppError::new(
                        ErrorKind::PermissionDenied,
                        format!("Diff Trail cannot read {path}."),
                    ),
                    _ => AppError::new(
                        ErrorKind::GitCommandFailed,
                        format!("Could not read {path}."),
                    )
                    .with_detail(err.to_string()),
                })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn side_parses_known_values() {
        assert_eq!(Side::parse("original").unwrap(), Side::Original);
        assert_eq!(Side::parse("working").unwrap(), Side::Working);
    }

    #[test]
    fn side_rejects_unknown_values() {
        let error = Side::parse("staged").unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidDiff);
    }

    #[test]
    fn discover_rejects_a_path_that_does_not_exist() {
        let error = discover(Path::new("/definitely/not/here/difftrail")).unwrap_err();
        assert_eq!(error.kind, ErrorKind::NotARepository);
    }
}
