//! Command-line requests, answered without opening a window.
//!
//! `git dt --createchangelog="claude"` runs the executable in the foreground
//! precisely so this can print to the terminal that asked. Everything here
//! therefore writes plain text and returns an exit code, and the first line of
//! stdout is always the file's path so a caller can take it with `head -1`.

use crate::ai_changelog::service;
use crate::git::{repository, revision};
use crate::launch::{launch_target, CliRequest};

/// Nothing was written, because we were not told who is writing it.
const EXIT_USAGE: i32 = 2;
const EXIT_FAILED: i32 = 1;

pub fn execute(request: CliRequest) -> i32 {
    match request {
        CliRequest::CreateChangelog { author } => create_changelog(&author),
    }
}

fn create_changelog(author: &str) -> i32 {
    if author.is_empty() {
        eprintln!(
            "Name whoever is writing the notes, so a reader knows whose account\n\
             of the change they are reading:\n\n    \
             git dt --createchangelog=\"claude\""
        );
        return EXIT_USAGE;
    }

    let target = launch_target();

    let root = match repository::discover(&target.directory) {
        Ok(root) => root,
        Err(error) => return fail(&error),
    };

    let comparison = match revision::comparison_for(&root, &target.revisions) {
        Ok(Some(resolved)) => resolved.comparison,
        Ok(None) => Default::default(),
        Err(error) => return fail(&error),
    };

    let created = match service::create(&root, &comparison, author) {
        Ok(created) => created,
        Err(error) => return fail(&error),
    };

    // The contract: stdout begins with the path — a caller can take it with
    // `head -1` — and the instructions follow it there, for whoever reads the
    // whole output. Diagnostics go to stderr so they cannot be mistaken for
    // either.
    if let Some(note) = &created.ignored {
        eprintln!("{note}\n");
    }

    println!("{}", created.path.display());
    println!();
    println!("{}", instructions(&created.nonce, created.hunks));

    if !created.reaped.is_empty() {
        eprintln!(
            "\nRemoved {} changelog(s) over 200 days old.",
            created.reaped.len()
        );
    }

    0
}

/// What to do with the file, printed with it.
///
/// These live here rather than only in a project's `CLAUDE.md` so they cannot
/// go stale: the snippet a project keeps can stay one line long, and the tool
/// carries the detail that changes with the format.
fn instructions(nonce: &str, hunks: usize) -> String {
    format!(
        "{hunks} hunk(s) to explain. Fill in each placeholder:\n\n    \
         ~~DIFFTREK_AI:{nonce}:HUNK_REASON id=hN~~\n    \
         why this hunk exists — not what it does, the diff shows that\n    \
         ~~DIFFTREK_AI:{nonce}:/HUNK_REASON id=hN~~\n\n\
         Group the hunks belonging to one intent by wrapping them in\n    \
         ~~DIFFTREK_AI:{nonce}:LOGICAL_CHANGE_START id=0 /~~ … \
         ~~DIFFTREK_AI:{nonce}:LOGICAL_CHANGE_END id=0 /~~\n\
         and describe each id in the LOGICAL_CHANGE_TABLE block. A span may open\n\
         and close more than once, which is how one intent covers hunks 1 and 3\n\
         but not 2, and how it gets markers in each file it touches.\n\n\
         Edit only inside the tag blocks. Never retype the diff — one altered\n\
         space unmatches a hunk and loses its note — and do not quote a live\n\
         {nonce} tag inside a reason, which would end the block early."
    )
}

fn fail(error: &crate::error::AppError) -> i32 {
    eprintln!("{}", error.message);
    if let Some(detail) = &error.detail {
        eprintln!("{detail}");
    }
    EXIT_FAILED
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_with_no_author_writes_nothing() {
        assert_eq!(create_changelog(""), EXIT_USAGE);
    }

    #[test]
    fn the_instructions_carry_the_live_nonce_so_they_can_be_copied_as_they_are() {
        let text = instructions("AB99X7", 3);
        assert!(text.contains("~~DIFFTREK_AI:AB99X7:HUNK_REASON id=hN~~"));
        assert!(text.contains("3 hunk(s)"));
        assert!(text.contains("Never retype the diff"));
    }
}
