//! The AI changelog file format: an annotated copy of a diff.
//!
//! A changelog is the output of `git diff` with Diff Trek tag lines inserted at
//! column 0. The diff text is therefore its own anchor — strip the tags and what
//! remains can be compared against the diff Git reports now, so notes can never
//! drift onto code they were not written for.
//!
//! Two rules keep tags and diff content apart, and both matter:
//!
//! 1. **Column 0 only.** Every line inside a hunk body starts with a space,
//!    `+`, `-` or `\`, so a tag at column 0 cannot be body content. This is what
//!    makes a diff *of this format's own documentation* parse correctly.
//! 2. **A per-file nonce** in every tag. A line that looks like a tag but
//!    carries a different nonce is content, not a tag — so an annotated diff of
//!    an annotated diff is inert, and a fragment pasted in from another review
//!    announces itself instead of half-parsing.
//!
//! The nonce is declared once, on the first line, which is the only line
//! recognised without knowing it.

use serde::{Deserialize, Serialize};

/// Fixed marker opening every line this format owns.
pub const MARKER: &str = "~~DIFFTREK_AI";

/// Both ends of a tag line.
const FENCE: &str = "~~";

/// The format version this build writes and understands.
///
/// It versions the *file format*, not Diff Trek: bump it only when a reader of
/// the previous version would misread a file — a tag changing meaning, or a
/// change to the grammar or placement rules. New tags and new JSON fields are
/// not a bump, because unknown ones are ignored.
pub const FORMAT_VERSION: u32 = 1;

const TAG_CHANGE_INFO: &str = "CHANGE_INFO";
const TAG_LOGICAL_CHANGE_TABLE: &str = "LOGICAL_CHANGE_TABLE";
const TAG_LOGICAL_CHANGE_START: &str = "LOGICAL_CHANGE_START";
const TAG_LOGICAL_CHANGE_END: &str = "LOGICAL_CHANGE_END";
const TAG_HUNK_REASON: &str = "HUNK_REASON";
const TAG_END: &str = "END";

/// What the diff was taken against, so a changelog written for a range is not
/// silently checked against unstaged changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedAgainst {
    /// `workingTree` or `commits`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

impl CapturedAgainst {
    pub fn working_tree() -> Self {
        Self {
            kind: "workingTree".to_string(),
            base: None,
            target: None,
        }
    }
}

/// The `CHANGE_INFO` block.
///
/// Every field is optional on the way in: an older or hand-written file that
/// omits one costs only that field, never the whole changelog.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeInfo {
    /// Who wrote the notes — the argument to `--createchangelog`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_tracker: Option<String>,
    /// Set once the work has been committed, by `--attach-changelog`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commithash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub captured_against: Option<CapturedAgainst>,
    /// The exact Git arguments the diff was captured with, so the file stays
    /// checkable even if that list changes in a later Diff Trek.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capture_args: Vec<String>,
    /// Which Diff Trek wrote it. Diagnostic only — distinct from the format
    /// version on the first line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// One entry of the `LOGICAL_CHANGE_TABLE`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalChange {
    /// Explicit, so reordering the table cannot silently remap the markers.
    pub id: String,
    #[serde(default)]
    pub description: String,
    /// Always serialised, even when empty. This struct is both the file format
    /// and the payload the UI receives, and skipping an empty list would hand
    /// the frontend `undefined` where it expects an array - which it indexes.
    #[serde(default)]
    pub associated_issues: Vec<String>,
}

/// One annotated hunk, as the changelog records it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HunkNote {
    /// Placeholder id (`h1`, `h2`, …), unique within the file. It exists so an
    /// agent can replace one placeholder by exact match rather than rewriting
    /// the file, which is how whole diffs get mangled.
    pub id: String,
    /// Path as the diff names it (the new side, or the old side for a deletion).
    pub path: String,
    /// Index of this hunk within its file, matching `<path>:hunk:<index>`.
    pub index: usize,
    /// The reason this hunk exists. `None` when the placeholder was left empty,
    /// which is precisely the "unexplained hunk" signal.
    pub reason: Option<String>,
    /// Ids of every logical change whose span was open over this hunk.
    pub logical_change_ids: Vec<String>,
    /// The hunk body: context, `+`, `-` and `\` lines, verbatim.
    pub body: Vec<String>,
}

