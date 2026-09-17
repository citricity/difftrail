//! What a diff compares: the working tree, or two commits named on the
//! command line.
//!
//! `git dt` with no arguments reviews unstaged changes, as it always has. Given
//! a revision it reviews that instead, with the same meaning `git` gives it:
//!
//! | Argument            | Base                        | Target |
//! | ------------------- | --------------------------- | ------ |
//! | `abc123`, `abc123^!`| its first parent            | itself |
//! | `main..feature`     | `main`                      | `feature` |
//! | `main...feature`    | merge base of the two       | `feature` |
//! | `main feature`      | `main`                      | `feature` |
//!
//! An omitted side of a range is `HEAD`, so `main...` is `main...HEAD`.
//!
//! A single commit means *that commit's own changes*, as `git show` presents
//! them — not `git diff abc123`, which compares it against the working tree.
//! A root commit has no parent and is compared against the empty tree.
//!
//! Both ends are resolved to object ids once, at startup. Every later read —
//! the file list, each diff, whole-file text, image bytes — uses those ids, so
//! a branch that moves while the window is open cannot make one file disagree
//! with another. Parsing is kept apart from resolving so the argument rules are
//! testable without a repository.

use super::command::run;
use super::model::ComparisonInfo;
use crate::error::{AppError, AppResult, ErrorKind};
use std::path::Path;

/// The two sides of the diff Diff Trek is showing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum Comparison {
    /// The index against the working tree: a bare `git diff`.
    #[default]
    WorkingTree,
    /// One commit against another, both full object ids.
    Commits { base: String, target: String },
}

impl Comparison {
    /// The revision arguments to place before `--` in a `git diff`.
    pub fn diff_args(&self) -> Vec<&str> {
        match self {
            Self::WorkingTree => Vec::new(),
            Self::Commits { base, target } => vec![base.as_str(), target.as_str()],
        }
    }
}

/// A revision argument as the user wrote it, before Git has been asked what
/// it names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RevisionSpec {
    /// One commit's own changes.
    Commit(String),
    /// `from..to`, or two separate arguments: a straight comparison.
    Range { from: String, to: String },
    /// `from...to`: what `to` changed since it diverged from `from`.
    MergeBaseRange { from: String, to: String },
}

const HEAD: &str = "HEAD";

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::InvalidRevision, message)
}

fn side_or_head(side: &str) -> String {
    if side.is_empty() {
        HEAD.to_string()
    } else {
        side.to_string()
    }
}

/// Interprets the revision arguments. `None` means none were given, so the
/// working tree is shown.
pub fn parse(revisions: &[String]) -> AppResult<Option<RevisionSpec>> {
    if let Some(flag) = revisions.iter().find(|arg| arg.starts_with('-')) {
        return Err(invalid(format!(
            "{flag} is not a revision Diff Trek understands."
        )));
    }
    if let Some(empty) = revisions.iter().find(|arg| arg.trim().is_empty()) {
        return Err(invalid("An empty revision was given.").with_detail(format!("{empty:?}")));
    }

    match revisions {
        [] => Ok(None),
        [single] => Ok(Some(parse_single(single))),
        [from, to] => {
            if from.contains("..") || to.contains("..") {
                return Err(invalid(
                    "Give either a range such as main...HEAD, or two commits, not both.",
                ));
            }
            Ok(Some(RevisionSpec::Range {
                from: from.clone(),
                to: to.clone(),
            }))
        }
        _ => Err(invalid(
            "Diff Trek takes one commit or range, such as main...HEAD, or two commits.",
        )
        .with_detail(revisions.join(" "))),
    }
}

fn parse_single(value: &str) -> RevisionSpec {
    // `...` first: every `...` also contains `..`. Git forbids `..` inside a
    // ref name, so the first occurrence is always the separator.
    if let Some((from, to)) = value.split_once("...") {
        return RevisionSpec::MergeBaseRange {
            from: side_or_head(from),
            to: side_or_head(to),
        };
    }
    if let Some((from, to)) = value.split_once("..") {
        return RevisionSpec::Range {
            from: side_or_head(from),
            to: side_or_head(to),
        };
    }
    // `abc123^!` is Git's own spelling of "just this commit".
    let commit = value.strip_suffix("^!").unwrap_or(value);
    RevisionSpec::Commit(commit.to_string())
}

/// A revision resolved against a repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub comparison: Comparison,
    pub info: ComparisonInfo,
}

