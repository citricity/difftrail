//! Deciding which notes still describe the diff on screen.
//!
//! A changelog that no longer matches the live diff is usually nothing worse
//! than a developer having edited the code afterwards. So Diff Trek keeps the
//! notes that still fit and says how many did not, rather than discarding the
//! lot.
//!
//! The invariant that makes that safe: **a note is only ever shown against a
//! hunk whose changed lines are exactly the ones it was written for.** Matching
//! is by content, never by line number — every line number below an edit moves
//! — and never approximate.
//!
//! Three passes, each looser than the last:
//!
//! 1. the whole hunk body, byte for byte;
//! 2. the `+`/`-` lines alone, which survives an edit that rewrites the hunk's
//!    *context* while leaving its change untouched;
//! 3. the `+`/`-` lines appearing contiguously, in order, inside a larger
//!    hunk's. This is the common case of a reader adding a line within a few
//!    lines of the AI's change: Git merges it into the same hunk, so the hunk
//!    now does slightly more than the note describes. The note still describes
//!    exactly the lines it was written for, so it is shown — and marked
//!    `partial`, because the hunk has grown around it.
//!
//! Matching is by content *group*, not by position: where the same hunk appears
//! several times in a file — which is what non-DRY code looks like — every
//! occurrence gets the reasoning.

use super::format::{Changelog, HunkNote};
use serde::Serialize;
use std::collections::HashMap;

/// What the UI shows against one hunk of the live diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedHunk {
    /// `<path>:hunk:<index>` in the live diff, the same id the diff model uses.
    pub hunk_id: String,
    /// Usually one. Several only when identical hunks were given different
    /// reasons and nothing can choose between them.
    pub reasons: Vec<String>,
    pub logical_change_ids: Vec<String>,
    /// Set when `reasons` holds more than one, so the UI can say these cover
    /// identical changes rather than pretending to know which applies.
    pub ambiguous: bool,
    /// The hunk contains the lines these reasons were written for, and more
    /// besides — something was edited alongside them since. Everything shown is
    /// still about lines the author really wrote about; the rest of the hunk is
    /// unaccounted for.
    pub partial: bool,
}

impl ResolvedHunk {
    /// In the changelog, but with nothing said about it — the signal worth
    /// having, since it is often a change nobody meant to make.
    pub fn is_unexplained(&self) -> bool {
        self.reasons.is_empty() && self.logical_change_ids.is_empty()
    }
}

/// How well the changelog describes the diff on screen.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchSummary {
    /// Hunks in the live diff the changelog knows about.
    pub matched: usize,
    /// Hunks in the live diff.
    pub total: usize,
    /// Matched hunks with no reason and no logical change.
    pub unexplained: usize,
    /// Matched hunks that have grown around their notes since.
    pub partial: usize,
    /// Notes describing hunks the live diff no longer has: the changelog was
    /// written, then the code moved on.
    pub stale_notes: usize,
}

impl MatchSummary {
    /// The changelog describes this diff exactly: every hunk on screen is
    /// accounted for, nothing was left behind, and no hunk has grown around its
    /// note. Anything less is worth telling the reader about.
    pub fn is_complete(&self) -> bool {
        self.matched == self.total && self.stale_notes == 0 && self.partial == 0
    }

    /// Hunks that changed since the notes were written — usually the reader's
    /// own later edits, which is why they are never called unexplained.
    pub fn changed_since(&self) -> usize {
        self.total - self.matched
    }
}

/// The notes that apply to `live_diff`, keyed by hunk id.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Annotations {
    pub hunks: HashMap<String, ResolvedHunk>,
    pub summary: MatchSummary,
}

/// Hunk id as the diff model spells it, so the frontend needs no translation.
fn hunk_id(path: &str, index: usize) -> String {
    format!("{path}:hunk:{index}")
}

fn body_key(note: &HunkNote) -> (String, String) {
    (note.path.clone(), note.body.join("\n"))
}

fn changed_key(note: &HunkNote) -> (String, String) {
    (note.path.clone(), note.changed_lines().join("\n"))
}

/// Notes sharing one content key, merged.
#[derive(Default)]
struct Group {
    reasons: Vec<String>,
    logical_change_ids: Vec<String>,
    /// Whether any live hunk claimed this group. Unclaimed groups are notes for
    /// code that has since changed.
    used: bool,
}

