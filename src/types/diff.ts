/**
 * Diff Trail's domain model.
 *
 * These types mirror the Rust structures in `src-tauri/src/git/model.rs`.
 * Keep the two in step: the Rust side serialises with `rename_all = "camelCase"`.
 */

export type FileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechanged';

export type LineKind = 'context' | 'add' | 'delete';

export interface DiffLine {
  kind: LineKind;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
  /** Git emitted `\ No newline at end of file` after this line. */
  noNewline: boolean;
}

export interface DiffHunk {
  /** `<path>:hunk:<index>` — stable for the lifetime of one diff snapshot. */
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The function/section context Git appends after the `@@` marker. */
  heading: string | null;
  lines: DiffLine[];
}

/** Lightweight metadata for the complete file list, returned before any bodies. */
export interface ChangedFile {
  id: string;
  path: string;
  oldPath: string | null;
  status: FileStatus;
  /** `null` for binary files, where Git reports no counts. */
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

/** One file's parsed diff body. */
export interface FileDiff {
  id: string;
  path: string;
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  /** The diff exceeded the byte budget; `hunks` is empty until re-requested. */
  truncated: boolean;
  additions: number;
  deletions: number;
  /** Longest line in characters, used to size the horizontal scroll area. */
  maxLineLength: number;
  hunks: DiffHunk[];
}

export interface RepositoryInfo {
  root: string;
  name: string;
  /** `null` when HEAD is detached. */
  branch: string | null;
  /** `null` in a repository with no commits. */
  head: string | null;
  detached: boolean;
  /**
   * Set when Diff Trail was launched with a commit or range
   * (`git dt main...HEAD`) instead of reviewing the working tree.
   */
  comparison: ComparisonInfo | null;
}

/** A commit or range given on the command line. */
export interface ComparisonInfo {
  /** The arguments as typed, e.g. `main...HEAD`. */
  label: string;
  /** Abbreviated base commit; `null` for a root commit, compared against nothing. */
  base: string | null;
  /** Abbreviated target commit. */
  target: string;
}

/** Which side of the comparison to read whole-file contents from. */
export type FileSide = 'original' | 'working';

/** An inclusive, one-based span of line numbers. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * Both sides of a file, in full.
 *
 * Fetched alongside the diff and used for two things at once: highlighting
 * each side as the whole program it is rather than as a hunk-sized fragment,
 * and supplying the surrounding lines when the reader expands a gap.
 *
 * A side is null when it does not exist — an added file has no original, a
 * deleted file has no working copy. Present only when every diff line was
 * found to match the file it came from; see `loadFileText`.
 */
export interface FileText {
  original: string[] | null;
  working: string[] | null;
}

/**
 * A position in the global change sequence.
 *
 * `hunkId` is null when the target is the file itself rather than one of its
 * hunks — an unloaded file, or one with no hunks to show (binary, truncated).
 */
export interface ChangeLocation {
  fileId: string;
  hunkId: string | null;
}

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * A file in the document, combining its metadata with whatever we have loaded.
 *
 * The three concepts the architecture keeps apart — present in the diff,
 * loaded, rendered — meet here only in the first two. Rendering is decided
 * separately by the virtualiser.
 */
export interface DocumentFile {
  meta: ChangedFile;
  status: LoadStatus;
  diff: FileDiff | null;
  error: string | null;
  /** User has collapsed this file's body in the document. */
  collapsed: boolean;
  /** Both sides in full, when they could be read and matched to the diff. */
  text: FileText | null;
  /**
   * Context the reader has expanded, in working-side line numbers. Sorted,
   * non-overlapping and coalesced — see `lib/ranges.ts`.
   */
  revealed: LineRange[];
}
