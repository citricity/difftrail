//! Where changelogs live on disk.
//!
//! `.difftrek/ai_changelog/<nonce>.log`, inside the repository and ignored by
//! it. The nonce is the file name, so a file identifies itself and a stray
//! fragment can be traced back to one.
//!
//! Split from the command layer so the rules — which file to read, what to
//! reap — are testable without a repository or a running app.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Relative to the repository root.
pub const DIR: &str = ".difftrek/ai_changelog";

/// Changelogs are working notes, not history: anything worth keeping has been
/// attached to its commit with `git notes` long before this.
pub const MAX_AGE: Duration = Duration::from_secs(200 * 24 * 60 * 60);

const EXTENSION: &str = "log";

pub fn dir(root: &Path) -> PathBuf {
    root.join(DIR)
}

pub fn path_for(root: &Path, nonce: &str) -> PathBuf {
    dir(root).join(format!("{nonce}.{EXTENSION}"))
}

/// One changelog on disk, without its contents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub nonce: String,
    pub path: PathBuf,
    pub modified: SystemTime,
}

/// Every changelog in the repository, newest first.
///
/// A missing folder is not an error: it means nobody has written one yet.
pub fn list(root: &Path) -> Vec<Entry> {
    let Ok(entries) = fs::read_dir(dir(root)) else {
        return Vec::new();
    };

    let mut found: Vec<Entry> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some(EXTENSION) {
                return None;
            }

            Some(Entry {
                nonce: path.file_stem()?.to_str()?.to_string(),
                modified: entry.metadata().ok()?.modified().ok()?,
                path,
            })
        })
        .collect();

    found.sort_by(|left, right| right.modified.cmp(&left.modified));
    found
}

/// Writes a changelog, creating the folder if it is not there.
pub fn write(root: &Path, nonce: &str, contents: &str) -> io::Result<PathBuf> {
    let path = path_for(root, nonce);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, contents)?;
    Ok(path)
}

/// Deletes changelogs older than `max_age`, returning the nonces removed.
///
/// Runs when a changelog is created, so there is no daemon and nothing to pay
/// for at startup. A file whose age cannot be determined is left alone: the
/// cost of keeping it is a few kilobytes, the cost of the alternative is
/// deleting someone's notes.
pub fn reap(root: &Path, now: SystemTime, max_age: Duration) -> Vec<String> {
    list(root)
        .into_iter()
        .filter(|entry| {
            now.duration_since(entry.modified)
                .map(|age| age > max_age)
                .unwrap_or(false)
        })
        .filter(|entry| fs::remove_file(&entry.path).is_ok())
        .map(|entry| entry.nonce)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch directory of our own, so these tests need no repository.
    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("difftrek-storage-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(dir(&root)).unwrap();
        root
    }

    fn age(path: &Path, age: Duration) {
        let when = SystemTime::now() - age;
        let file = fs::File::options().write(true).open(path).unwrap();
        file.set_modified(when).unwrap();
    }

    #[test]
    fn a_missing_folder_is_no_changelogs_rather_than_an_error() {
        let root = std::env::temp_dir().join("difftrek-storage-absent");
        let _ = fs::remove_dir_all(&root);
        assert!(list(&root).is_empty());
    }

    #[test]
    fn changelogs_are_listed_newest_first_and_named_by_their_nonce() {
        let root = scratch("listing");
        write(&root, "AAAAAA", "one").unwrap();
        write(&root, "BBBBBB", "two").unwrap();
        age(&path_for(&root, "AAAAAA"), Duration::from_secs(60));

        let found = list(&root);
        let nonces: Vec<_> = found.iter().map(|entry| entry.nonce.as_str()).collect();

        assert_eq!(nonces, ["BBBBBB", "AAAAAA"]);
    }

    #[test]
    fn other_files_in_the_folder_are_ignored() {
        let root = scratch("strays");
        write(&root, "AAAAAA", "one").unwrap();
        fs::write(dir(&root).join("README.md"), "notes about notes").unwrap();

        assert_eq!(list(&root).len(), 1);
    }

    #[test]
    fn reaping_removes_only_what_is_older_than_the_limit() {
        let root = scratch("reaping");
        write(&root, "OLDONE", "stale").unwrap();
        write(&root, "NEWONE", "fresh").unwrap();
        age(&path_for(&root, "OLDONE"), MAX_AGE + Duration::from_secs(60));

        let removed = reap(&root, SystemTime::now(), MAX_AGE);

        assert_eq!(removed, ["OLDONE"]);
        assert!(path_for(&root, "NEWONE").exists());
        assert!(!path_for(&root, "OLDONE").exists());
    }
}