impl HunkNote {
    /// The `+`/`-` lines alone — what the second matching pass compares, so a
    /// later edit to nearby *context* does not throw the note away.
    pub fn changed_lines(&self) -> Vec<&str> {
        self.body
            .iter()
            .filter(|line| line.starts_with('+') || line.starts_with('-'))
            .map(|line| line.as_str())
            .collect()
    }

    /// True when this hunk carries neither a reason nor a logical change.
    pub fn is_unexplained(&self) -> bool {
        self.reason.is_none() && self.logical_change_ids.is_empty()
    }
}

/// A parsed changelog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Changelog {
    pub version: u32,
    pub nonce: String,
    pub info: ChangeInfo,
    pub logical_changes: Vec<LogicalChange>,
    pub notes: Vec<HunkNote>,
    /// The file with every tag line removed: what the live diff is compared to.
    pub clean_diff: String,
    /// Whether the `END` trailer was present. A file without it was truncated —
    /// the author stopped early, or a write was interrupted — and its tail must
    /// not be trusted.
    pub complete: bool,
    /// Non-fatal complaints, for diagnostics. Never shown as an error: notes are
    /// a nicety and must never stop a diff from rendering.
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    /// The first line is not a Diff Trek preamble, so this is not a changelog.
    NotAChangelog,
    /// Written by a newer format than this build understands. Refuse rather
    /// than annotate a diff using rules we do not know.
    UnsupportedVersion(u32),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAChangelog => write!(formatter, "This is not a Diff Trek AI changelog."),
            Self::UnsupportedVersion(version) => write!(
                formatter,
                "This AI changelog was written in format v{version}; this build understands v{FORMAT_VERSION}."
            ),
        }
    }
}

/// `~~DIFFTREK_AI v1 AB99X7~~` — version and nonce, and nothing else.
///
/// Its own line rather than part of `CHANGE_INFO` because the nonce is a
/// lexical property: it says how to read the rest of the file. That keeps the
/// rule uniform — line one needs no nonce, every later tag requires one.
pub fn preamble(nonce: &str) -> String {
    format!("{MARKER} v{FORMAT_VERSION} {nonce}{FENCE}")
}

fn parse_preamble(line: &str) -> Option<(u32, String)> {
    let inner = line
        .strip_prefix(MARKER)?
        .strip_suffix(FENCE)?
        .trim_start_matches(' ');

    let mut parts = inner.split_whitespace();
    let version = parts.next()?.strip_prefix('v')?.parse().ok()?;
    let nonce = parts.next()?.to_string();

    if nonce.is_empty() || parts.next().is_some() {
        return None;
    }

    Some((version, nonce))
}

/// One tag line, already known to carry the right nonce.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Tag {
    name: String,
    closing: bool,
    /// `key=value` attributes, in order.
    attributes: Vec<(String, String)>,
}

impl Tag {
    fn attribute(&self, key: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }
}

/// Reads a tag line, or `None` when the line is content.
///
/// A line whose nonce does not match is content by definition: that is the
/// whole point of the nonce.
fn parse_tag(line: &str, nonce: &str) -> Option<Tag> {
    let prefix = format!("{MARKER}:{nonce}:");
    let inner = line.strip_prefix(&prefix)?.strip_suffix(FENCE)?;
    let inner = inner.strip_suffix('/').unwrap_or(inner).trim();

    let mut parts = inner.split_whitespace();
    let name = parts.next()?;
    let (closing, name) = match name.strip_prefix('/') {
        Some(rest) => (true, rest),
        None => (false, name),
    };

    let attributes = parts
        .filter_map(|part| {
            part.split_once('=')
                .map(|(key, value)| (key.to_string(), value.to_string()))
        })
        .collect();

    Some(Tag {
        name: name.to_string(),
        closing,
        attributes,
    })
}

fn open_tag(nonce: &str, name: &str) -> String {
    format!("{MARKER}:{nonce}:{name}{FENCE}")
}

fn close_tag(nonce: &str, name: &str) -> String {
    format!("{MARKER}:{nonce}:/{name}{FENCE}")
}

