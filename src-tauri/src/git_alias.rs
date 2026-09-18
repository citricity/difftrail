//! Installing the `git dt` alias from inside the app.
//!
//! The same alias `scripts/install-git-alias.sh` writes, pointed at whichever
//! executable is running now, so a user who installed the app never needs a
//! terminal or the repository to set it up.
//!
//! Kept free of Tauri, like `launch.rs` and `settings.rs`, so the quoting and
//! the Git round trip are testable on their own — and they are the parts that
//! matter: the executable's path goes inside a shell command, and a path with a
//! space, a quote or a `$` in it has to arrive at the shell intact.

use crate::error::{AppError, AppResult, ErrorKind};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

/// The alias name: `git dt`.
pub const ALIAS: &str = "dt";

/// Which Git configuration file the alias is read from and written to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigTarget {
    /// `~/.gitconfig`, so the alias works in every repository.
    Global,
    /// A specific file. Used by tests, so they never touch the real one.
    File(PathBuf),
}

impl ConfigTarget {
    fn args(&self) -> Vec<String> {
        match self {
            Self::Global => vec!["--global".into()],
            Self::File(path) => vec!["--file".into(), path.to_string_lossy().into_owned()],
        }
    }
}

/// What installing would do, and whether it already has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AliasStatus {
    /// The executable the alias will launch.
    pub binary: String,
    /// The full command that installs it, as a user could type it — shown in
    /// the confirmation so nothing is run that the user has not seen.
    pub command: String,
    /// The alias currently configured under `dt`, if any.
    pub existing: Option<String>,
    /// `existing` is exactly what would be installed.
    pub installed: bool,
    /// Why this executable is a poor thing to point the alias at, if it is.
    pub warning: Option<String>,
}

/// The alias's value: a shell function that finds the repository root and
/// launches Diff Trek on it.
///
/// `!f() { ...; }; f` is Git's idiom for an alias that needs a real shell. The
/// root is passed explicitly because a macOS `.app` is not started with the
/// shell's working directory. `git rev-parse` fails outside a repository, which
/// is the error the user should see rather than an empty window. Git hands the
/// alias's own arguments to `f`, and `"$@"` passes them on after the root, so
/// `git dt main...HEAD` opens that range.
///
/// An argument beginning with `-` means a command-line request rather than a
/// window — `git dt --createchangelog="claude"` — so the executable is run in
/// the foreground, unredirected, and its output reaches the terminal that asked
/// for it. Neither of the window launches below can do that: one discards
/// stdout, and the other hands the process to LaunchServices, which has no
/// terminal to write to.
///
/// Inside a `.app` bundle the launch goes through `open -n` rather than
/// running the executable. A process the terminal starts directly is not a
/// launch the user asked for as far as macOS is concerned, so since macOS 14
/// its window opens behind the terminal and is refused focus. LaunchServices
/// launches are, so the window comes to the front. `-n` keeps one process per
/// `git dt`, as running the executable did, and `open` returns at once, so
/// nothing is backgrounded.
pub fn alias_value(binary: &str) -> String {
    let executable = escape_double_quoted(binary);
    let window = match app_bundle(binary) {
        Some(bundle) => format!(
            "open -n \"{}\" --args \"$root\" \"$@\"",
            escape_double_quoted(bundle)
        ),
        None => format!("\"{executable}\" \"$root\" \"$@\" >/dev/null 2>&1 &"),
    };

    format!(
        "!f() {{ root=$(git rev-parse --show-toplevel) || exit 1; \
         case \"$1\" in \
         -*) \"{executable}\" \"$root\" \"$@\";; \
         *) {window} ;; \
         esac; }}; f"
    )
}

/// The `.app` bundle an executable is the main binary of:
/// `/Applications/Diff Trek.app` for
/// `/Applications/Diff Trek.app/Contents/MacOS/diff-trek`.
fn app_bundle(binary: &str) -> Option<&str> {
    const INSIDE: &str = "/Contents/MacOS/";
    let index = binary.rfind(INSIDE)?;
    let bundle = &binary[..index];
    let executable = &binary[index + INSIDE.len()..];
    (bundle.ends_with(".app") && !executable.is_empty() && !executable.contains('/'))
        .then_some(bundle)
}

