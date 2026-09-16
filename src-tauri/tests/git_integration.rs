//! End-to-end checks against a real `git` process.
//!
//! The unit tests in `git::parse` pin the parser against captured output;
//! these build an actual repository and assert that Diff Trail reads it the
//! way the design requires — in particular that staged changes are excluded
//! and untracked files never appear.

use diff_trail_lib::git::model::FileStatus;
use diff_trail_lib::git::repository::{
    changed_files, discover, file_diff, image_bytes, Side, DEFAULT_MAX_DIFF_BYTES,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("difftrail-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create fixture dir");

        let fixture = Self { root };
        fixture.git(&["init", "--quiet", "--initial-branch=main"]);
        fixture.git(&["config", "user.email", "test@difftrail.local"]);
        fixture.git(&["config", "user.name", "Diff Trail Test"]);
        fixture
    }

    fn git(&self, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.root)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn write(&self, path: &str, contents: &str) {
        let full = self.root.join(path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        fs::write(full, contents).expect("write fixture file");
    }

    fn commit_all(&self, message: &str) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "--quiet", "-m", message]);
    }

    fn path(&self) -> &Path {
        &self.root
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn discovers_the_working_tree_root_from_a_subdirectory() {
    let fixture = Fixture::new("discover");
    fixture.write("src/deep/a.txt", "one\n");
    fixture.commit_all("initial");

    let from_subdir = discover(&fixture.path().join("src/deep")).expect("discover root");

    // macOS reports /var and /private/var for the same directory.
    assert!(
        from_subdir.ends_with(fixture.path().file_name().unwrap()),
        "expected {} to end with the fixture directory name",
        from_subdir.display()
    );
}

#[test]
fn reports_unstaged_modifications_to_tracked_files() {
    let fixture = Fixture::new("unstaged");
    fixture.write("a.txt", "one\ntwo\nthree\n");
    fixture.commit_all("initial");
    fixture.write("a.txt", "one\nTWO\nthree\n");

    let files = changed_files(fixture.path()).expect("list changed files");

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "a.txt");
    assert_eq!(files[0].status, FileStatus::Modified);
    assert_eq!(files[0].additions, Some(1));
    assert_eq!(files[0].deletions, Some(1));
}

#[test]
fn excludes_staged_changes() {
    let fixture = Fixture::new("staged");
    fixture.write("staged.txt", "original\n");
    fixture.write("unstaged.txt", "original\n");
    fixture.commit_all("initial");

    fixture.write("staged.txt", "changed and staged\n");
    fixture.git(&["add", "staged.txt"]);
    fixture.write("unstaged.txt", "changed only on disk\n");

    let files = changed_files(fixture.path()).expect("list changed files");
    let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();

    assert_eq!(
        paths,
        vec!["unstaged.txt"],
        "a fully staged change must not appear in the working-tree diff"
    );
}

#[test]
fn shows_the_unstaged_remainder_of_a_partially_staged_file() {
    let fixture = Fixture::new("partial");
    fixture.write("a.txt", "one\ntwo\n");
    fixture.commit_all("initial");

    fixture.write("a.txt", "ONE\ntwo\n");
    fixture.git(&["add", "a.txt"]);
    fixture.write("a.txt", "ONE\nTWO\n");

    let files = changed_files(fixture.path()).expect("list changed files");
    assert_eq!(files.len(), 1);

    let diff = file_diff(fixture.path(), &files[0], DEFAULT_MAX_DIFF_BYTES).expect("load diff");
    let added: Vec<&str> = diff.hunks[0]
        .lines
        .iter()
        .filter(|line| matches!(line.kind, diff_trail_lib::git::model::LineKind::Add))
        .map(|line| line.content.as_str())
        .collect();

    // Only the second edit is unstaged, so only it is shown.
    assert_eq!(added, vec!["TWO"]);
}

#[test]
fn ignores_untracked_files() {
    let fixture = Fixture::new("untracked");
    fixture.write("tracked.txt", "original\n");
    fixture.commit_all("initial");

    fixture.write("tracked.txt", "edited\n");
    fixture.write("brand-new.txt", "never added\n");

    let files = changed_files(fixture.path()).expect("list changed files");
    let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();

    assert_eq!(paths, vec!["tracked.txt"]);
}

#[test]
fn reports_deleted_tracked_files() {
    let fixture = Fixture::new("deleted");
    fixture.write("gone.txt", "one\ntwo\n");
    fixture.commit_all("initial");
    fs::remove_file(fixture.path().join("gone.txt")).expect("delete file");

    let files = changed_files(fixture.path()).expect("list changed files");

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].status, FileStatus::Deleted);

    let diff = file_diff(fixture.path(), &files[0], DEFAULT_MAX_DIFF_BYTES).expect("load diff");
    assert_eq!(diff.deletions, 2);
    assert_eq!(diff.additions, 0);
}

