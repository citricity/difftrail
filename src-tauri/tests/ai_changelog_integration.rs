//! The AI changelog against a real repository.
//!
//! The unit tests cover the grammar and the matching rules on fixed strings;
//! what they cannot cover is Git itself — whether the captured diff is the diff
//! Git reports, whether the changelog folder really stays out of it, and
//! whether any of that survives being run from a subdirectory.

use diff_trek_lib::ai_changelog::{format, matching, service, storage};
use diff_trek_lib::git::revision::Comparison;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

struct Repo {
    root: PathBuf,
}

impl Repo {
    /// A repository with one commit, and `.difftrek/` excluded locally — which
    /// is what `--createchangelog` insists on before it writes anything.
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("difftrek-changelog-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();

        let repo = Self { root };
        repo.git(&["init", "--initial-branch=main"]);
        repo.git(&["config", "user.email", "test@example.com"]);
        repo.git(&["config", "user.name", "Diff Trek Test"]);

        repo.write("src/one.ts", "one();\ntwo();\nthree();\nfour();\nfive();\n");
        repo.write("src/two.ts", "alpha();\nbeta();\n");
        repo.git(&["add", "-A"]);
        repo.git(&["commit", "-m", "base"]);

        repo.exclude_changelogs();
        repo
    }

    fn git(&self, args: &[&str]) -> String {
        self.git_in(&self.root, args)
    }

    fn git_in(&self, cwd: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .env("LC_ALL", "C")
            .output()
            .expect("git");
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    /// Locally, not in `.gitignore`: editing a tracked file would put a change
    /// into the very diff under review.
    fn exclude_changelogs(&self) {
        let exclude = self.root.join(".git/info/exclude");
        fs::create_dir_all(exclude.parent().unwrap()).unwrap();
        fs::write(&exclude, ".difftrek/\n").unwrap();
    }

    fn write(&self, path: &str, contents: &str) {
        let full = self.root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, contents).unwrap();
    }

    fn read_changelog(&self, nonce: &str) -> String {
        fs::read_to_string(storage::path_for(&self.root, nonce)).unwrap()
    }

    /// Fills one placeholder the way an agent is told to: one exact-match
    /// replacement, never a rewrite of the file.
    fn explain(&self, nonce: &str, id: &str, reason: &str) {
        let path = storage::path_for(&self.root, nonce);
        let text = fs::read_to_string(&path).unwrap();
        let open = format!("~~DIFFTREK_AI:{nonce}:HUNK_REASON id={id}~~");
        let close = format!("~~DIFFTREK_AI:{nonce}:/HUNK_REASON id={id}~~");
        let filled = text.replace(
            &format!("{open}\n{close}"),
            &format!("{open}\n{reason}\n{close}"),
        );
        assert_ne!(filled, text, "placeholder {id} not found");
        fs::write(path, filled).unwrap();
    }
}

fn create(repo: &Repo) -> service::Created {
    service::create(&repo.root, &Comparison::WorkingTree, "claude").expect("create")
}

#[test]
fn the_captured_diff_is_the_diff_git_reports() {
    let repo = Repo::new("captures");
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");

    let created = create(&repo);
    let changelog = format::parse(&repo.read_changelog(&created.nonce)).unwrap();

    // Stripped of every tag, the file is what Git would print now — which is
    // the whole reason the format is an annotated diff rather than a sidecar.
    let live = service::capture_diff(&repo.root, &Comparison::WorkingTree).unwrap();
    assert_eq!(changelog.clean_diff, live);
    assert!(changelog.complete);
    assert_eq!(created.hunks, 1);
    assert_eq!(changelog.info.author.as_deref(), Some("claude"));
}