fn open_tag_with_id(nonce: &str, name: &str, id: &str) -> String {
    format!("{MARKER}:{nonce}:{name} id={id}{FENCE}")
}

fn close_tag_with_id(nonce: &str, name: &str, id: &str) -> String {
    format!("{MARKER}:{nonce}:/{name} id={id}{FENCE}")
}

/// The `END` trailer. Without it a half-written file looks complete and quietly
/// loses its last hunks.
fn end_tag(nonce: &str) -> String {
    format!("{MARKER}:{nonce}:{TAG_END}{FENCE}")
}

/// The `@@ -a,b +c,d @@` header, reduced to what this module needs: how many
/// lines of body to expect. Counting the body is what lets a blank context line
/// (which some Git configurations emit as an empty line) be told from the end
/// of the hunk.
struct HunkCounts {
    old: u32,
    new: u32,
}

fn parse_hunk_counts(line: &str) -> Option<HunkCounts> {
    let inner = line.strip_prefix("@@ ")?;
    let inner = inner.split(" @@").next()?;
    let mut sides = inner.split(' ');

    let old = sides.next()?.strip_prefix('-')?;
    let new = sides.next()?.strip_prefix('+')?;

    fn count(spec: &str) -> Option<u32> {
        match spec.split_once(',') {
            Some((_, count)) => count.parse().ok(),
            // `@@ -5 +5 @@` means exactly one line on that side.
            None => Some(1),
        }
    }

    Some(HunkCounts {
        old: count(old)?,
        new: count(new)?,
    })
}

/// The path a `+++ b/path` or `--- a/path` line names, or `None` for
/// `/dev/null`.
fn header_path(line: &str) -> Option<String> {
    let rest = line
        .strip_prefix("+++ ")
        .or_else(|| line.strip_prefix("--- "))?;

    if rest == "/dev/null" {
        return None;
    }

    // Git writes `a/` and `b/` prefixes; the capture pins them so they are
    // always exactly these.
    let path = rest
        .strip_prefix("a/")
        .or_else(|| rest.strip_prefix("b/"))
        .unwrap_or(rest);

    Some(path.to_string())
}

/// Reads an annotated diff.
///
/// Never fails on anything but the first line: a damaged tag costs its own
/// annotation and is reported in `warnings`, because a diff that renders
/// without notes is far better than an error screen.
pub fn parse(text: &str) -> Result<Changelog, ParseError> {
    let mut lines = text.lines();
    let first = lines.next().ok_or(ParseError::NotAChangelog)?;
    let first = first.strip_prefix('\u{feff}').unwrap_or(first);

    let (version, nonce) = parse_preamble(first).ok_or(ParseError::NotAChangelog)?;
    if version > FORMAT_VERSION {
        return Err(ParseError::UnsupportedVersion(version));
    }

    let mut state = Parser::new(nonce.clone());
    for line in lines {
        state.line(line);
    }

    Ok(state.finish(version, nonce))
}

/// What the parser is collecting into right now.
enum Block {
    None,
    ChangeInfo(Vec<String>),
    LogicalChangeTable(Vec<String>),
    HunkReason { id: Option<String>, text: Vec<String> },
}

struct Parser {
    nonce: String,
    block: Block,
    info: ChangeInfo,
    logical_changes: Vec<LogicalChange>,
    notes: Vec<HunkNote>,
    clean: Vec<String>,
    warnings: Vec<String>,
    complete: bool,
    /// Logical change ids whose spans are open at this point in the document.
    open_changes: Vec<String>,
    path: Option<String>,
    /// Hunks seen so far in the current file, for `<path>:hunk:<index>`.
    hunk_index: usize,
    /// Body lines still expected in the current hunk.
    remaining: u32,
    placeholder_count: usize,
}

impl Parser {
    fn new(nonce: String) -> Self {
        Self {
            nonce,
            block: Block::None,
            info: ChangeInfo::default(),
            logical_changes: Vec::new(),
            notes: Vec::new(),
            clean: Vec::new(),
            warnings: Vec::new(),
            complete: false,
            open_changes: Vec::new(),
            path: None,
            hunk_index: 0,
            remaining: 0,
            placeholder_count: 0,
        }
    }

