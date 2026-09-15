//! Domain types shared between the Git layer and the Tauri command layer.
//!
//! These types are serialised straight to the frontend, so the wire shape is
//! part of Diff Trail's public contract. Keep `rename_all = "camelCase"` in
//! sync with `src/types/diff.ts`.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
}

impl FileStatus {
    /// Parses the single-letter status produced by `git diff --name-status`.
    /// Similarity scores (`R100`, `C75`) are stripped by the caller.
    pub fn from_code(code: char) -> Option<Self> {
        match code {
            'M' => Some(Self::Modified),
            'A' => Some(Self::Added),
            'D' => Some(Self::Deleted),
            'R' => Some(Self::Renamed),
            'C' => Some(Self::Copied),
            'T' => Some(Self::TypeChanged),
            _ => None,
        }
    }

    /// `R` and `C` records carry both an old and a new path.
    pub fn has_old_path(self) -> bool {
        matches!(self, Self::Renamed | Self::Copied)
    }
}

/// Lightweight metadata for one changed file.
///
/// Deliberately cheap to produce: the whole list is returned before any diff
/// body is read, so the UI can render the document skeleton immediately.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    /// Stable logical id. Equal to `path`, which is unique within one diff.
    pub id: String,
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    /// `None` for binary files, where Git reports `-` instead of a count.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub binary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LineKind {
    Context,
    Add,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
    pub content: String,
    /// True when Git emitted `\ No newline at end of file` after this line.
    pub no_newline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    /// `<path>:hunk:<index>` — stable for the lifetime of one diff snapshot.
    pub id: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// The function/section context Git appends after the `@@` marker.
    pub heading: Option<String>,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub id: String,
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub binary: bool,
    /// Set when the diff exceeded the caller's byte budget. `hunks` is then
    /// empty and the UI offers to load it explicitly.
    pub truncated: bool,
    pub additions: u32,
    pub deletions: u32,
    /// Longest rendered line in the diff, in characters. The frontend uses
    /// this to size the horizontal scroll area without measuring the DOM.
    pub max_line_length: u32,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    /// Absolute path to the repository working tree root.
    pub root: String,
    /// Directory name of the root, for display.
    pub name: String,
    /// Branch name, or `None` when HEAD is detached.
    pub branch: Option<String>,
    /// Abbreviated HEAD commit, or `None` in a repository with no commits.
    pub head: Option<String>,
    pub detached: bool,
}