#[test]
fn parses_multiple_hunks_with_stable_ids_and_correct_line_numbers() {
    let fixture = Fixture::new("hunks");
    let original: String = (1..=40).map(|n| format!("line {n}\n")).collect();
    fixture.write("big.txt", &original);
    fixture.commit_all("initial");

    let edited: String = (1..=40)
        .map(|n| match n {
            5 => "line 5 CHANGED\n".to_string(),
            30 => "line 30 CHANGED\n".to_string(),
            _ => format!("line {n}\n"),
        })
        .collect();
    fixture.write("big.txt", &edited);

    let files = changed_files(fixture.path()).expect("list changed files");
    let diff = file_diff(fixture.path(), &files[0], DEFAULT_MAX_DIFF_BYTES).expect("load diff");

    // Two edits, far enough apart that Git emits two separate hunks.
    assert_eq!(diff.hunks.len(), 2);
    assert_eq!(diff.hunks[0].id, "big.txt:hunk:0");
    assert_eq!(diff.hunks[1].id, "big.txt:hunk:1");
    assert_eq!(diff.additions, 2);
    assert_eq!(diff.deletions, 2);

    let changed_line = diff.hunks[0]
        .lines
        .iter()
        .find(|line| line.content.ends_with("CHANGED"))
        .expect("find the edited line");
    assert_eq!(changed_line.new_line_number, Some(5));
}

#[test]
fn flags_binary_files_without_attempting_to_parse_them() {
    let fixture = Fixture::new("binary");
    fs::create_dir_all(fixture.path()).ok();
    fs::write(fixture.path().join("blob.bin"), [0u8, 1, 2, 3, 0, 255, 7]).expect("write binary");
    fixture.commit_all("initial");
    fs::write(fixture.path().join("blob.bin"), [9u8, 9, 9, 0, 1, 2, 3]).expect("edit binary");

    let files = changed_files(fixture.path()).expect("list changed files");

    assert_eq!(files.len(), 1);
    assert!(files[0].binary);
    assert_eq!(files[0].additions, None);

    let diff = file_diff(fixture.path(), &files[0], DEFAULT_MAX_DIFF_BYTES).expect("load diff");
    assert!(diff.binary);
    assert!(diff.hunks.is_empty());
}

#[test]
fn handles_paths_with_spaces_and_non_ascii_characters() {
    let fixture = Fixture::new("paths");
    fixture.write("src/my file — ünicode.txt", "one\n");
    fixture.commit_all("initial");
    fixture.write("src/my file — ünicode.txt", "two\n");

    let files = changed_files(fixture.path()).expect("list changed files");

    assert_eq!(files.len(), 1);
    assert_eq!(
        files[0].path, "src/my file — ünicode.txt",
        "core.quotepath=false must keep the path readable"
    );

    let diff = file_diff(fixture.path(), &files[0], DEFAULT_MAX_DIFF_BYTES).expect("load diff");
    assert_eq!(diff.hunks.len(), 1);
}

#[test]
fn truncates_a_diff_that_exceeds_the_byte_budget() {
    let fixture = Fixture::new("truncate");
    fixture.write("big.txt", "seed\n");
    fixture.commit_all("initial");

    let huge: String = (0..5000).map(|n| format!("generated line {n}\n")).collect();
    fixture.write("big.txt", &huge);

    let files = changed_files(fixture.path()).expect("list changed files");
    let diff = file_diff(fixture.path(), &files[0], 1024).expect("load diff");

    assert!(diff.truncated);
    assert!(diff.hunks.is_empty(), "a truncated diff carries no hunks");

    // The same file loads fine when the budget allows it.
    let full = file_diff(fixture.path(), &files[0], DEFAULT_MAX_DIFF_BYTES).expect("load diff");
    assert!(!full.truncated);
    assert!(!full.hunks.is_empty());
}

#[test]
fn reports_a_file_with_no_trailing_newline() {
    let fixture = Fixture::new("newline");
    fixture.write("a.txt", "one\n");
    fixture.commit_all("initial");
    fixture.write("a.txt", "one\ntwo");

    let files = changed_files(fixture.path()).expect("list changed files");
    let diff = file_diff(fixture.path(), &files[0], DEFAULT_MAX_DIFF_BYTES).expect("load diff");

    let last = diff.hunks[0].lines.last().expect("a last line");
    assert_eq!(last.content, "two");
    assert!(last.no_newline);
}

#[test]
fn an_unchanged_repository_reports_no_files() {
    let fixture = Fixture::new("clean");
    fixture.write("a.txt", "one\n");
    fixture.commit_all("initial");

    let files = changed_files(fixture.path()).expect("list changed files");
    assert!(files.is_empty());
}

#[test]
fn reads_both_sides_of_a_changed_image_byte_for_byte() {
    let fixture = Fixture::new("image-sides");
    // Not real PNGs, and they need not be: what matters is that the bytes,
    // including a NUL and invalid UTF-8, come back exactly as stored.
    let before: &[u8] = b"\x89PNG\r\n\x1a\n\x00before\xff";
    let after: &[u8] = b"\x89PNG\r\n\x1a\n\x00after\xfe\xff";

    fs::write(fixture.path().join("icon.png"), before).unwrap();
    fixture.commit_all("add icon");
    fs::write(fixture.path().join("icon.png"), after).unwrap();

    let root = discover(fixture.path()).unwrap();
    assert_eq!(image_bytes(&root, "icon.png", Side::Original).unwrap(), before);
    assert_eq!(image_bytes(&root, "icon.png", Side::Working).unwrap(), after);
}