#[test]
fn a_users_own_git_configuration_cannot_change_the_capture() {
    let repo = Repo::new("hostile-config");
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");

    let before = service::capture_diff(&repo.root, &Comparison::WorkingTree).unwrap();

    // Every one of these changes `git diff` output on its own.
    repo.git(&["config", "diff.context", "7"]);
    repo.git(&["config", "diff.algorithm", "histogram"]);
    repo.git(&["config", "diff.noprefix", "true"]);
    repo.git(&["config", "diff.mnemonicPrefix", "true"]);
    repo.git(&["config", "diff.suppressBlankEmpty", "true"]);
    repo.git(&["config", "color.ui", "always"]);
    repo.git(&["config", "diff.renames", "copies"]);

    let after = service::capture_diff(&repo.root, &Comparison::WorkingTree).unwrap();

    assert_eq!(before, after);
    assert!(before.contains("--- a/src/one.ts"));
    assert!(!before.contains('\u{1b}'));
}

#[test]
fn changelogs_never_appear_in_the_diff_they_annotate() {
    let repo = Repo::new("excluded");
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");

    let first = create(&repo);
    // Intent-to-add is what would otherwise put these into `git diff`: an
    // untracked file is invisible to a diff until someone stages it, and
    // `--force` is how an ignored one gets there by accident.
    repo.git(&["add", "-N", "--force", ".difftrek"]);

    let captured = service::capture_diff(&repo.root, &Comparison::WorkingTree).unwrap();

    assert!(!captured.contains(&first.nonce));
    assert!(!captured.contains(".difftrek"));
    assert!(captured.contains("src/one.ts"));
}

#[test]
fn the_exclusion_holds_when_run_from_a_subdirectory() {
    // Pathspecs resolve against the current directory, and `git dt` is normally
    // run from somewhere inside the repository rather than at its root.
    let repo = Repo::new("subdirectory");
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");
    create(&repo);
    repo.git(&["add", "-N", "--force", "."]);

    let nested = repo.root.join("src");
    let from_nested = service::capture_diff(&nested, &Comparison::WorkingTree).unwrap();

    assert!(!from_nested.contains(".difftrek"));
    assert!(from_nested.contains("src/one.ts"));
}

#[test]
fn nothing_is_written_until_the_folder_is_ignored() {
    let repo = Repo::new("unignored");
    fs::write(repo.root.join(".git/info/exclude"), "").unwrap();
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");

    let error = service::create(&repo.root, &Comparison::WorkingTree, "claude").unwrap_err();

    assert!(error.message.contains(".git/info/exclude"));
    assert!(storage::list(&repo.root).is_empty());
}

#[test]
fn an_already_tracked_folder_is_reported_differently() {
    let repo = Repo::new("tracked");
    repo.write(".difftrek/ai_changelog/OLDONE.log", "committed by mistake\n");
    repo.git(&["add", "--force", ".difftrek"]);
    repo.git(&["commit", "-m", "oops"]);

    let error = service::create(&repo.root, &Comparison::WorkingTree, "claude").unwrap_err();

    assert!(error.message.contains("--cached"), "{}", error.message);
}

#[test]
fn a_filled_changelog_is_found_and_applied_to_the_diff() {
    let repo = Repo::new("loads");
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");
    repo.write("src/two.ts", "alpha();\nBETA();\n");

    assert!(service::load(&repo.root, &Comparison::WorkingTree).is_none());

    let created = create(&repo);
    repo.explain(&created.nonce, "h1", "three() is spelled in caps by the API now");

    let loaded = service::load(&repo.root, &Comparison::WorkingTree).expect("loaded");

    assert_eq!(loaded.nonce, created.nonce);
    assert_eq!(
        loaded.annotations.hunks["src/one.ts:hunk:0"].reasons,
        ["three() is spelled in caps by the API now"]
    );
    // The second file was left unexplained, which is a signal, not a failure.
    assert!(loaded.annotations.hunks["src/two.ts:hunk:0"].is_unexplained());
    assert_eq!(loaded.annotations.summary.matched, 2);
    assert_eq!(loaded.annotations.summary.unexplained, 1);
}

