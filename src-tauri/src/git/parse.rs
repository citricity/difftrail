//! Parsers for Git's porcelain output.
//!
//! Everything in this module is pure: it takes the bytes Git printed and
//! returns domain types. No process execution, no filesystem access, so the
//! tricky parts (NUL-separated records, rename pairs, hunk line numbering)
//! are unit-testable in isolation.

use super::model::{ChangedFile, DiffHunk, DiffLine, FileDiff, FileStatus, LineKind};

/// Builds the stable logical id for a hunk, e.g. `src/foo.ts:hunk:0`.
///
/// The frontend's navigation index keys off these, so the format is shared
/// with `src/lib/ids.ts` and must not drift.
pub fn hunk_id(path: &str, index: usize) -> String {
    format!("{path}:hunk:{index}")
}

/// Splits `git ... -z` output into records, discarding the trailing empty
/// fragment that follows the final NUL.
fn nul_fields(raw: &str) -> Vec<&str> {
    raw.split('\0').filter(|field| !field.is_empty()).collect()
}

/// Parses `git diff --name-status -z`.
///
/// Records are two NUL-separated fields (`M`, path) except for renames and
/// copies, which are three (`R100`, old, new).
pub fn parse_name_status(raw: &str) -> Vec<(FileStatus, Option<String>, String)> {
    let fields = nul_fields(raw);
    let mut out = Vec::new();
    let mut i = 0;

    while i < fields.len() {
        let code = fields[i];
        let Some(status) = code.chars().next().and_then(FileStatus::from_code) else {
            // Unknown status (e.g. `U` for unmerged). Skip its path field too,
            // rather than letting the record boundary slip.
            i += 2;
            continue;
        };

        if status.has_old_path() {
            if i + 2 >= fields.len() {
                break;
            }
            out.push((
                status,
                Some(fields[i + 1].to_string()),
                fields[i + 2].to_string(),
            ));
            i += 3;
        } else {
            if i + 1 >= fields.len() {
                break;
            }
            out.push((status, None, fields[i + 1].to_string()));
            i += 2;
        }
    }

    out
}

/// One row of `git diff --numstat -z`: additions, deletions and the path the
/// counts belong to. `None` counts mean Git printed `-`, i.e. a binary file.
#[derive(Debug, PartialEq, Eq)]
pub struct NumstatEntry {
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub path: String,
}

/// Parses `git diff --numstat -z`.
///
/// A normal record is a single field `"<add>\t<del>\t<path>"`. A rename
/// record ends after the second tab and is followed by two more fields
/// holding the old and new paths.
pub fn parse_numstat(raw: &str) -> Vec<NumstatEntry> {
    let fields = nul_fields(raw);
    let mut out = Vec::new();
    let mut i = 0;

    while i < fields.len() {
        let field = fields[i];
        let mut parts = field.splitn(3, '\t');

        let (Some(add), Some(del), Some(rest)) = (parts.next(), parts.next(), parts.next()) else {
            i += 1;
            continue;
        };

        let count = |value: &str| -> Option<u32> {
            if value == "-" {
                None
            } else {
                value.parse().ok()
            }
        };

        // An empty tail means the paths live in the following two fields.
        let path = if rest.is_empty() {
            if i + 2 >= fields.len() {
                break;
            }
            let new_path = fields[i + 2].to_string();
            i += 3;
            new_path
        } else {
            i += 1;
            rest.to_string()
        };

        out.push(NumstatEntry {
            additions: count(add),
            deletions: count(del),
            path,
        });
    }

    out
}

/// Merges the two listings into the changed-file metadata the UI consumes.
///
/// `--name-status` is authoritative for order and status; `--numstat` only
/// contributes counts, and may legitimately be missing entries (submodules,
/// type changes), which stay as `None` rather than a fabricated zero.
pub fn merge_changed_files(
    name_status: Vec<(FileStatus, Option<String>, String)>,
    numstat: Vec<NumstatEntry>,
) -> Vec<ChangedFile> {
    name_status
        .into_iter()
        .map(|(status, old_path, path)| {
            let stat = numstat.iter().find(|entry| entry.path == path);
            let binary = stat.is_some_and(|entry| entry.additions.is_none());

            ChangedFile {
                id: path.clone(),
                path,
                old_path,
                status,
                additions: stat.and_then(|entry| entry.additions),
                deletions: stat.and_then(|entry| entry.deletions),
                binary,
            }
        })
        .collect()
}

