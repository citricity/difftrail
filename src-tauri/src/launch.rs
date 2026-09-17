//! Working out what Diff Trail was asked to open.
//!
//! Kept separate from the Tauri command layer so the precedence rules are
//! testable without a running app.

use serde::Serialize;
use std::ffi::OsString;
use std::path::PathBuf;

/// Serve the built-in sample diff instead of reading a repository.
const EXAMPLE_FLAG: &str = "--example";

/// How the process was started.
///
/// Read once by the frontend at startup. Nothing here can change while the
/// process runs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptions {
    /// `--example` was passed. The frontend then answers every request from
    /// its own sample data and never calls the Git commands, so Diff Trail
    /// opens anywhere — including outside a repository.
    pub example: bool,
}

pub fn launch_options() -> LaunchOptions {
    options_from(std::env::args().skip(1))
}

pub(crate) fn options_from(mut args: impl Iterator<Item = String>) -> LaunchOptions {
    LaunchOptions {
        example: args.any(|arg| arg == EXAMPLE_FLAG),
    }
}

/// What to open: a repository, and optionally a commit or range within it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchTarget {
    pub directory: PathBuf,
    /// Everything after the repository path, still unparsed:
    /// `difftrail /repo main...HEAD`. Empty for the working tree.
    pub revisions: Vec<String>,
}

/// Resolves the repository to inspect, and any revisions to compare in it.
///
/// Precedence for the repository: an explicit path argument
/// (`difftrail /path/to/repo`), then `DIFFTRAIL_REPO`, then the process working
/// directory. The `git dt` alias passes the root explicitly, because a macOS
/// `.app` bundle does not inherit the shell's working directory, and forwards
/// its own arguments after it — so `git dt main...HEAD` arrives as
/// `difftrail /repo main...HEAD`.
///
/// The first positional argument is always the repository, so a revision can
/// only be given after a path. That is what keeps a branch that happens to
/// share a directory's name from being ambiguous.
///
/// Flags are skipped, so `--example` and friends are never mistaken for a
/// path. Under `--example` this is not called at all.
pub fn launch_target() -> LaunchTarget {
    target_from(
        std::env::args().skip(1),
        std::env::var_os("DIFFTRAIL_REPO"),
        std::env::current_dir().ok(),
    )
}

pub(crate) fn target_from(
    args: impl Iterator<Item = String>,
    env: Option<OsString>,
    cwd: Option<PathBuf>,
) -> LaunchTarget {
    let mut positional = args.filter(|arg| !arg.starts_with('-'));

    let directory = positional
        .next()
        .map(PathBuf::from)
        .or_else(|| env.map(PathBuf::from))
        .or(cwd)
        .unwrap_or_else(|| PathBuf::from("."));

    LaunchTarget {
        directory,
        revisions: positional.collect(),
    }
}

#[cfg(test)]
fn resolve_from(
    args: impl Iterator<Item = String>,
    env: Option<OsString>,
    cwd: Option<PathBuf>,
) -> PathBuf {
    target_from(args, env, cwd).directory
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> impl Iterator<Item = String> + use<> {
        values
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn an_explicit_path_argument_wins() {
        let resolved = resolve_from(
            args(&["/repos/alpha"]),
            Some(OsString::from("/repos/beta")),
            Some(PathBuf::from("/repos/gamma")),
        );
        assert_eq!(resolved, PathBuf::from("/repos/alpha"));
    }

    #[test]
    fn flags_are_not_mistaken_for_paths() {
        let resolved = resolve_from(
            args(&["--verbose", "/repos/alpha"]),
            None,
            Some(PathBuf::from("/repos/gamma")),
        );
        assert_eq!(resolved, PathBuf::from("/repos/alpha"));
    }

    #[test]
    fn falls_back_to_the_environment_then_the_working_directory() {
        assert_eq!(
            resolve_from(
                args(&[]),
                Some(OsString::from("/repos/beta")),
                Some(PathBuf::from("/repos/gamma"))
            ),
            PathBuf::from("/repos/beta")
        );

        assert_eq!(
            resolve_from(args(&[]), None, Some(PathBuf::from("/repos/gamma"))),
            PathBuf::from("/repos/gamma")
        );
    }

    #[test]
    fn falls_back_to_the_current_directory_when_nothing_is_known() {
        assert_eq!(resolve_from(args(&[]), None, None), PathBuf::from("."));
    }

    #[test]
    fn arguments_after_the_repository_are_revisions() {
        let target = target_from(args(&["/repos/alpha", "main...HEAD"]), None, None);
        assert_eq!(target.directory, PathBuf::from("/repos/alpha"));
        assert_eq!(target.revisions, vec!["main...HEAD".to_string()]);

        let target = target_from(args(&["/repos/alpha", "main", "feature"]), None, None);
        assert_eq!(target.revisions, vec!["main".to_string(), "feature".to_string()]);
    }

    #[test]
    fn no_revisions_means_the_working_tree() {
        let target = target_from(args(&["/repos/alpha"]), None, None);
        assert!(target.revisions.is_empty());

        let target = target_from(args(&["--example"]), None, Some(PathBuf::from("/r")));
        assert!(target.revisions.is_empty());
    }

    #[test]
    fn example_mode_is_off_unless_asked_for() {
        assert!(!options_from(args(&[])).example);
        assert!(!options_from(args(&["/repos/alpha"])).example);
        assert!(!options_from(args(&["--examples"])).example);
        assert!(!options_from(args(&["example"])).example);
    }

    #[test]
    fn example_mode_is_recognised_anywhere_in_the_arguments() {
        assert!(options_from(args(&["--example"])).example);
        assert!(options_from(args(&["/repos/alpha", "--example"])).example);
        assert!(options_from(args(&["--example", "/repos/alpha"])).example);
    }

    #[test]
    fn the_example_flag_is_not_read_as_a_repository_path() {
        let resolved = resolve_from(
            args(&["--example", "/repos/alpha"]),
            None,
            Some(PathBuf::from("/repos/gamma")),
        );
        assert_eq!(resolved, PathBuf::from("/repos/alpha"));

        assert_eq!(
            resolve_from(args(&["--example"]), None, Some(PathBuf::from("/repos/gamma"))),
            PathBuf::from("/repos/gamma")
        );
    }
}