    fn line(&mut self, line: &str) {
        if let Some(tag) = parse_tag(line, &self.nonce) {
            self.tag(tag);
            return;
        }

        // Inside a JSON or reason block every line is that block's content,
        // never diff text.
        match &mut self.block {
            Block::ChangeInfo(collected) | Block::LogicalChangeTable(collected) => {
                collected.push(line.to_string());
                return;
            }
            Block::HunkReason { text, .. } => {
                text.push(line.to_string());
                return;
            }
            Block::None => {}
        }

        self.diff_line(line);
    }

    fn diff_line(&mut self, line: &str) {
        self.clean.push(line.to_string());

        if self.remaining > 0 && !line.starts_with("@@ ") && !line.starts_with("diff --git ") {
            if let Some(note) = self.notes.last_mut() {
                note.body.push(line.to_string());
            }
            // `\ No newline at end of file` annotates the line before it and is
            // not itself a line of either side.
            if !line.starts_with('\\') {
                self.remaining = self.remaining.saturating_sub(1);
            }
            return;
        }

        if line.starts_with("diff --git ") {
            self.path = None;
            self.hunk_index = 0;
            self.remaining = 0;
            return;
        }

        if line.starts_with("+++ ") {
            if let Some(path) = header_path(line) {
                self.path = Some(path);
            }
            return;
        }

        if line.starts_with("--- ") {
            // Only useful for a deletion, where the new side is /dev/null.
            if self.path.is_none() {
                self.path = header_path(line);
            }
            return;
        }

        if let Some(counts) = parse_hunk_counts(line) {
            let path = self.path.clone().unwrap_or_default();
            self.placeholder_count += 1;
            self.notes.push(HunkNote {
                id: format!("h{}", self.placeholder_count),
                path,
                index: self.hunk_index,
                reason: None,
                logical_change_ids: self.open_changes.clone(),
                body: Vec::new(),
            });
            self.hunk_index += 1;
            self.remaining = counts.old + counts.new;
        }
    }

    fn tag(&mut self, tag: Tag) {
        match (tag.name.as_str(), tag.closing) {
            (TAG_CHANGE_INFO, false) => self.block = Block::ChangeInfo(Vec::new()),
            (TAG_CHANGE_INFO, true) => {
                if let Block::ChangeInfo(collected) = std::mem::replace(&mut self.block, Block::None)
                {
                    match serde_json::from_str(&collected.join("\n")) {
                        Ok(info) => self.info = info,
                        Err(error) => self
                            .warnings
                            .push(format!("{TAG_CHANGE_INFO} is not valid JSON: {error}")),
                    }
                }
            }
            (TAG_LOGICAL_CHANGE_TABLE, false) => self.block = Block::LogicalChangeTable(Vec::new()),
            (TAG_LOGICAL_CHANGE_TABLE, true) => {
                if let Block::LogicalChangeTable(collected) =
                    std::mem::replace(&mut self.block, Block::None)
                {
                    match serde_json::from_str(&collected.join("\n")) {
                        Ok(changes) => self.logical_changes = changes,
                        Err(error) => self
                            .warnings
                            .push(format!("{TAG_LOGICAL_CHANGE_TABLE} is not valid JSON: {error}")),
                    }
                }
            }
            (TAG_HUNK_REASON, false) => {
                self.block = Block::HunkReason {
                    id: tag.attribute("id").map(str::to_string),
                    text: Vec::new(),
                };
            }
            (TAG_HUNK_REASON, true) => {
                if let Block::HunkReason { id, text } =
                    std::mem::replace(&mut self.block, Block::None)
                {
                    self.hunk_reason(id, text);
                }
            }
            (TAG_LOGICAL_CHANGE_START, _) => match tag.attribute("id") {
                Some(id) => self.open_changes.push(id.to_string()),
                None => self
                    .warnings
                    .push(format!("{TAG_LOGICAL_CHANGE_START} without an id")),
            },
            (TAG_LOGICAL_CHANGE_END, _) => match tag.attribute("id") {
                // Spans are re-openable, so the same id may open and close more
                // than once: that is what expresses "hunks 1 and 3 but not 2",
                // and what gives a change its own markers in each file.
                Some(id) => self.open_changes.retain(|open| open != id),
                None => self
                    .warnings
                    .push(format!("{TAG_LOGICAL_CHANGE_END} without an id")),
            },
            (TAG_END, _) => self.complete = true,
            (name, _) => self
                .warnings
                .push(format!("Unknown tag {name}, ignored")),
        }
    }

