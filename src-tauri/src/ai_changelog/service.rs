//! Creating a changelog, and finding the one that describes what is on screen.
//!
//! This is where the format meets Git and the filesystem. The rules that can be
//! stated without either — the grammar, the pinned capture, the matching — live
//! in the sibling modules and are tested there.

use super::capture;
use super::format::{self, CapturedAgainst, ChangeInfo, Changelog, LogicalChange};
use super::matching::{self, Annotations, MatchSummary, ResolvedHunk};
use super::nonce;
use super::storage;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::command::run;
use crate::git::revision::Comparison;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

/// Whether the changelog folder is kept out of the repository's own history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IgnoreState {
    /// Ignored, by whichever mechanism. Nothing to do.
    Ignored,
    /// Not ignored. Untracked files do not reach a diff, so nothing is wrong
    /// yet — but the first `git add -A` would commit every changelog, and from
    /// then on they appear in diffs, range diffs included.
    NotIgnored,
    /// Already tracked, which an ignore rule cannot undo.
    Tracked,
}

impl IgnoreState {
    /// What to tell whoever ran the command. Both cures are named because
    /// `.gitignore` is a tracked file: editing it puts a change into the very
    /// diff about to be reviewed, while `.git/info/exclude` is local and
    /// invisible to every diff.
    pub fn message(self) -> Option<String> {
        match self {
            Self::Ignored => None,
            Self::NotIgnored => Some(format!(
                "{dir}/ is not ignored by git.\n\
                 Add it to .gitignore (shared with your team), or to\n\
                 .git/info/exclude (this clone only, and won't appear in your diff).",
                dir = capture::EXCLUDED_PATH
            )),
            Self::Tracked => Some(format!(
                "{dir}/ is already tracked by git, so ignoring it has no effect.\n\
                 Remove it from the index first:  git rm -r --cached {dir}",
                dir = capture::EXCLUDED_PATH
            )),
        }
    }
}

/// Runs Git for its exit status rather than its output, which `command::run`
/// cannot do: `check-ignore` exits 1 to mean "not ignored", and that is an
/// answer, not a failure.
fn status_of(root: &Path, args: &[&str]) -> Option<std::process::Output> {
    Command::new("git")
        .args(args)
        .env("LC_ALL", "C")
        .current_dir(root)
        .output()
        .ok()
}

/// Whether `.difftrek/` is kept out of the repository.
pub fn ignore_state(root: &Path) -> IgnoreState {
    // Tracked beats ignored: Git keeps tracking a file whatever the ignore
    // rules say, so this has to be asked first.
    let tracked = status_of(root, &["ls-files", "--", capture::EXCLUDED_PATH])
        .map(|output| !output.stdout.is_empty())
        .unwrap_or(false);

    if tracked {
        return IgnoreState::Tracked;
    }

    // Ask about a path *inside* the folder rather than the folder itself.
    // `check-ignore` decides whether a name is a directory by looking on disk,
    // so before the folder exists a `.difftrek/` rule — the natural way to
    // write it — does not match the bare name and the check would wrongly say
    // "not ignored" the very first time anyone runs this. A file beneath it
    // matches under every spelling of the rule, existing or not.
    let probe = format!("{}/probe.log", storage::DIR);
    let ignored = status_of(root, &["check-ignore", "-q", "--", &probe])
        .map(|output| output.status.success())
        .unwrap_or(false);

    if ignored {
        IgnoreState::Ignored
    } else {
        IgnoreState::NotIgnored
    }
}

/// The diff a changelog is written about, captured exactly as it will later be
/// checked.
pub fn capture_diff(root: &Path, comparison: &Comparison) -> AppResult<String> {
    let revisions = comparison.diff_args();
    let args = capture::diff_args(&revisions);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    Ok(run(root, &args)?.text())
}

/// What `--createchangelog` produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Created {
    pub path: PathBuf,
    pub nonce: String,
    /// Placeholders waiting to be filled in — one per hunk.
    pub hunks: usize,
    /// Changelogs deleted for age while we were here.
    pub reaped: Vec<String>,
}

/// Writes a fresh changelog for the current diff.
///
/// The diff is captured here rather than left to the author, which is the whole
/// point: nobody retypes diff text, so nobody can mangle it, and the nonce can
/// be checked against the text it is about to annotate.
pub fn create(root: &Path, comparison: &Comparison, author: &str) -> AppResult<Created> {
    if let Some(message) = ignore_state(root).message() {
        return Err(AppError::new(ErrorKind::GitCommandFailed, message));
    }

    let diff = capture_diff(root, comparison)?;
    if diff.trim().is_empty() {
        return Err(AppError::new(
            ErrorKind::GitCommandFailed,
            "There are no changes to write a changelog for.",
        ));
    }

    let nonce = nonce::for_diff(&diff);
    let info = ChangeInfo {
        author: Some(author.to_string()),
        captured_against: Some(captured_against(comparison)),
        capture_args: capture::recorded_args(),
        tool_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        created_at: Some(timestamp()),
        ..ChangeInfo::default()
    };

    let contents = format::render(&nonce, &info, &diff);
    let path = storage::write(root, &nonce, &contents).map_err(|err| {
        AppError::new(
            ErrorKind::GitCommandFailed,
            format!("Diff Trek could not write to {}/.", storage::DIR),
        )
        .with_detail(err.to_string())
    })?;

    let hunks = format::scan(&diff).len();
    let reaped = storage::reap(root, SystemTime::now(), storage::MAX_AGE);

    Ok(Created {
        path,
        nonce,
        hunks,
        reaped,
    })
}