#[test]
fn editing_the_code_afterwards_keeps_the_notes_that_still_fit() {
    let repo = Repo::new("drift");
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");
    repo.write("src/two.ts", "alpha();\nBETA();\n");

    let created = create(&repo);
    repo.explain(&created.nonce, "h1", "caps in one.ts");
    repo.explain(&created.nonce, "h2", "caps in two.ts");

    // The developer comes back and changes one of the two files again.
    repo.write("src/two.ts", "alpha();\nGAMMA();\n");

    let loaded = service::load(&repo.root, &Comparison::WorkingTree).expect("loaded");
    let summary = &loaded.annotations.summary;

    assert!(!summary.is_complete());
    assert_eq!(summary.matched, 1);
    assert_eq!(summary.changed_since(), 1);
    assert_eq!(summary.stale_notes, 1);
    assert_eq!(
        loaded.annotations.hunks["src/one.ts:hunk:0"].reasons,
        ["caps in one.ts"]
    );
    // Not called unexplained: it is the reader's own later edit.
    assert!(!loaded.annotations.hunks.contains_key("src/two.ts:hunk:0"));
}

#[test]
fn an_edit_elsewhere_in_the_file_keeps_the_note() {
    let repo = Repo::new("line-numbers");
    repo.write(
        "src/long.ts",
        &(1..=40)
            .map(|line| format!("line{line}();\n"))
            .collect::<String>(),
    );
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-m", "long"]);

    let with_change = |top: &str, line20: &str| {
        let body: String = (1..=40)
            .map(|line| match line {
                1 => top.to_string(),
                20 => line20.to_string(),
                other => format!("line{other}();\n"),
            })
            .collect();
        body
    };

    repo.write("src/long.ts", &with_change("line1();\n", "LINE20();\n"));
    let created = create(&repo);
    repo.explain(&created.nonce, "h1", "line 20 is shouted now");

    // The reader edits the top of the file. Every line number below moves, and
    // a second hunk appears — but the annotated hunk's own lines do not change.
    repo.write("src/long.ts", &with_change("LINE1();\n", "LINE20();\n"));

    let loaded = service::load(&repo.root, &Comparison::WorkingTree).expect("loaded");

    assert_eq!(
        loaded.annotations.hunks["src/long.ts:hunk:1"].reasons,
        ["line 20 is shouted now"]
    );
    assert_eq!(loaded.annotations.summary.changed_since(), 1);
}

#[test]
fn an_edit_that_merges_into_the_hunk_reads_as_changed_since() {
    // The limit of content matching, recorded deliberately. Inserting a line
    // within a few lines of the AI's change puts it inside the same hunk, so
    // the hunk's changed lines are no longer the ones the note was written for
    // and the note is not shown. Saying "this changed since" is truthful;
    // showing the note anyway would be the one thing matching must never do.
    let repo = Repo::new("merged-edit");
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");

    let created = create(&repo);
    repo.explain(&created.nonce, "h1", "caps in one.ts");

    repo.write(
        "src/one.ts",
        "inserted();\none();\ntwo();\nTHREE();\nfour();\nfive();\n",
    );

    let loaded = service::load(&repo.root, &Comparison::WorkingTree).expect("loaded");

    assert!(loaded.annotations.hunks.is_empty());
    assert_eq!(loaded.annotations.summary.changed_since(), 1);
    assert_eq!(loaded.annotations.summary.stale_notes, 1);
}

#[test]
fn the_newest_changelog_that_still_matches_is_preferred() {
    let repo = Repo::new("selection");
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");

    let stale = create(&repo);
    repo.explain(&stale.nonce, "h1", "written before the last edit");

    // The code moves on, and a second changelog is written for the new state.
    repo.write("src/one.ts", "one();\ntwo();\nTHIRD();\nfour();\nfive();\n");
    let fresh = create(&repo);
    repo.explain(&fresh.nonce, "h1", "written for what is here now");

    let loaded = service::load(&repo.root, &Comparison::WorkingTree).expect("loaded");

    assert_eq!(loaded.nonce, fresh.nonce);
    assert!(loaded.annotations.summary.is_complete());
}