impl Group {
    fn absorb(&mut self, note: &HunkNote) {
        if let Some(reason) = &note.reason {
            if !self.reasons.contains(reason) {
                self.reasons.push(reason.clone());
            }
        }
        for id in &note.logical_change_ids {
            if !self.logical_change_ids.contains(id) {
                self.logical_change_ids.push(id.clone());
            }
        }
    }
}

fn group_by(
    notes: &[HunkNote],
    key: impl Fn(&HunkNote) -> (String, String),
    skip: &dyn Fn(&HunkNote) -> bool,
) -> HashMap<(String, String), Group> {
    let mut groups: HashMap<(String, String), Group> = HashMap::new();
    for note in notes.iter().filter(|note| !skip(note)) {
        groups.entry(key(note)).or_default().absorb(note);
    }
    groups
}

/// Matches a changelog against the diff Git reports now.
pub fn annotate(changelog: &Changelog, live_diff: &str) -> Annotations {
    let live = super::format::scan(live_diff);

    let mut exact = group_by(&changelog.notes, body_key, &|_| false);
    // A hunk with no changed lines cannot exist in a real diff, but a truncated
    // or hand-edited changelog can produce one; grouping on an empty key would
    // pull unrelated hunks together.
    let mut loose = group_by(&changelog.notes, changed_key, &|note| {
        note.changed_lines().is_empty()
    });

    let mut hunks: HashMap<String, ResolvedHunk> = HashMap::new();

    // Passes one and two: this hunk is exactly what was annotated.
    for note in &live {
        let group = match exact.get_mut(&body_key(note)) {
            Some(group) => Some(group),
            None if !note.changed_lines().is_empty() => loose.get_mut(&changed_key(note)),
            None => None,
        };

        let Some(group) = group else {
            continue;
        };

        group.used = true;
        let id = hunk_id(&note.path, note.index);

        hunks.insert(
            id.clone(),
            ResolvedHunk {
                hunk_id: id,
                reasons: group.reasons.clone(),
                logical_change_ids: group.logical_change_ids.clone(),
                ambiguous: group.reasons.len() > 1,
                partial: false,
            },
        );
    }

    // Pass three: the annotated lines are in this hunk, with company. More than
    // one note can apply — an edit between two annotated changes merges both
    // into one hunk — and each still describes the lines it was written for.
    for note in &live {
        let id = hunk_id(&note.path, note.index);
        let changed = note.changed_lines();

        if hunks.contains_key(&id) || changed.is_empty() {
            continue;
        }

        let mut reasons: Vec<String> = Vec::new();
        let mut logical_change_ids: Vec<String> = Vec::new();
        let mut applied: Vec<(String, String)> = Vec::new();

        // Walked in the changelog's own order, not the map's: several reasons
        // shown against one hunk must come out in the same order every time.
        for candidate in &changelog.notes {
            let annotated = candidate.changed_lines();
            if candidate.path != note.path || !contains_run(&changed, &annotated) {
                continue;
            }

            let key = changed_key(candidate);
            if applied.contains(&key) {
                continue;
            }
            applied.push(key.clone());

            let Some(group) = loose.get_mut(&key) else {
                continue;
            };
            group.used = true;

            for reason in &group.reasons {
                if !reasons.contains(reason) {
                    reasons.push(reason.clone());
                }
            }
            for change in &group.logical_change_ids {
                if !logical_change_ids.contains(change) {
                    logical_change_ids.push(change.clone());
                }
            }
        }

        if applied.is_empty() {
            continue;
        }

        hunks.insert(
            id.clone(),
            ResolvedHunk {
                hunk_id: id,
                reasons,
                logical_change_ids,
                // Not ambiguous: these notes are about different lines of one
                // hunk, not competing accounts of the same change.
                ambiguous: false,
                partial: true,
            },
        );
    }

    // A note is stale only when *neither* pass could place it — a note picked
    // up by pass two is not stale merely because pass one missed it — and only
    // when it said something. An empty placeholder describes a hunk nobody
    // explained; there is nothing to have gone stale.
    let placed = |note: &HunkNote| {
        exact.get(&body_key(note)).is_some_and(|group| group.used)
            || loose.get(&changed_key(note)).is_some_and(|group| group.used)
    };

    let stale_notes = changelog
        .notes
        .iter()
        .filter(|note| !note.is_unexplained())
        .filter(|note| !placed(note))
        .count();

    Annotations {
        summary: MatchSummary {
            matched: hunks.len(),
            total: live.len(),
            unexplained: hunks.values().filter(|hunk| hunk.is_unexplained()).count(),
            partial: hunks.values().filter(|hunk| hunk.partial).count(),
            stale_notes,
        },
        hunks,
    }
}