/// Parses the `@@ -a,b +c,d @@ heading` marker.
struct HunkHeader {
    old_start: u32,
    old_lines: u32,
    new_start: u32,
    new_lines: u32,
    heading: Option<String>,
}

fn parse_hunk_header(line: &str) -> Option<HunkHeader> {
    let rest = line.strip_prefix("@@ ")?;
    let close = rest.find(" @@")?;
    let (ranges, tail) = rest.split_at(close);

    let mut ranges = ranges.split_whitespace();
    let old = ranges.next()?.strip_prefix('-')?;
    let new = ranges.next()?.strip_prefix('+')?;

    // A range is `start` or `start,count`; a missing count means 1.
    let split_range = |value: &str| -> Option<(u32, u32)> {
        match value.split_once(',') {
            Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
            None => Some((value.parse().ok()?, 1)),
        }
    };

    let (old_start, old_lines) = split_range(old)?;
    let (new_start, new_lines) = split_range(new)?;

    let heading = tail.trim_start_matches(" @@").trim();

    Some(HunkHeader {
        old_start,
        old_lines,
        new_start,
        new_lines,
        heading: if heading.is_empty() {
            None
        } else {
            Some(heading.to_string())
        },
    })
}

/// Parses the unified diff for a single file.
///
/// `meta` supplies the status and paths, which Git also repeats in the diff
/// header — but `git diff -- <path>` prints nothing at all for an unchanged
/// file, and we still want a well-formed (empty) result in that case.
pub fn parse_file_diff(meta: &ChangedFile, raw: &str) -> FileDiff {
    let mut diff = FileDiff {
        id: meta.id.clone(),
        path: meta.path.clone(),
        old_path: meta.old_path.clone(),
        status: meta.status,
        binary: meta.binary,
        truncated: false,
        additions: 0,
        deletions: 0,
        max_line_length: 0,
        hunks: Vec::new(),
    };

    let mut current: Option<DiffHunk> = None;
    let mut old_line = 0u32;
    let mut new_line = 0u32;

    // Git terminates the last line with a newline. Splitting on '\n' would
    // then yield a trailing empty fragment, which the hunk body would happily
    // record as an extra empty context line.
    let body = raw.strip_suffix('\n').unwrap_or(raw);

    for line in body.split('\n') {
        // A new file header closes whatever hunk was open. `git diff -- <path>`
        // yields one file, but staying correct for multi-file input is free.
        if line.starts_with("diff --git ") {
            if let Some(hunk) = current.take() {
                diff.hunks.push(hunk);
            }
            continue;
        }

        if line.starts_with("@@") {
            if let Some(hunk) = current.take() {
                diff.hunks.push(hunk);
            }
            let Some(header) = parse_hunk_header(line) else {
                continue;
            };

            old_line = header.old_start;
            new_line = header.new_start;

            current = Some(DiffHunk {
                id: hunk_id(&meta.path, diff.hunks.len()),
                old_start: header.old_start,
                old_lines: header.old_lines,
                new_start: header.new_start,
                new_lines: header.new_lines,
                heading: header.heading,
                lines: Vec::new(),
            });
            continue;
        }

        // Outside a hunk we are in the extended header block. Nothing there is
        // navigable, so only the binary markers matter — and they can appear
        // even when numstat did not flag the file.
        let Some(hunk) = current.as_mut() else {
            if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
                diff.binary = true;
            }
            continue;
        };

        // `\ No newline at end of file` annotates the line just emitted.
        if line.starts_with('\\') {
            if let Some(last) = hunk.lines.last_mut() {
                last.no_newline = true;
            }
            continue;
        }

        let (kind, content) = match line.chars().next() {
            Some('+') => (LineKind::Add, &line[1..]),
            Some('-') => (LineKind::Delete, &line[1..]),
            Some(' ') => (LineKind::Context, &line[1..]),
            // A zero-length line inside a hunk is an empty context line that
            // lost its leading space (some tools strip trailing whitespace).
            None => (LineKind::Context, ""),
            // Anything else is not part of the hunk body.
            _ => continue,
        };

        let width = content.chars().count() as u32;
        if width > diff.max_line_length {
            diff.max_line_length = width;
        }

        let (old_number, new_number) = match kind {
            LineKind::Context => {
                let pair = (Some(old_line), Some(new_line));
                old_line += 1;
                new_line += 1;
                pair
            }
            LineKind::Add => {
                let pair = (None, Some(new_line));
                new_line += 1;
                diff.additions += 1;
                pair
            }
            LineKind::Delete => {
                let pair = (Some(old_line), None);
                old_line += 1;
                diff.deletions += 1;
                pair
            }
        };

        hunk.lines.push(DiffLine {
            kind,
            old_line_number: old_number,
            new_line_number: new_number,
            content: content.to_string(),
            no_newline: false,
        });
    }

    if let Some(hunk) = current.take() {
        diff.hunks.push(hunk);
    }

    diff
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(path: &str) -> ChangedFile {
        ChangedFile {
            id: path.to_string(),
            path: path.to_string(),
            old_path: None,
            status: FileStatus::Modified,
            additions: None,
            deletions: None,
            binary: false,
        }
    }

    #[test]
    fn name_status_reads_simple_records() {
        let raw = "M\0src/foo.ts\0D\0src/gone.ts\0";
        assert_eq!(
            parse_name_status(raw),
            vec![
                (FileStatus::Modified, None, "src/foo.ts".to_string()),
                (FileStatus::Deleted, None, "src/gone.ts".to_string()),
            ]
        );
    }

    #[test]
    fn name_status_reads_rename_pairs() {
        let raw = "R100\0old/a.ts\0new/a.ts\0M\0b.ts\0";
        assert_eq!(
            parse_name_status(raw),
            vec![
                (
                    FileStatus::Renamed,
                    Some("old/a.ts".to_string()),
                    "new/a.ts".to_string()
                ),
                (FileStatus::Modified, None, "b.ts".to_string()),
            ]
        );
    }

    #[test]
    fn name_status_skips_unknown_codes_without_desyncing() {
        let raw = "U\0conflict.ts\0M\0after.ts\0";
        assert_eq!(
            parse_name_status(raw),
            vec![(FileStatus::Modified, None, "after.ts".to_string())]
        );
    }

    #[test]
    fn name_status_handles_paths_containing_spaces() {
        let raw = "M\0src/my file.ts\0";
        assert_eq!(
            parse_name_status(raw),
            vec![(FileStatus::Modified, None, "src/my file.ts".to_string())]
        );
    }

    #[test]
    fn numstat_reads_counts_and_binary_markers() {
        let raw = "3\t1\tsrc/foo.ts\0-\t-\tassets/logo.png\0";
        assert_eq!(
            parse_numstat(raw),
            vec![
                NumstatEntry {
                    additions: Some(3),
                    deletions: Some(1),
                    path: "src/foo.ts".to_string()
                },
                NumstatEntry {
                    additions: None,
                    deletions: None,
                    path: "assets/logo.png".to_string()
                },
            ]
        );
    }

    #[test]
    fn numstat_reads_rename_records() {
        let raw = "2\t0\t\0old/a.ts\0new/a.ts\05\t5\tb.ts\0";
        assert_eq!(
            parse_numstat(raw),
            vec![
                NumstatEntry {
                    additions: Some(2),
                    deletions: Some(0),
                    path: "new/a.ts".to_string()
                },
                NumstatEntry {
                    additions: Some(5),
                    deletions: Some(5),
                    path: "b.ts".to_string()
                },
            ]
        );
    }

    #[test]
    fn merge_pairs_counts_with_status_and_flags_binary() {
        let files = merge_changed_files(
            parse_name_status("M\0src/foo.ts\0M\0logo.png\0"),
            parse_numstat("3\t1\tsrc/foo.ts\0-\t-\tlogo.png\0"),
        );

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].additions, Some(3));
        assert_eq!(files[0].deletions, Some(1));
        assert!(!files[0].binary);
        assert!(files[1].binary);
        assert_eq!(files[1].additions, None);
    }

    #[test]
    fn merge_keeps_name_status_order_and_id_equals_path() {
        let files = merge_changed_files(
            parse_name_status("M\0z.ts\0M\0a.ts\0"),
            parse_numstat("1\t0\ta.ts\0"),
        );

        assert_eq!(files[0].path, "z.ts");
        assert_eq!(files[0].id, "z.ts");
        assert_eq!(files[0].additions, None, "missing numstat stays unknown");
        assert_eq!(files[1].additions, Some(1));
    }

    #[test]
    fn hunk_header_parses_ranges_and_heading() {
        let header = parse_hunk_header("@@ -12,7 +12,9 @@ fn render(props: Props) {").unwrap();
        assert_eq!(header.old_start, 12);
        assert_eq!(header.old_lines, 7);
        assert_eq!(header.new_start, 12);
        assert_eq!(header.new_lines, 9);
        assert_eq!(header.heading.as_deref(), Some("fn render(props: Props) {"));
    }

    #[test]
    fn hunk_header_defaults_missing_counts_to_one() {
        let header = parse_hunk_header("@@ -3 +3 @@").unwrap();
        assert_eq!((header.old_start, header.old_lines), (3, 1));
        assert_eq!((header.new_start, header.new_lines), (3, 1));
        assert_eq!(header.heading, None);
    }

    #[test]
    fn file_diff_numbers_lines_on_both_sides() {
        let raw = "\
diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
 const d = 5;
";
        let diff = parse_file_diff(&meta("src/foo.ts"), raw);

        assert_eq!(diff.hunks.len(), 1);
        assert_eq!(diff.additions, 1);
        assert_eq!(diff.deletions, 1);

        let lines = &diff.hunks[0].lines;
        assert_eq!(lines.len(), 5);

        assert_eq!(lines[0].old_line_number, Some(1));
        assert_eq!(lines[0].new_line_number, Some(1));

        assert_eq!(lines[1].kind, LineKind::Delete);
        assert_eq!(lines[1].old_line_number, Some(2));
        assert_eq!(lines[1].new_line_number, None);

        assert_eq!(lines[2].kind, LineKind::Add);
        assert_eq!(lines[2].old_line_number, None);
        assert_eq!(lines[2].new_line_number, Some(2));

        // Context after the change resumes from the right numbers on both sides.
        assert_eq!(lines[3].old_line_number, Some(3));
        assert_eq!(lines[3].new_line_number, Some(3));
    }

    #[test]
    fn file_diff_assigns_sequential_stable_hunk_ids() {
        let raw = "\
@@ -1,2 +1,2 @@
-a
+b
@@ -10,2 +10,2 @@
-c
+d
@@ -20,2 +20,2 @@
-e
+f
";
        let diff = parse_file_diff(&meta("src/foo.ts"), raw);

        let ids: Vec<&str> = diff.hunks.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["src/foo.ts:hunk:0", "src/foo.ts:hunk:1", "src/foo.ts:hunk:2"]
        );
        assert_eq!(diff.hunks[1].old_start, 10);
    }

    #[test]
    fn file_diff_marks_no_newline_on_the_preceding_line() {
        let raw = "\
@@ -1,1 +1,1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
";
        let diff = parse_file_diff(&meta("a.txt"), raw);
        let lines = &diff.hunks[0].lines;

        assert_eq!(lines.len(), 2);
        assert!(lines[0].no_newline);
        assert!(lines[1].no_newline);
    }

    #[test]
    fn file_diff_detects_binary_payloads() {
        let raw = "\
diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
";
        let diff = parse_file_diff(&meta("logo.png"), raw);

        assert!(diff.binary);
        assert!(diff.hunks.is_empty());
    }

    #[test]
    fn file_diff_records_longest_line_for_horizontal_sizing() {
        let raw = "\
@@ -1,2 +1,2 @@
 short
+a line that is quite a lot longer than the other one
";
        let diff = parse_file_diff(&meta("a.txt"), raw);
        assert_eq!(diff.max_line_length, 52);
    }

    #[test]
    fn file_diff_counts_characters_not_bytes() {
        let raw = "@@ -1,1 +1,1 @@\n+héllo — ok\n";
        let diff = parse_file_diff(&meta("a.txt"), raw);
        assert_eq!(diff.max_line_length, 10);
    }

    #[test]
    fn file_diff_of_empty_output_is_well_formed() {
        let diff = parse_file_diff(&meta("a.txt"), "");
        assert!(diff.hunks.is_empty());
        assert_eq!(diff.additions, 0);
        assert_eq!(diff.deletions, 0);
    }

    #[test]
    fn file_diff_keeps_lines_that_begin_with_a_diff_marker() {
        // A removed line whose own text starts with `--` must not be mistaken
        // for the `--- a/file` header.
        let raw = "@@ -1,2 +1,2 @@\n--- not a header\n+++ also not a header\n";
        let diff = parse_file_diff(&meta("a.txt"), raw);
        let lines = &diff.hunks[0].lines;

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].kind, LineKind::Delete);
        assert_eq!(lines[0].content, "-- not a header");
        assert_eq!(lines[1].kind, LineKind::Add);
        assert_eq!(lines[1].content, "++ also not a header");
    }
}
