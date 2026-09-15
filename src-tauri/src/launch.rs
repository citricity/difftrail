//! Working out which repository Diff Trail was asked to open.
//!
//! Kept separate from the Tauri command layer so the precedence rules are
//! testable without a running app.

use std::ffi::OsString;
use std::path::PathBuf;

/// Resolves the repository to inspect.
///
/// Precedence: an explicit path argument (`difftrail /path/to/repo`), then
/// `DIFFTRAIL_REPO`, then the process working directory. The `git dt` alias
/// passes `$PWD` explicitly, because a macOS `.app` bundle does not inherit
/// the shell's working directory.
pub fn resolve_launch_directory() -> PathBuf {
    resolve_from(
        std::env::args().skip(1),
        std::env::var_os("DIFFTRAIL_REPO"),
        std::env::current_dir().ok(),
    )
}

pub(crate) fn resolve_from(
    args: impl Iterator<Item = String>,
    env: Option<OsString>,
    cwd: Option<PathBuf>,
) -> PathBuf {
    args.filter(|arg| !arg.starts_with('-'))
        .map(PathBuf::from)
        .next()
        .or_else(|| env.map(PathBuf::from))
        .or(cwd)
        .unwrap_or_else(|| PathBuf::from("."))
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
}
