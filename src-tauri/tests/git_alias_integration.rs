//! The `git dt` alias, installed and then actually run.
//!
//! The unit tests pin the string; this pins what matters, which is that Git
//! stores it and a shell runs it with the executable's path intact. The
//! executable here is a stand-in script whose path contains a space, a double
//! quote and a `$`, and which records the argument it was given.

#![cfg(unix)]

use diff_trail_lib::git_alias::{alias_value, install, status, ConfigTarget};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

fn git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git").args(args).current_dir(cwd).output().unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("difftrail-alias-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    // Canonical, because on macOS the temp dir is behind a symlink and
    // `git rev-parse --show-toplevel` reports the real path.
    fs::canonicalize(&dir).unwrap()
}

#[test]
fn installs_an_alias_that_launches_the_binary_on_the_repository_root() {
    let base = scratch("run");

    let tools = base.join(r#"Diff "Trail" $HOME"#);
    fs::create_dir_all(&tools).unwrap();
    let record = base.join("launched-with.txt");
    let binary = tools.join("diff-trail");
    fs::write(
        &binary,
        format!("#!/bin/sh\nprintf '%s' \"$1\" > '{}'\n", record.display()),
    )
    .unwrap();
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
    let binary = binary.to_str().unwrap().to_owned();

    let repo = base.join("repo");
    fs::create_dir_all(repo.join("nested/deeper")).unwrap();
    git(&repo, &["init", "--quiet"]);

    // The repository's own config, so the real global one is never touched.
    let target = ConfigTarget::File(repo.join(".git/config"));

    let before = status(&binary, &target).unwrap();
    assert_eq!(before.existing, None);
    assert!(!before.installed);

    let after = install(&binary, &target).unwrap();
    assert!(after.installed);
    assert_eq!(after.existing.as_deref(), Some(alias_value(&binary).as_str()));

    // Run from a subdirectory: the alias must pass the root, not where we are.
    git(&repo.join("nested/deeper"), &["dt"]);

    // The alias backgrounds the launch, so wait for it.
    let deadline = Instant::now() + Duration::from_secs(10);
    while !record.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    std::thread::sleep(Duration::from_millis(100));

    assert_eq!(fs::read_to_string(&record).unwrap(), repo.to_str().unwrap());
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn replaces_an_existing_dt_alias_and_reports_it_first() {
    let base = scratch("replace");
    let config = base.join("config");
    fs::write(&config, "[alias]\n\tdt = difftool --dir-diff\n").unwrap();
    let target = ConfigTarget::File(config);

    let before = status("/opt/diff-trail", &target).unwrap();
    assert_eq!(before.existing.as_deref(), Some("difftool --dir-diff"));
    assert!(!before.installed);

    assert!(install("/opt/diff-trail", &target).unwrap().installed);
    let _ = fs::remove_dir_all(&base);
}