    fn hunk_reason(&mut self, id: Option<String>, text: Vec<String>) {
        let reason = text.join("\n").trim().to_string();
        let Some(note) = self.notes.last_mut() else {
            self.warnings
                .push(format!("{TAG_HUNK_REASON} before any hunk, ignored"));
            return;
        };

        if let Some(id) = &id {
            if id != &note.id {
                self.warnings.push(format!(
                    "{TAG_HUNK_REASON} id={id} sits at {}, kept where it is",
                    note.id
                ));
            }
        }

        // An empty placeholder is not an empty reason: it is a hunk nobody
        // explained, and the UI says so.
        if !reason.is_empty() {
            note.reason = Some(reason);
        }
    }

    fn finish(mut self, version: u32, nonce: String) -> Changelog {
        if !matches!(self.block, Block::None) {
            self.warnings
                .push("A tag block was left open at the end of the file".to_string());
        }

        if !self.open_changes.is_empty() {
            self.warnings.push(format!(
                "Logical change spans left open: {}",
                self.open_changes.join(", ")
            ));
        }

        let mut clean_diff = self.clean.join("\n");
        if !clean_diff.is_empty() {
            clean_diff.push('\n');
        }

        Changelog {
            version,
            nonce,
            info: self.info,
            logical_changes: self.logical_changes,
            notes: self.notes,
            clean_diff,
            complete: self.complete,
            warnings: self.warnings,
        }
    }
}

/// Scans an ordinary, untagged diff into the same hunk records `parse` builds.
///
/// Matching compares the changelog against the diff Git reports now, and both
/// sides go through this one scanner, so they cannot disagree about where a
/// hunk starts or which file it belongs to.
pub fn scan(diff: &str) -> Vec<HunkNote> {
    // No tag can carry this nonce: a tag line has to read
    // `~~DIFFTREK_AI:<nonce>:`, and a NUL never survives in diff text.
    let mut parser = Parser::new("\u{0}".to_string());
    for line in diff.lines() {
        parser.line(line);
    }
    parser.finish(FORMAT_VERSION, String::new()).notes
}

