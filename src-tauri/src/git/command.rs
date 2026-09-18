//! The single place Git is executed.
//!
//! Every invocation runs with `-c core.quotepath=false` so non-ASCII paths
//! arrive as UTF-8 rather than octal escapes, and with `--no-ext-diff` /
//! `--no-color` so a user's own diff configuration cannot change what we parse.

use crate::error::{AppError, AppResult, ErrorKind};
use std::path::Path;
use std::process::Command;

/// Arguments prepended to every Git call.
const BASE_ARGS: [&str; 4] = ["-c", "core.quotepath=false", "-c", "color.ui=false"];

pub struct GitOutput {
    pub stdout: Vec<u8>,
}

impl GitOutput {
    /// Git output is UTF-8 in practice, but a file can contain arbitrary bytes.
    /// Replacing invalid sequences keeps one bad line from failing a whole diff.
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

/// Runs `git` in `cwd` and returns stdout, or a classified error.
pub fn run(cwd: &Path, args: &[&str]) -> AppResult<GitOutput> {
    let output = Command::new("git")
        .args(BASE_ARGS)
        .args(args)
        // Git translates parts of its own output — "Binary files … differ",
        // "\ No newline at end of file" — and an AI changelog is matched
        // against that text byte for byte, so a translated line would unmatch
        // every note in the file. It also keeps `from_git_stderr`'s English
        // phrases meaningful on a non-English system.
        .env("LC_ALL", "C")
        .current_dir(cwd)
        .output()
        .map_err(|err| {
            AppError::new(
                ErrorKind::GitUnavailable,
                "Git could not be started. Check that it is installed and on your PATH.",
            )
            .with_detail(err.to_string())
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::from_git_stderr(&stderr));
    }

    Ok(GitOutput {
        stdout: output.stdout,
    })
}

/// Escapes a path so Git treats it as a literal, not a glob.
///
/// Diff Trek always passes paths that came out of Git itself, so a path
/// containing `*` or `[` must not be re-interpreted as a pattern.
pub fn literal_pathspec(path: &str) -> String {
    format!(":(literal){path}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pathspec_is_marked_literal() {
        assert_eq!(literal_pathspec("src/a[1].ts"), ":(literal)src/a[1].ts");
    }
}
