/**
 * The AI changelog, as the backend serves it.
 *
 * An agent records *why* it made each change; Diff Trek matches those notes
 * against the diff on screen and shows what still fits. The matching happens in
 * Rust, so everything here is already resolved against the current diff —
 * `hunks` is keyed by the same `<path>:hunk:<index>` id the diff model uses.
 */

/** One intent, covering one or more hunks, possibly across files. */
export interface LogicalChange {
  /** Explicit, so reordering the table cannot remap the markers. */
  id: string;
  description: string;
  associatedIssues: string[];
}

/** What is known about one hunk of the current diff. */
export interface ResolvedHunk {
  hunkId: string;
  /**
   * Usually one. Several when identical hunks were given different reasons, or
   * when an edit merged two annotated changes into one hunk.
   */
  reasons: string[];
  logicalChangeIds: string[];
  /** Identical hunks, different reasons: nothing can choose between them. */
  ambiguous: boolean;
  /**
   * The hunk contains the lines these reasons were written for and more
   * besides — something was edited alongside them since.
   */
  partial: boolean;
}

/** How much of the diff on screen the changelog still describes. */
export interface MatchSummary {
  /** Hunks the changelog knows about. */
  matched: number;
  /** Hunks in the diff. */
  total: number;
  /** Matched hunks with neither a reason nor a logical change. */
  unexplained: number;
  /** Matched hunks that have grown around their notes. */
  partial: number;
  /** Notes describing hunks the diff no longer has. */
  staleNotes: number;
}

export interface AiChangelog {
  /** Also its file name, in `.difftrek/ai_changelog/`. */
  nonce: string;
  /** Whose account of the change this is: `claude`, `copilot`, a person. */
  author: string | null;
  issueTracker: string | null;
  /** Set once the work was committed and the changelog attached to it. */
  commithash: string | null;
  logicalChanges: LogicalChange[];
  /** Keyed by hunk id. Hunks absent from it changed since the notes. */
  hunks: Record<string, ResolvedHunk>;
  summary: MatchSummary;
}

/** Every hunk on screen is accounted for, exactly as it was annotated. */
export function isComplete(summary: MatchSummary): boolean {
  return (
    summary.matched === summary.total &&
    summary.staleNotes === 0 &&
    summary.partial === 0
  );
}

/**
 * Hunks that changed after the notes were written — usually the reader's own
 * later edits, which is why they are never called unexplained.
 */
export function changedSince(summary: MatchSummary): number {
  return summary.total - summary.matched;
}
