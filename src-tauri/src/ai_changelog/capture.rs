//! How the diff inside a changelog is produced.
//!
//! Matching compares recorded diff text against the diff Git reports now, so
//! the two must be produced identically — and a surprising amount of `git diff`
//! output is configurable. Everything a user's configuration could change is
//! pinned here, in one place used by the capture, the check, and the diff the
//! app displays, so the three cannot drift apart.

/// The folder changelogs live in, and the one part of the tree that must never
/// appear in a diff being annotated.
pub const EXCLUDED_PATH: &str = ".difftrek";

/// Excludes `.difftrek/` from a diff.
///
/// `top` matters as much as `exclude`: pathspecs are resolved against the
/// current directory, and `git dt` is normally run from somewhere inside the
/// repository rather than at its root — without it, running from `src/` excludes
/// `src/.difftrek` and the real folder walks straight into the diff. `literal`
/// because the path is ours, not a user's glob.
pub fn exclude_pathspec() -> String {
    format!(":(top,exclude,literal){EXCLUDED_PATH}")
}

/// Configuration overrides, which have to precede the subcommand.
///
/// Only settings with no command-line equivalent are here; everything else is a
/// flag below, where it is easier to read.
pub const CONFIG: [&str; 4] = [
    // `copies` would add copy detection, which turns one change into two.
    "-c",
    "diff.renames=true",
    // Prints blank context lines as empty rather than as a single space — one
    // byte per blank line, which is quite enough to unmatch a hunk.
    "-c",
    "diff.suppressBlankEmpty=false",
];

// `diff.orderFile` is deliberately *not* pinned. It reorders the files in the
// output, and the obvious neutraliser is a trap: `-c diff.orderFile=` makes Git
// fail with "failed to read orderfile ''", and `-O/dev/null` has no portable
// spelling on Windows. It can be left alone because nothing here depends on the
// order files appear in — a note is matched to a hunk by its file path and its
// content, and a hunk's index is counted within its own file.

/// Flags that pin the diff body itself.
pub const FLAGS: [&str; 15] = [
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    // Without this the `index abc1234..def5678` line is abbreviated to a length
    // that depends on `core.abbrev` *and* on how many objects the repository
    // holds — so identical content can produce different bytes months later,
    // purely from the repository having grown.
    "--full-index",
    // Context width, and whether neighbouring hunks merge into one. A merge
    // moves the anchors the notes hang on, not just the text.
    "--unified=3",
    "--inter-hunk-context=0",
    // Shifts hunk boundaries around indented blocks. On by default; pinned so
    // an older or contrary configuration cannot change it.
    "--indent-heuristic",
    // `histogram`, `patience` and `minimal` pair lines differently, so the same
    // edit comes out as different hunks.
    "--diff-algorithm=myers",
    "--find-renames=50%",
    // Rename detection switches itself off above this many candidates, quietly
    // turning a rename into a delete plus an add.
    "-l1000",
    // `diff.mnemonicPrefix` and `diff.noprefix` would rewrite these as `i/`,
    // `w/`, `c/` or nothing.
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--no-relative",
    "--submodule=short",
    "--ignore-submodules=none",
];

/// The complete `git` argument list for capturing a diff, after any
/// configuration the caller already applies.
///
/// `revisions` is empty for the working tree, or the base and target of a
/// comparison.
pub fn diff_args(revisions: &[&str]) -> Vec<String> {
    let mut args: Vec<String> = CONFIG.iter().map(|arg| arg.to_string()).collect();
    args.push("diff".to_string());
    args.extend(FLAGS.iter().map(|flag| flag.to_string()));
    args.extend(revisions.iter().map(|revision| revision.to_string()));
    args.push("--".to_string());
    args.push(exclude_pathspec());
    args
}

/// What `CHANGE_INFO` records, so a file stays checkable even if this list
/// changes in a later Diff Trek.
pub fn recorded_args() -> Vec<String> {
    let mut args: Vec<String> = CONFIG.iter().map(|arg| arg.to_string()).collect();
    args.extend(FLAGS.iter().map(|flag| flag.to_string()));
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configuration_comes_before_the_subcommand_and_flags_after_it() {
        let args = diff_args(&[]);
        let subcommand = args.iter().position(|arg| arg == "diff").unwrap();

        assert!(args[..subcommand].chunks(2).all(|pair| pair[0] == "-c"));
        assert!(args[subcommand..].contains(&"--full-index".to_string()));
    }

    #[test]
    fn revisions_sit_between_the_flags_and_the_pathspec() {
        let args = diff_args(&["abc123", "def456"]);
        let separator = args.iter().position(|arg| arg == "--").unwrap();
        let base = args.iter().position(|arg| arg == "abc123").unwrap();

        assert!(base < separator);
        assert_eq!(args.last().unwrap(), &exclude_pathspec());
    }

    #[test]
    fn the_changelog_folder_is_excluded_from_the_repository_root() {
        // Anchored, or running from a subdirectory excludes the wrong folder
        // and puts every past changelog into the diff being annotated.
        assert_eq!(exclude_pathspec(), ":(top,exclude,literal).difftrek");
    }
}
