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
        "\
{hunks} hunk(s) to explain.

1. Give every hunk a reason. Fill in each placeholder with why that hunk
   exists — not what it does, the diff shows that:

    ~~DIFFTREK_AI:{nonce}:HUNK_REASON id=hN~~
    why this hunk exists
    ~~DIFFTREK_AI:{nonce}:/HUNK_REASON id=hN~~

2. Put every hunk inside at least one logical change — one intent, covering
   however many hunks serve it:

    ~~DIFFTREK_AI:{nonce}:LOGICAL_CHANGE_START id=0 /~~
    … the hunks that serve it …
    ~~DIFFTREK_AI:{nonce}:LOGICAL_CHANGE_END id=0 /~~

   A hunk joins whichever spans are open when its @@ line is read, so open a
   span above an @@ line and close it after the last line of the hunk it
   ends. A span may open and close more than once, which is how one intent
   covers hunks 1 and 3 but not 2, and how it gets its own markers in each
   file it touches. Spans may overlap, so a hunk can serve two intents.

   Leave no hunk outside every span. A hunk that shares its intent with no
   other hunk still gets a span of its own, and unrelated hunks are never
   grouped together to avoid one.

3. Describe every id you opened in the LOGICAL_CHANGE_TABLE block:

    [{{\"id\": \"0\", \"description\": \"…\", \"associatedIssues\": []}}]

   The description is a headline: one sentence saying what the change sets
   out to do, short enough to read in a list. The reasoning belongs in the
   hunk reasons, not here.

Edit only inside the tag blocks. Never retype the diff — one altered space
unmatches a hunk and loses its note — and do not quote a live {nonce} tag
inside a reason, which would end the block early."
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
        assert!(text.contains("Leave no hunk outside every span"));
    }

    /// The script has to print the same instructions as the app: an agent in a
    /// container and an agent on the desktop must write the same file. The
    /// prose is duplicated because the script runs where this crate cannot.
    #[test]
    fn the_script_prints_the_same_instructions() {
        let script = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../scripts/difftrek-changelog.sh"
        ))
        .expect("scripts/difftrek-changelog.sh");

        const OPEN: &str = "cat <<INSTRUCTIONS\n";
        let body = &script[script.find(OPEN).expect("the heredoc") + OPEN.len()..];
        let end = body.find("\nINSTRUCTIONS\n").expect("the heredoc terminator");

        // The heredoc is unquoted, so the shell expands these as it prints.
        let printed = body[..end]
            .replace("$MARKER", "~~DIFFTREK_AI")
            .replace("$nonce", "AB99X7")
            .replace("$hunks", "3");

        assert_eq!(printed, instructions("AB99X7", 3));
    }
}