fn captured_against(comparison: &Comparison) -> CapturedAgainst {
    match comparison {
        Comparison::WorkingTree => CapturedAgainst::working_tree(),
        Comparison::Commits { base, target } => CapturedAgainst {
            kind: "commits".to_string(),
            base: Some(base.clone()),
            target: Some(target.clone()),
        },
    }
}

/// RFC 3339-ish, to the second, in UTC. Recorded for diagnostics only, so the
/// few lines of arithmetic are cheaper than a date dependency.
fn timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);

    let (days, rest) = (seconds / 86_400, seconds % 86_400);
    let (hour, minute, second) = (rest / 3600, (rest % 3600) / 60, rest % 60);

    // Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// A changelog, and how much of the live diff it still describes.
#[derive(Debug, Clone)]
pub struct Loaded {
    pub nonce: String,
    pub changelog: Changelog,
    pub annotations: Annotations,
}

/// What the frontend receives: the notes that apply, keyed by hunk id, plus
/// enough of the changelog to describe itself.
///
/// The parsed file is deliberately not sent whole — the frontend has no use for
/// the diff text it already has, and it can be megabytes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogView {
    pub nonce: String,
    /// Whose account of the change this is.
    pub author: Option<String>,
    pub issue_tracker: Option<String>,
    /// Set once the work was committed and the changelog attached to it.
    pub commithash: Option<String>,
    pub logical_changes: Vec<LogicalChange>,
    /// Keyed by `<path>:hunk:<index>`, the same id the diff model uses.
    pub hunks: HashMap<String, ResolvedHunk>,
    pub summary: MatchSummary,
}

impl From<Loaded> for ChangelogView {
    fn from(loaded: Loaded) -> Self {
        Self {
            nonce: loaded.nonce,
            author: loaded.changelog.info.author,
            issue_tracker: loaded.changelog.info.issue_tracker,
            commithash: loaded.changelog.info.commithash,
            logical_changes: loaded.changelog.logical_changes,
            hunks: loaded.annotations.hunks,
            summary: loaded.annotations.summary,
        }
    }
}

/// The changelog that describes the diff on screen, if there is one.
///
/// Several can exist — repeated runs, parallel agents — so: prefer one that
/// still matches in full; otherwise the newest that describes this comparison
/// at all, warnings and all. A file without its `END` trailer was truncated and
/// is never used, because its tail cannot be trusted.
pub fn load(root: &Path, comparison: &Comparison) -> Option<Loaded> {
    let live = capture_diff(root, comparison).ok()?;
    let mut newest: Option<Loaded> = None;

    for entry in storage::list(root) {
        let Ok(text) = std::fs::read_to_string(&entry.path) else {
            continue;
        };
        let Ok(changelog) = format::parse(&text) else {
            continue;
        };

        if !changelog.complete || !describes(&changelog, comparison) {
            continue;
        }

        let annotations = matching::annotate(&changelog, &live);
        let loaded = Loaded {
            nonce: entry.nonce,
            changelog,
            annotations,
        };

        if loaded.annotations.summary.is_complete() {
            return Some(loaded);
        }

        // `storage::list` is newest first, so the first one here is the newest.
        newest.get_or_insert(loaded);
    }

    newest
}

/// Whether a changelog was written about this comparison at all.
///
/// Notes taken against `main...HEAD` and opened against unstaged changes would
/// otherwise fail to match with no explanation.
fn describes(changelog: &Changelog, comparison: &Comparison) -> bool {
    let Some(against) = &changelog.info.captured_against else {
        // Older or hand-written files say nothing; matching decides.
        return true;
    };

    match comparison {
        Comparison::WorkingTree => against.kind == "workingTree",
        Comparison::Commits { base, target } => {
            against.kind == "commits"
                && against.base.as_ref() == Some(base)
                && against.target.as_ref() == Some(target)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ignore_message_names_both_cures_and_says_which_is_invisible() {
        let message = IgnoreState::NotIgnored.message().unwrap();
        assert!(message.contains(".gitignore"));
        assert!(message.contains(".git/info/exclude"));
        assert!(message.contains("won't appear in your diff"));
        assert!(IgnoreState::Ignored.message().is_none());
    }

    #[test]
    fn an_already_tracked_folder_is_told_apart_from_an_unignored_one() {
        let message = IgnoreState::Tracked.message().unwrap();
        assert!(message.contains("git rm -r --cached"));
    }

    #[test]
    fn a_changelog_for_the_working_tree_is_not_used_for_a_commit() {
        let mut changelog = format::parse(&format::render(
            "AB99X7",
            &ChangeInfo {
                captured_against: Some(CapturedAgainst::working_tree()),
                ..ChangeInfo::default()
            },
            "",
        ))
        .unwrap();

        assert!(describes(&changelog, &Comparison::WorkingTree));
        assert!(!describes(
            &changelog,
            &Comparison::Commits {
                base: "aaa".into(),
                target: "bbb".into()
            }
        ));

        changelog.info.captured_against = Some(CapturedAgainst {
            kind: "commits".into(),
            base: Some("aaa".into()),
            target: Some("bbb".into()),
        });
        assert!(describes(
            &changelog,
            &Comparison::Commits {
                base: "aaa".into(),
                target: "bbb".into()
            }
        ));
        assert!(!describes(&changelog, &Comparison::WorkingTree));
    }

    #[test]
    fn a_changelog_that_says_nothing_about_its_comparison_is_still_considered() {
        let changelog =
            format::parse(&format::render("AB99X7", &ChangeInfo::default(), "")).unwrap();
        assert!(describes(&changelog, &Comparison::WorkingTree));
    }

    #[test]
    fn timestamps_are_utc_and_sorted_by_string() {
        let stamp = timestamp();
        assert_eq!(stamp.len(), 20);
        assert!(stamp.ends_with('Z'));
        assert!(stamp.starts_with("20"));
    }
}