/// Whether `needle` appears in `haystack` contiguously and in order.
fn contains_run(haystack: &[&str], needle: &[&str]) -> bool {
    !needle.is_empty()
        && needle.len() <= haystack.len()
        && haystack.windows(needle.len()).any(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::format::{self, ChangeInfo};

    const NONCE: &str = "AB99X7";

    /// Builds a changelog over `diff` with the given reasons, by filling the
    /// placeholders exactly as an agent would: one exact-match replacement per
    /// hunk, never a rewrite.
    fn annotated(diff: &str, reasons: &[(&str, &str)]) -> Changelog {
        let mut text = format::render(NONCE, &ChangeInfo::default(), diff);
        for (id, reason) in reasons {
            let placeholder = format!(
                "~~DIFFTREK_AI:{NONCE}:HUNK_REASON id={id}~~\n~~DIFFTREK_AI:{NONCE}:/HUNK_REASON id={id}~~"
            );
            let filled = format!(
                "~~DIFFTREK_AI:{NONCE}:HUNK_REASON id={id}~~\n{reason}\n~~DIFFTREK_AI:{NONCE}:/HUNK_REASON id={id}~~"
            );
            assert!(text.contains(&placeholder), "no placeholder {id}");
            text = text.replace(&placeholder, &filled);
        }
        format::parse(&text).unwrap()
    }

    fn two_file_diff() -> String {
        [
            "diff --git a/src/one.ts b/src/one.ts",
            "--- a/src/one.ts",
            "+++ b/src/one.ts",
            "@@ -1,3 +1,3 @@",
            " before();",
            "-const b = 2;",
            "+const b = 3;",
            "diff --git a/src/two.ts b/src/two.ts",
            "--- a/src/two.ts",
            "+++ b/src/two.ts",
            "@@ -7,2 +7,2 @@",
            "-old();",
            "+new();",
            "",
        ]
        .join("\n")
    }

    #[test]
    fn an_unchanged_diff_matches_every_note() {
        let diff = two_file_diff();
        let changelog = annotated(&diff, &[("h1", "Fix the count"), ("h2", "Rename the call")]);

        let annotations = annotate(&changelog, &diff);

        assert!(annotations.summary.is_complete());
        assert_eq!(annotations.summary.matched, 2);
        assert_eq!(
            annotations.hunks["src/one.ts:hunk:0"].reasons,
            ["Fix the count"]
        );
        assert_eq!(
            annotations.hunks["src/two.ts:hunk:0"].reasons,
            ["Rename the call"]
        );
    }

    #[test]
    fn an_edit_elsewhere_in_the_file_keeps_the_note() {
        // The reader added a line above the AI's change, so the hunk's context
        // and line numbers moved but its edit did not.
        let changelog = annotated(&two_file_diff(), &[("h1", "Fix the count")]);
        let live = [
            "diff --git a/src/one.ts b/src/one.ts",
            "--- a/src/one.ts",
            "+++ b/src/one.ts",
            "@@ -1,4 +1,4 @@",
            " introduced();",
            " before();",
            "-const b = 2;",
            "+const b = 3;",
            "",
        ]
        .join("\n");

        let annotations = annotate(&changelog, &live);

        assert_eq!(
            annotations.hunks["src/one.ts:hunk:0"].reasons,
            ["Fix the count"]
        );
        assert_eq!(annotations.summary.matched, 1);
    }

    #[test]
    fn a_hunk_the_reader_changed_since_is_not_called_unexplained() {
        let changelog = annotated(&two_file_diff(), &[("h1", "Fix the count")]);
        let live = [
            "diff --git a/src/one.ts b/src/one.ts",
            "--- a/src/one.ts",
            "+++ b/src/one.ts",
            "@@ -1,3 +1,3 @@",
            " before();",
            "-const b = 2;",
            "+const b = 4;",
            "",
        ]
        .join("\n");

        let annotations = annotate(&changelog, &live);

        assert!(annotations.hunks.is_empty());
        assert_eq!(annotations.summary.changed_since(), 1);
        assert_eq!(annotations.summary.unexplained, 0);
        assert_eq!(annotations.summary.stale_notes, 1);
        assert!(!annotations.summary.is_complete());
    }

    #[test]
    fn drift_in_one_hunk_does_not_hide_an_unexplained_hunk_elsewhere() {
        // h2 was left empty by its author; h1 has since been edited by the
        // reader. Each hunk is judged on its own.
        let changelog = annotated(&two_file_diff(), &[("h1", "Fix the count")]);
        let live = two_file_diff().replace("+const b = 3;", "+const b = 9;");

        let annotations = annotate(&changelog, &live);

        assert_eq!(annotations.summary.matched, 1);
        assert_eq!(annotations.summary.changed_since(), 1);
        assert!(annotations.hunks["src/two.ts:hunk:0"].is_unexplained());
        assert_eq!(annotations.summary.unexplained, 1);
    }

    #[test]
    fn an_edit_alongside_the_change_keeps_the_note_and_marks_it_partial() {
        // The reader added a line close enough that Git merged it into the same
        // hunk. The note still describes exactly the lines it was written for.
        let changelog = annotated(&two_file_diff(), &[("h1", "Fix the count")]);
        let live = [
            "diff --git a/src/one.ts b/src/one.ts",
            "--- a/src/one.ts",
            "+++ b/src/one.ts",
            "@@ -1,3 +1,5 @@",
            "+introduced();",
            " before();",
            "-const b = 2;",
            "+const b = 3;",
            "",
        ]
        .join("\n");

        let hunk = &annotate(&changelog, &live).hunks["src/one.ts:hunk:0"];

        assert_eq!(hunk.reasons, ["Fix the count"]);
        assert!(hunk.partial);
        assert!(!hunk.ambiguous);
    }

    #[test]
    fn two_notes_merged_into_one_hunk_are_both_shown() {
        let diff = [
            "diff --git a/src/one.ts b/src/one.ts",
            "--- a/src/one.ts",
            "+++ b/src/one.ts",
            "@@ -1,2 +1,2 @@",
            "-alpha();",
            "+ALPHA();",
            "@@ -20,2 +20,2 @@",
            "-omega();",
            "+OMEGA();",
            "",
        ]
        .join("\n");
        let changelog = annotated(&diff, &[("h1", "Shout alpha"), ("h2", "Shout omega")]);

        // The reader edited the lines between them, so the two hunks are one.
        let live = [
            "diff --git a/src/one.ts b/src/one.ts",
            "--- a/src/one.ts",
            "+++ b/src/one.ts",
            "@@ -1,20 +1,20 @@",
            "-alpha();",
            "+ALPHA();",
            "-middle();",
            "+MIDDLE();",
            "-omega();",
            "+OMEGA();",
            "",
        ]
        .join("\n");

        let annotations = annotate(&changelog, &live);
        let hunk = &annotations.hunks["src/one.ts:hunk:0"];

        assert_eq!(hunk.reasons, ["Shout alpha", "Shout omega"]);
        assert!(hunk.partial);
        // Both notes were placed, so neither is stale — but the hunk does more
        // than they account for, so this is not a complete match.
        assert_eq!(annotations.summary.stale_notes, 0);
        assert_eq!(annotations.summary.partial, 1);
        assert!(!annotations.summary.is_complete());
    }

    #[test]
    fn the_annotated_lines_have_to_be_together_and_in_order() {
        assert!(contains_run(&["a", "b", "c"], &["b", "c"]));
        assert!(contains_run(&["a", "b"], &["a", "b"]));
        // Scattered through the hunk is not the change that was annotated.
        assert!(!contains_run(&["a", "x", "b"], &["a", "b"]));
        assert!(!contains_run(&["a", "b"], &["b", "a"]));
        assert!(!contains_run(&["a"], &["a", "b"]));
        assert!(!contains_run(&["a"], &[]));
    }

    #[test]
    fn repeated_identical_hunks_all_get_the_reasoning() {
        // Code that is not DRY really does repeat the same edit.
        let diff = [
            "diff --git a/src/repeat.ts b/src/repeat.ts",
            "--- a/src/repeat.ts",
            "+++ b/src/repeat.ts",
            "@@ -10,2 +10,2 @@",
            "-log(err);",
            "+report(err);",
            "@@ -40,2 +40,2 @@",
            "-log(err);",
            "+report(err);",
            "@@ -70,2 +70,2 @@",
            "-log(err);",
            "+report(err);",
            "",
        ]
        .join("\n");

        // Only the first is annotated; all three are identical.
        let changelog = annotated(&diff, &[("h1", "Errors now go through the reporter")]);
        let annotations = annotate(&changelog, &diff);

        for index in 0..3 {
            assert_eq!(
                annotations.hunks[&format!("src/repeat.ts:hunk:{index}")].reasons,
                ["Errors now go through the reporter"],
                "hunk {index}"
            );
        }
        assert!(annotations.summary.is_complete());
        assert_eq!(annotations.summary.unexplained, 0);
    }

    #[test]
    fn identical_hunks_given_different_reasons_show_both() {
        let diff = [
            "diff --git a/src/repeat.ts b/src/repeat.ts",
            "--- a/src/repeat.ts",
            "+++ b/src/repeat.ts",
            "@@ -10,2 +10,2 @@",
            "-log(err);",
            "+report(err);",
            "@@ -40,2 +40,2 @@",
            "-log(err);",
            "+report(err);",
            "",
        ]
        .join("\n");

        let changelog = annotated(&diff, &[("h1", "The header copy"), ("h2", "The footer copy")]);
        let annotations = annotate(&changelog, &diff);

        let first = &annotations.hunks["src/repeat.ts:hunk:0"];
        assert!(first.ambiguous);
        assert_eq!(first.reasons, ["The header copy", "The footer copy"]);
    }

    #[test]
    fn identical_edits_in_different_files_stay_apart() {
        let diff = [
            "diff --git a/src/one.ts b/src/one.ts",
            "--- a/src/one.ts",
            "+++ b/src/one.ts",
            "@@ -1,2 +1,2 @@",
            "-same();",
            "+SAME();",
            "diff --git a/src/two.ts b/src/two.ts",
            "--- a/src/two.ts",
            "+++ b/src/two.ts",
            "@@ -1,2 +1,2 @@",
            "-same();",
            "+SAME();",
            "",
        ]
        .join("\n");

        let changelog = annotated(&diff, &[("h1", "Only the first file")]);
        let annotations = annotate(&changelog, &diff);

        assert_eq!(
            annotations.hunks["src/one.ts:hunk:0"].reasons,
            ["Only the first file"]
        );
        assert!(annotations.hunks["src/two.ts:hunk:0"].reasons.is_empty());
        assert_eq!(annotations.summary.unexplained, 1);
    }

    #[test]
    fn logical_change_membership_travels_with_the_hunk() {
        let diff = two_file_diff();
        let mut text = format::render(NONCE, &ChangeInfo::default(), &diff);
        text = text.replace(
            "diff --git a/src/one.ts",
            &format!("~~DIFFTREK_AI:{NONCE}:LOGICAL_CHANGE_START id=0 /~~\ndiff --git a/src/one.ts"),
        );
        text = text.replace(
            "diff --git a/src/two.ts",
            &format!("~~DIFFTREK_AI:{NONCE}:LOGICAL_CHANGE_END id=0 /~~\ndiff --git a/src/two.ts"),
        );

        let changelog = format::parse(&text).unwrap();
        let annotations = annotate(&changelog, &diff);

        assert_eq!(
            annotations.hunks["src/one.ts:hunk:0"].logical_change_ids,
            ["0"]
        );
        assert!(annotations.hunks["src/one.ts:hunk:0"].reasons.is_empty());
        // Membership alone is enough: this hunk is explained by its logical
        // change even without a reason of its own.
        assert!(!annotations.hunks["src/one.ts:hunk:0"].is_unexplained());
        assert!(annotations.hunks["src/two.ts:hunk:0"]
            .logical_change_ids
            .is_empty());
    }

    #[test]
    fn a_diff_with_nothing_in_common_matches_nothing() {
        let changelog = annotated(&two_file_diff(), &[("h1", "Fix the count")]);
        let live = [
            "diff --git a/src/other.ts b/src/other.ts",
            "--- a/src/other.ts",
            "+++ b/src/other.ts",
            "@@ -1,2 +1,2 @@",
            "-unrelated();",
            "+different();",
            "",
        ]
        .join("\n");

        let annotations = annotate(&changelog, &live);

        assert_eq!(annotations.summary.matched, 0);
        assert_eq!(annotations.summary.total, 1);
        // One note said something and no longer applies. The other placeholder
        // was left empty, so there is nothing for it to have gone stale.
        assert_eq!(annotations.summary.stale_notes, 1);
    }
}