#[test]
fn a_truncated_changelog_is_not_trusted() {
    let repo = Repo::new("truncated");
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");

    let created = create(&repo);
    repo.explain(&created.nonce, "h1", "caps in one.ts");

    // The author stopped early, or the write was interrupted.
    let path = storage::path_for(&repo.root, &created.nonce);
    let text = fs::read_to_string(&path).unwrap();
    let without_end: String = text
        .lines()
        .filter(|line| !line.ends_with(":END~~"))
        .map(|line| format!("{line}\n"))
        .collect();
    fs::write(&path, without_end).unwrap();

    assert!(service::load(&repo.root, &Comparison::WorkingTree).is_none());
}

#[test]
fn a_changelog_of_a_change_to_this_format_parses_as_a_diff() {
    // The pathological case: annotating a change that adds tag lines to a file.
    let repo = Repo::new("self-referential");
    repo.write(
        "docs/format.md",
        "Example:\n~~DIFFTREK_AI:ZZZZZZ:HUNK_REASON id=h1~~\nwhy\n~~DIFFTREK_AI:ZZZZZZ:/HUNK_REASON id=h1~~\n",
    );
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-m", "docs"]);
    repo.write(
        "docs/format.md",
        "Example:\n~~DIFFTREK_AI:ZZZZZZ:HUNK_REASON id=h1~~\nbecause\n~~DIFFTREK_AI:ZZZZZZ:/HUNK_REASON id=h1~~\n",
    );

    let created = create(&repo);
    repo.explain(&created.nonce, "h1", "the example now says because");

    let changelog = format::parse(&repo.read_changelog(&created.nonce)).unwrap();
    let live = service::capture_diff(&repo.root, &Comparison::WorkingTree).unwrap();

    assert_eq!(changelog.clean_diff, live);
    assert_ne!(changelog.nonce, "ZZZZZZ");
    let annotations = matching::annotate(&changelog, &live);
    assert_eq!(
        annotations.hunks["docs/format.md:hunk:0"].reasons,
        ["the example now says because"]
    );
}

#[test]
fn a_changelog_written_for_a_commit_is_not_shown_for_the_working_tree() {
    let repo = Repo::new("comparison");
    repo.write("src/one.ts", "one();\ntwo();\nTHREE();\nfour();\nfive();\n");
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-m", "caps"]);

    let head = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
    let parent = repo.git(&["rev-parse", "HEAD^"]).trim().to_string();
    let commits = Comparison::Commits {
        base: parent,
        target: head,
    };

    let created = service::create(&repo.root, &commits, "claude").unwrap();
    repo.explain(&created.nonce, "h1", "caps, as committed");

    assert!(service::load(&repo.root, &commits).is_some());
    // Nothing is unstaged now, but the point stands: these are different diffs
    // and a changelog for one must not be offered for the other.
    repo.write("src/two.ts", "alpha();\nBETA();\n");
    assert!(service::load(&repo.root, &Comparison::WorkingTree).is_none());
}

#[test]
fn a_binary_file_does_not_break_the_capture() {
    let repo = Repo::new("binary");
    fs::write(repo.root.join("logo.bin"), [0u8, 159, 146, 150]).unwrap();
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-m", "binary"]);
    fs::write(repo.root.join("logo.bin"), [0u8, 1, 2, 3]).unwrap();

    let created = create(&repo);
    let changelog = format::parse(&repo.read_changelog(&created.nonce)).unwrap();

    // "Binary files … differ" is a translated string; the capture pins the
    // locale so it cannot arrive in the user's language and unmatch everything.
    assert!(changelog.clean_diff.contains("Binary files"));
    assert_eq!(created.hunks, 0);
}