/// Asks Git what `spec` names in the repository at `root`.
pub fn resolve(root: &Path, spec: &RevisionSpec, label: &str) -> AppResult<Resolved> {
    let (base, target) = match spec {
        RevisionSpec::Commit(name) => {
            let target = commit_id(root, name)?;
            // First parent, as `git show` uses for a merge.
            let base = run(
                root,
                &["rev-parse", "--verify", "--quiet", &format!("{target}^1")],
            )
            .ok()
            .map(|output| output.text().trim().to_string())
            .filter(|id| !id.is_empty());
            (base, target)
        }
        RevisionSpec::Range { from, to } => (Some(commit_id(root, from)?), commit_id(root, to)?),
        RevisionSpec::MergeBaseRange { from, to } => {
            let from_id = commit_id(root, from)?;
            let to_id = commit_id(root, to)?;
            let base = run(root, &["merge-base", &from_id, &to_id])
                .ok()
                .map(|output| output.text().trim().to_string())
                .filter(|id| !id.is_empty())
                .ok_or_else(|| invalid(format!("{from} and {to} have no common ancestor.")))?;
            (Some(base), to_id)
        }
    };

    let info = ComparisonInfo {
        label: label.to_string(),
        base: base.as_deref().map(|id| short_id(root, id)),
        target: short_id(root, &target),
    };

    let base = match base {
        Some(base) => base,
        None => empty_tree(root)?,
    };

    Ok(Resolved {
        comparison: Comparison::Commits { base, target },
        info,
    })
}

/// Parses and resolves the launch arguments in one step.
pub fn comparison_for(root: &Path, revisions: &[String]) -> AppResult<Option<Resolved>> {
    match parse(revisions)? {
        None => Ok(None),
        Some(spec) => resolve(root, &spec, &revisions.join(" ")).map(Some),
    }
}

/// The full object id of the commit `name` refers to.
fn commit_id(root: &Path, name: &str) -> AppResult<String> {
    let spec = format!("{name}^{{commit}}");
    match run(root, &["rev-parse", "--verify", "--quiet", &spec]) {
        Ok(output) => {
            let id = output.text().trim().to_string();
            if id.is_empty() {
                Err(unknown(name))
            } else {
                Ok(id)
            }
        }
        // Git missing altogether is a different problem, and should say so.
        Err(error) if error.kind == ErrorKind::GitUnavailable => Err(error),
        Err(error) => Err(unknown(name).with_detail(error.detail.unwrap_or_default())),
    }
}

fn unknown(name: &str) -> AppError {
    invalid(format!("{name} is not a commit in this repository."))
}

fn short_id(root: &Path, id: &str) -> String {
    run(root, &["rev-parse", "--short", id])
        .ok()
        .map(|output| output.text().trim().to_string())
        .filter(|short| !short.is_empty())
        .unwrap_or_else(|| id.chars().take(7).collect())
}

/// The empty tree's id, asked of Git rather than hard-coded, because it differs
/// between SHA-1 and SHA-256 repositories.
fn empty_tree(root: &Path) -> AppResult<String> {
    let output = run(root, &["hash-object", "-t", "tree", "--stdin"])?;
    Ok(output.text().trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn parsed(values: &[&str]) -> Option<RevisionSpec> {
        parse(&args(values)).expect("parses")
    }

    #[test]
    fn no_arguments_means_the_working_tree() {
        assert_eq!(parsed(&[]), None);
    }

    #[test]
    fn a_single_name_is_one_commit() {
        assert_eq!(
            parsed(&["abc123"]),
            Some(RevisionSpec::Commit("abc123".into()))
        );
        assert_eq!(
            parsed(&["HEAD~2"]),
            Some(RevisionSpec::Commit("HEAD~2".into()))
        );
        assert_eq!(
            parsed(&["abc123^!"]),
            Some(RevisionSpec::Commit("abc123".into()))
        );
    }

    #[test]
    fn three_dots_compare_against_the_merge_base() {
        assert_eq!(
            parsed(&["main...HEAD"]),
            Some(RevisionSpec::MergeBaseRange {
                from: "main".into(),
                to: "HEAD".into()
            })
        );
    }

    #[test]
    fn two_dots_compare_directly() {
        assert_eq!(
            parsed(&["v1.0..v2.0"]),
            Some(RevisionSpec::Range {
                from: "v1.0".into(),
                to: "v2.0".into()
            })
        );
    }

    #[test]
    fn an_omitted_side_is_head() {
        assert_eq!(
            parsed(&["main..."]),
            Some(RevisionSpec::MergeBaseRange {
                from: "main".into(),
                to: "HEAD".into()
            })
        );
        assert_eq!(
            parsed(&["..main"]),
            Some(RevisionSpec::Range {
                from: "HEAD".into(),
                to: "main".into()
            })
        );
    }

    #[test]
    fn two_arguments_are_a_straight_comparison() {
        assert_eq!(
            parsed(&["main", "feature"]),
            Some(RevisionSpec::Range {
                from: "main".into(),
                to: "feature".into()
            })
        );
    }

    #[test]
    fn rejects_what_it_cannot_mean() {
        for bad in [
            args(&["a", "b", "c"]),
            args(&["main..x", "y"]),
            args(&["--stat"]),
            args(&[""]),
        ] {
            let error = parse(&bad).unwrap_err();
            assert_eq!(error.kind, ErrorKind::InvalidRevision, "{bad:?}");
        }
    }

    #[test]
    fn the_working_tree_adds_no_diff_arguments() {
        assert!(Comparison::WorkingTree.diff_args().is_empty());
        assert_eq!(
            Comparison::Commits {
                base: "a".into(),
                target: "b".into()
            }
            .diff_args(),
            vec!["a", "b"]
        );
    }
}