/// Escapes text for use inside a double-quoted POSIX shell string, where only
/// these four characters are special.
fn escape_double_quoted(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        if matches!(character, '\\' | '"' | '$' | '`') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

/// The value wrapped for display as one single-quoted shell word.
fn single_quoted(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

/// Paths the alias should not be pointed at without the user knowing why.
pub fn warning_for(binary: &str) -> Option<String> {
    if binary.contains("/AppTranslocation/") {
        return Some(
            "macOS is running Diff Trek from a temporary location, which will not \
             exist next time. Move Diff Trek to Applications, open it from there, \
             and install the command again."
                .into(),
        );
    }

    if binary.starts_with("/Volumes/") {
        return Some(
            "Diff Trek is running from a disk image. git dt will stop working once \
             it is ejected — copy Diff Trek to Applications first."
                .into(),
        );
    }

    if binary.contains("/target/debug/") {
        return Some(
            "This is a development build. git dt will launch it, but it only works \
             while the dev server is running."
                .into(),
        );
    }

    None
}

/// The executable that is running now.
pub fn current_binary() -> AppResult<String> {
    let path = std::env::current_exe().map_err(|err| {
        AppError::new(
            ErrorKind::GitCommandFailed,
            "Diff Trek could not work out where it is installed.",
        )
        .with_detail(err.to_string())
    })?;

    // Resolve symlinks, so the alias does not depend on one staying put.
    let path = std::fs::canonicalize(&path).unwrap_or(path);

    path.to_str().map(str::to_owned).ok_or_else(|| {
        AppError::new(
            ErrorKind::GitCommandFailed,
            "Diff Trek is installed at a path Git cannot store.",
        )
        .with_detail(path.to_string_lossy().into_owned())
    })
}

/// What installing the alias for `binary` would do.
pub fn status(binary: &str, target: &ConfigTarget) -> AppResult<AliasStatus> {
    let value = alias_value(binary);
    let existing = read_alias(target)?;

    let scope = target.args().join(" ");
    Ok(AliasStatus {
        binary: binary.to_owned(),
        command: format!("git config {scope} alias.{ALIAS} {}", single_quoted(&value)),
        installed: existing.as_deref() == Some(value.as_str()),
        existing,
        warning: warning_for(binary),
    })
}

/// Installs the alias for `binary`, replacing any `dt` alias already there, and
/// returns the status afterwards.
pub fn install(binary: &str, target: &ConfigTarget) -> AppResult<AliasStatus> {
    let value = alias_value(binary);
    let mut args = vec!["config".to_owned()];
    args.extend(target.args());
    args.push(format!("alias.{ALIAS}"));
    args.push(value);

    let output = git(&args)?;
    if !output.status.success() {
        return Err(AppError::new(
            ErrorKind::GitCommandFailed,
            "Git would not save the git dt command.",
        )
        .with_detail(String::from_utf8_lossy(&output.stderr).trim().to_owned()));
    }

    status(binary, target)
}

/// The configured `dt` alias, or None when there is not one.
fn read_alias(target: &ConfigTarget) -> AppResult<Option<String>> {
    let mut args = vec!["config".to_owned()];
    args.extend(target.args());
    args.push("--get".into());
    args.push(format!("alias.{ALIAS}"));

    let output = git(&args)?;
    match output.status.code() {
        Some(0) => Ok(Some(
            String::from_utf8_lossy(&output.stdout)
                .trim_end_matches(['\n', '\r'])
                .to_owned(),
        )),
        // `git config --get` exits 1 when the key is simply not set. A missing
        // global config file reads the same way.
        Some(1) => Ok(None),
        _ => Err(AppError::new(
            ErrorKind::GitCommandFailed,
            "Git could not read its configuration.",
        )
        .with_detail(String::from_utf8_lossy(&output.stderr).trim().to_owned())),
    }
}

/// Runs `git` outside any repository, so a local config never takes part.
fn git(args: &[String]) -> AppResult<std::process::Output> {
    Command::new("git")
        .args(args)
        .current_dir(std::env::temp_dir())
        .output()
        .map_err(|err| {
            AppError::new(
                ErrorKind::GitUnavailable,
                "Git could not be started. Check that it is installed and on your PATH.",
            )
            .with_detail(err.to_string())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_app_bundle_is_launched_through_open_so_it_takes_focus() {
        assert_eq!(
            alias_value("/Applications/Diff Trek.app/Contents/MacOS/diff-trek"),
            "!f() { root=$(git rev-parse --show-toplevel) || exit 1; \
             case \"$1\" in \
             -*) \"/Applications/Diff Trek.app/Contents/MacOS/diff-trek\" \"$root\" \"$@\";; \
             *) open -n \"/Applications/Diff Trek.app\" --args \"$root\" \"$@\" ;; \
             esac; }; f"
        );
    }

    #[test]
    fn a_bare_executable_is_run_directly_in_the_background() {
        assert_eq!(
            alias_value("/usr/bin/diff-trek"),
            "!f() { root=$(git rev-parse --show-toplevel) || exit 1; \
             case \"$1\" in \
             -*) \"/usr/bin/diff-trek\" \"$root\" \"$@\";; \
             *) \"/usr/bin/diff-trek\" \"$root\" \"$@\" >/dev/null 2>&1 & ;; \
             esac; }; f"
        );
    }

    #[test]
    fn a_command_line_request_runs_in_the_foreground_on_either_platform() {
        // Nothing may be redirected or detached here: this is the path that has
        // to hand a file location back to whoever typed the command.
        for binary in [
            "/Applications/Diff Trek.app/Contents/MacOS/diff-trek",
            "/usr/bin/diff-trek",
        ] {
            let value = alias_value(binary);
            let cli = value.split("-*)").nth(1).unwrap().split(";;").next().unwrap();

            assert!(cli.contains(&format!("\"{binary}\" \"$root\" \"$@\"")), "{cli}");
            assert!(!cli.contains(">/dev/null"), "{cli}");
            assert!(!cli.contains("open -n"), "{cli}");
            assert!(!cli.contains('&'), "{cli}");
        }
    }

    #[test]
    fn finds_the_bundle_only_for_its_main_executable() {
        assert_eq!(
            app_bundle("/Applications/Diff Trek.app/Contents/MacOS/diff-trek"),
            Some("/Applications/Diff Trek.app")
        );
        assert_eq!(app_bundle("/Users/guy/difftrek/src-tauri/target/debug/diff-trek"), None);
        assert_eq!(app_bundle("/opt/Contents/MacOS/diff-trek"), None);
        assert_eq!(app_bundle("/Applications/Diff Trek.app/Contents/MacOS/"), None);
        assert_eq!(app_bundle("/A.app/Contents/MacOS/nested/diff-trek"), None);
    }

    #[test]
    fn characters_special_inside_double_quotes_are_escaped() {
        assert_eq!(escape_double_quoted(r#"a"b$c`d\e f'g"#), r#"a\"b\$c\`d\\e f'g"#);
    }

    #[test]
    fn the_displayed_command_single_quotes_the_value() {
        assert_eq!(single_quoted("it's"), r"'it'\''s'");
    }

    #[test]
    fn warns_about_locations_that_will_not_last() {
        assert!(warning_for("/private/var/folders/x/AppTranslocation/y/d.app/Contents/MacOS/diff-trek")
            .unwrap()
            .contains("Applications"));
        assert!(warning_for("/Volumes/Diff Trek/Diff Trek.app/Contents/MacOS/diff-trek").is_some());
        assert!(warning_for("/Users/guy/difftrek/src-tauri/target/debug/diff-trek")
            .unwrap()
            .contains("dev server"));
        assert_eq!(warning_for("/Applications/Diff Trek.app/Contents/MacOS/diff-trek"), None);
        assert_eq!(warning_for("/Users/guy/difftrek/src-tauri/target/release/diff-trek"), None);
    }
}