/// Builds a fresh changelog: preamble, `CHANGE_INFO`, an empty logical change
/// table, the captured diff with an empty `HUNK_REASON` placeholder after every
/// `@@` line, and the `END` trailer.
///
/// The placeholders are the point. The author never types diff text — it is
/// already here — and fills each reason by replacing one uniquely identified
/// placeholder, so there is no way to mangle the diff and no way to misplace a
/// tag. Whatever is left empty is exactly what the UI marks unexplained.
pub fn render(nonce: &str, info: &ChangeInfo, diff: &str) -> String {
    let mut out = String::new();
    out.push_str(&preamble(nonce));
    out.push('\n');

    out.push_str(&open_tag(nonce, TAG_CHANGE_INFO));
    out.push('\n');
    out.push_str(
        &serde_json::to_string_pretty(info).unwrap_or_else(|_| "{}".to_string()),
    );
    out.push('\n');
    out.push_str(&close_tag(nonce, TAG_CHANGE_INFO));
    out.push('\n');

    out.push_str(&open_tag(nonce, TAG_LOGICAL_CHANGE_TABLE));
    out.push_str("\n[]\n");
    out.push_str(&close_tag(nonce, TAG_LOGICAL_CHANGE_TABLE));
    out.push('\n');

    let mut placeholder = 0;
    for line in diff.lines() {
        out.push_str(line);
        out.push('\n');

        if parse_hunk_counts(line).is_some() {
            placeholder += 1;
            let id = format!("h{placeholder}");
            out.push_str(&open_tag_with_id(nonce, TAG_HUNK_REASON, &id));
            out.push('\n');
            out.push_str(&close_tag_with_id(nonce, TAG_HUNK_REASON, &id));
            out.push('\n');
        }
    }

    out.push_str(&end_tag(nonce));
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONCE: &str = "AB99X7";

    fn sample_diff() -> String {
        [
            "diff --git a/src/one.ts b/src/one.ts",
            "index 1111111..2222222 100644",
            "--- a/src/one.ts",
            "+++ b/src/one.ts",
            "@@ -1,3 +1,3 @@ export const one = () => {",
            " const a = 1;",
            "-const b = 2;",
            "+const b = 3;",
            "@@ -20,2 +20,3 @@",
            " tail();",
            "+added();",
            " end();",
            "diff --git a/src/two.ts b/src/two.ts",
            "index 3333333..4444444 100644",
            "--- a/src/two.ts",
            "+++ b/src/two.ts",
            "@@ -7,1 +7,1 @@",
            "-old();",
            "+new();",
            "",
        ]
        .join("\n")
    }

    fn annotate(diff: &str) -> String {
        render(NONCE, &ChangeInfo::default(), diff)
    }

    #[test]
    fn a_rendered_changelog_strips_back_to_the_diff_it_was_made_from() {
        let diff = sample_diff();
        let changelog = parse(&annotate(&diff)).unwrap();

        assert_eq!(changelog.clean_diff, diff);
        assert!(changelog.complete);
        assert!(changelog.warnings.is_empty());
    }

    #[test]
    fn every_hunk_gets_a_uniquely_identified_placeholder() {
        let rendered = annotate(&sample_diff());
        let changelog = parse(&rendered).unwrap();

        let ids: Vec<_> = changelog.notes.iter().map(|note| note.id.as_str()).collect();
        assert_eq!(ids, ["h1", "h2", "h3"]);

        // Each placeholder is unique text, so an author can fill one by exact
        // match rather than rewriting the file.
        for id in ids {
            let open = format!("{MARKER}:{NONCE}:HUNK_REASON id={id}~~");
            assert_eq!(rendered.matches(&open).count(), 1);
        }
    }

    #[test]
    fn hunks_carry_their_file_and_index() {
        let changelog = parse(&annotate(&sample_diff())).unwrap();
        let located: Vec<_> = changelog
            .notes
            .iter()
            .map(|note| (note.path.as_str(), note.index))
            .collect();

        assert_eq!(
            located,
            [("src/one.ts", 0), ("src/one.ts", 1), ("src/two.ts", 0)]
        );
    }

    #[test]
    fn an_empty_placeholder_means_unexplained_not_an_empty_reason() {
        let changelog = parse(&annotate(&sample_diff())).unwrap();
        assert!(changelog.notes.iter().all(|note| note.reason.is_none()));
        assert!(changelog.notes.iter().all(HunkNote::is_unexplained));
    }

    #[test]
    fn reasons_and_spans_are_read_back() {
        let annotated = [
            &preamble(NONCE),
            &open_tag(NONCE, TAG_LOGICAL_CHANGE_TABLE),
            r#"[{"id": "0", "description": "Reset the error count", "associatedIssues": ["9"]}]"#,
            &close_tag(NONCE, TAG_LOGICAL_CHANGE_TABLE),
            &format!("{MARKER}:{NONCE}:LOGICAL_CHANGE_START id=0 /~~"),
            "diff --git a/src/one.ts b/src/one.ts",
            "--- a/src/one.ts",
            "+++ b/src/one.ts",
            "@@ -1,2 +1,2 @@",
            &open_tag_with_id(NONCE, TAG_HUNK_REASON, "h1"),
            "Counts are read from the database, so they never depend on",
            "the order notifications arrive in.",
            &close_tag_with_id(NONCE, TAG_HUNK_REASON, "h1"),
            "-const b = 2;",
            "+const b = 3;",
            &format!("{MARKER}:{NONCE}:LOGICAL_CHANGE_END id=0 /~~"),
            "@@ -9,1 +9,1 @@",
            "-x();",
            "+y();",
            &end_tag(NONCE),
            "",
        ]
        .join("\n");

        let changelog = parse(&annotated).unwrap();

        assert_eq!(changelog.logical_changes.len(), 1);
        assert_eq!(changelog.logical_changes[0].associated_issues, ["9"]);

        let first = &changelog.notes[0];
        assert!(first.reason.as_deref().unwrap().starts_with("Counts are read"));
        assert_eq!(first.logical_change_ids, ["0"]);
        assert_eq!(first.body, ["-const b = 2;", "+const b = 3;"]);

        // The span closed before the second hunk, so it is not a member.
        let second = &changelog.notes[1];
        assert!(second.logical_change_ids.is_empty());
        assert!(second.is_unexplained());
    }

    /// A change with no issues still carries the field. The UI reads
    /// `associatedIssues.length`, so an omitted array is not a tidier payload -
    /// it is a blank window the moment someone opens that change.
    #[test]
    fn an_empty_issue_list_is_still_serialised() {
        let change = LogicalChange {
            id: "0".into(),
            description: "Reset the error count".into(),
            associated_issues: Vec::new(),
        };

        let json = serde_json::to_string(&change).unwrap();
        assert!(json.contains("\"associatedIssues\":[]"), "{json}");
    }

    #[test]
    fn a_span_may_close_and_reopen_for_the_same_change() {
        let annotated = [
            &preamble(NONCE),
            "diff --git a/a.ts b/a.ts",
            "+++ b/a.ts",
            &format!("{MARKER}:{NONCE}:LOGICAL_CHANGE_START id=7 /~~"),
            "@@ -1,1 +1,1 @@",
            "-one();",
            "+ONE();",
            &format!("{MARKER}:{NONCE}:LOGICAL_CHANGE_END id=7 /~~"),
            "@@ -5,1 +5,1 @@",
            "-two();",
            "+TWO();",
            &format!("{MARKER}:{NONCE}:LOGICAL_CHANGE_START id=7 /~~"),
            "@@ -9,1 +9,1 @@",
            "-three();",
            "+THREE();",
            &format!("{MARKER}:{NONCE}:LOGICAL_CHANGE_END id=7 /~~"),
            &end_tag(NONCE),
            "",
        ]
        .join("\n");

        let membership: Vec<_> = parse(&annotated)
            .unwrap()
            .notes
            .iter()
            .map(|note| note.logical_change_ids.clone())
            .collect();

        assert_eq!(
            membership,
            [vec!["7".to_string()], vec![], vec!["7".to_string()]]
        );
    }

    #[test]
    fn a_tag_carrying_another_nonce_is_diff_content() {
        // Exactly what happens when the change under review is to this format's
        // own documentation or fixtures.
        let diff = [
            "diff --git a/docs/format.md b/docs/format.md",
            "+++ b/docs/format.md",
            "@@ -1,2 +2,3 @@",
            " Example:",
            "+~~DIFFTREK_AI:ZZZZZZ:HUNK_REASON~~",
            "+~~DIFFTREK_AI:ZZZZZZ:/HUNK_REASON~~",
            "",
        ]
        .join("\n");

        let changelog = parse(&annotate(&diff)).unwrap();

        assert_eq!(changelog.clean_diff, diff);
        assert_eq!(changelog.notes.len(), 1);
        assert_eq!(changelog.notes[0].body.len(), 3);
    }

    #[test]
    fn a_tag_at_column_one_inside_a_hunk_is_content() {
        // An added line is `+` then the text, so a real tag can never be here.
        let diff = [
            "diff --git a/x.md b/x.md",
            "+++ b/x.md",
            "@@ -1,1 +1,2 @@",
            " keep",
            &format!("+{}", open_tag(NONCE, TAG_HUNK_REASON)),
            "",
        ]
        .join("\n");

        let changelog = parse(&annotate(&diff)).unwrap();
        assert_eq!(changelog.clean_diff, diff);
        assert!(changelog.notes[0].reason.is_none());
    }

    #[test]
    fn a_blank_context_line_does_not_end_a_hunk() {
        let diff = [
            "diff --git a/b.ts b/b.ts",
            "+++ b/b.ts",
            "@@ -1,4 +1,4 @@",
            " one();",
            "",
            "-two();",
            "+TWO();",
            "",
        ]
        .join("\n");

        let changelog = parse(&annotate(&diff)).unwrap();
        assert_eq!(changelog.clean_diff, diff);
        assert_eq!(changelog.notes[0].body.len(), 4);
    }

    #[test]
    fn a_missing_newline_marker_belongs_to_the_line_before_it() {
        let diff = [
            "diff --git a/c.ts b/c.ts",
            "+++ b/c.ts",
            "@@ -1,1 +1,1 @@",
            "-last();",
            "\\ No newline at end of file",
            "+last();",
            "",
        ]
        .join("\n");

        let changelog = parse(&annotate(&diff)).unwrap();
        assert_eq!(changelog.clean_diff, diff);
        assert_eq!(changelog.notes[0].body.len(), 3);
    }

    #[test]
    fn a_deletion_takes_its_path_from_the_old_side() {
        let diff = [
            "diff --git a/gone.ts b/gone.ts",
            "--- a/gone.ts",
            "+++ /dev/null",
            "@@ -1,1 +0,0 @@",
            "-everything();",
            "",
        ]
        .join("\n");

        let changelog = parse(&annotate(&diff)).unwrap();
        assert_eq!(changelog.notes[0].path, "gone.ts");
    }

    #[test]
    fn an_incomplete_file_is_reported_rather_than_trusted() {
        let rendered = annotate(&sample_diff());
        let truncated: String = rendered
            .lines()
            .filter(|line| !line.starts_with(&format!("{MARKER}:{NONCE}:{TAG_END}")))
            .map(|line| format!("{line}\n"))
            .collect();

        assert!(!parse(&truncated).unwrap().complete);
    }

    #[test]
    fn an_ordinary_diff_is_not_a_changelog() {
        assert_eq!(parse(&sample_diff()).unwrap_err(), ParseError::NotAChangelog);
        assert_eq!(parse("").unwrap_err(), ParseError::NotAChangelog);
    }

    #[test]
    fn a_newer_format_version_is_refused_rather_than_guessed_at() {
        let text = format!("{MARKER} v99 {NONCE}{FENCE}\n");
        assert_eq!(parse(&text).unwrap_err(), ParseError::UnsupportedVersion(99));
    }

    #[test]
    fn a_byte_order_mark_does_not_hide_the_preamble() {
        let text = format!("\u{feff}{}\n", preamble(NONCE));
        assert_eq!(parse(&text).unwrap().nonce, NONCE);
    }

    #[test]
    fn damaged_json_costs_only_itself() {
        let text = [
            &preamble(NONCE),
            &open_tag(NONCE, TAG_CHANGE_INFO),
            "{ not json",
            &close_tag(NONCE, TAG_CHANGE_INFO),
            "diff --git a/a.ts b/a.ts",
            "+++ b/a.ts",
            "@@ -1,1 +1,1 @@",
            "-a();",
            "+b();",
            &end_tag(NONCE),
            "",
        ]
        .join("\n");

        let changelog = parse(&text).unwrap();
        assert_eq!(changelog.warnings.len(), 1);
        assert_eq!(changelog.notes.len(), 1);
        assert!(changelog.complete);
    }

    #[test]
    fn unknown_fields_and_tags_are_ignored_not_fatal() {
        let text = [
            &preamble(NONCE),
            &open_tag(NONCE, TAG_CHANGE_INFO),
            r#"{"author": "claude", "somethingNew": 42}"#,
            &close_tag(NONCE, TAG_CHANGE_INFO),
            &open_tag(NONCE, "FUTURE_TAG"),
            &close_tag(NONCE, "FUTURE_TAG"),
            &end_tag(NONCE),
            "",
        ]
        .join("\n");

        let changelog = parse(&text).unwrap();
        assert_eq!(changelog.info.author.as_deref(), Some("claude"));
    }

    #[test]
    fn hunk_counts_read_both_the_long_and_short_forms() {
        assert!(parse_hunk_counts("@@ -1,3 +1,4 @@").is_some());
        assert!(parse_hunk_counts("@@ -5 +5 @@ fn main() {").is_some());
        assert!(parse_hunk_counts("@@@ -1,2 -1,2 +1,3 @@@").is_none());
        assert!(parse_hunk_counts(" @@ -1,3 +1,4 @@").is_none());
    }
}
