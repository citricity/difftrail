//! Working out what Diff Trek was asked to open.
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
    /// its own sample data and never calls the Git commands, so Diff Trek
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

/// Write an AI changelog for the current diff instead of opening a window.
const CREATE_CHANGELOG_FLAG: &str = "--createchangelog";

/// Work Diff Trek was asked to do on the command line, with no window involved.
///
/// The `git dt` alias runs the executable in the foreground, unredirected,
/// whenever its first argument begins with `-`, so these can answer on the
/// terminal that asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliRequest {
    /// `git dt --createchangelog="claude"`. The value names whoever is about to
    /// write the notes, which the UI shows so a reader knows whose account of
    /// the change they are reading.
    CreateChangelog { author: String },
}

pub fn cli_request() -> Option<CliRequest> {
    cli_request_from(std::env::args().skip(1))
}

pub(crate) fn cli_request_from(args: impl Iterator<Item = String>) -> Option<CliRequest> {
    let mut args = args;

    while let Some(arg) = args.next() {
        let Some(rest) = arg.strip_prefix(CREATE_CHANGELOG_FLAG) else {
            continue;
        };

        let author = match rest.chars().next() {
            // `--createchangelog=claude`
            Some('=') => rest[1..].to_string(),
            // `--createchangelog claude`, but never swallowing the next flag.
            None => args
                .next()
                .filter(|next| !next.starts_with('-'))
                .unwrap_or_default(),
            // `--createchangelogs`, which is a different flag entirely.
            Some(_) => continue,
        };

        return Some(CliRequest::CreateChangelog {
            author: unquote(author.trim()),
        });
    }

    None
}

/// Strips one layer of matching quotes.
///
/// A shell removes them, but the flag is written `--createchangelog="claude"`
/// in every instruction, and it also arrives from places that do not: a Git
/// alias expansion, a Windows shell, an agent building an argument list itself.
fn unquote(value: &str) -> String {
    for quote in ['"', '\''] {
        if let Some(inner) = value.strip_prefix(quote).and_then(|v| v.strip_suffix(quote)) {
            return inner.to_string();
        }
    }
    value.to_string()
}

/// What to open: a repository, and optionally a commit or range within it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchTarget {
    pub directory: PathBuf,
    /// Everything after the repository path, still unparsed:
    /// `difftrek /repo main...HEAD`. Empty for the working tree.
    pub revisions: Vec<String>,
}

/// Resolves the repository to inspect, and any revisions to compare in it.
///
/// Precedence for the repository: an explicit path argument
/// (`difftrek /path/to/repo`), then `DIFFTREK_REPO`, then the process working
/// directory. The `git dt` alias passes the root explicitly, because a macOS
/// `.app` bundle does not inherit the shell's working directory, and forwards
/// its own arguments after it — so `git dt main...HEAD` arrives as
/// `difftrek /repo main...HEAD`.
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
        std::env::var_os("DIFFTREK_REPO"),
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
    fn a_changelog_request_carries_whoever_is_writing_it() {
        assert_eq!(
            cli_request_from(args(&["/repos/alpha", "--createchangelog=claude"])),
            Some(CliRequest::CreateChangelog {
                author: "claude".into()
            })
        );

        assert_eq!(
            cli_request_from(args(&["--createchangelog", "copilot"])),
            Some(CliRequest::CreateChangelog {
                author: "copilot".into()
            })
        );

        assert_eq!(
            cli_request_from(args(&["--createchangelog=\"my agent\""])),
            Some(CliRequest::CreateChangelog {
                author: "my agent".into()
            })
        );
    }

    #[test]
    fn a_changelog_request_without_a_name_is_still_a_request() {
        // The runner says what is missing; silently opening a window instead
        // would leave an agent waiting for a path that never comes.
        assert_eq!(
            cli_request_from(args(&["--createchangelog"])),
            Some(CliRequest::CreateChangelog {
                author: String::new()
            })
        );

        assert_eq!(
            cli_request_from(args(&["--createchangelog", "--example"])),
            Some(CliRequest::CreateChangelog {
                author: String::new()
            })
        );
    }

    #[test]
    fn ordinary_launches_are_not_changelog_requests() {
        assert_eq!(cli_request_from(args(&[])), None);
        assert_eq!(cli_request_from(args(&["/repos/alpha", "main...HEAD"])), None);
        assert_eq!(cli_request_from(args(&["--example"])), None);
        assert_eq!(cli_request_from(args(&["--createchangelogs=claude"])), None);
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
