/**
 * Reading both sides of a file in full.
 *
 * Two features want this and neither works without it: highlighting a side as
 * the whole program it is rather than a hunk-sized fragment, and showing the
 * lines a hunk left out when the reader expands a gap.
 *
 * Both depend on the file on disk still being the file the diff was computed
 * from. That is not guaranteed — the working tree can move under us between
 * the two reads — so every diff line is checked against the text it claims to
 * come from, and a single disagreement withdraws the whole file from both
 * features. Showing the wrong surrounding lines would be worse than showing
 * none, because nothing about them would look wrong.
 */

import type { FileDiff, FileSide, FileText } from '../types/index.ts';
import { getFileContents } from './backend.ts';

/**
 * Lines per side above which a file is left to hunk-local highlighting and no
 * expansion. Tokenising is linear but not free, and this runs before the diff
 * is shown.
 */
const MAX_LINES = 20000;

/**
 * Splits file contents into lines the way Git counts them.
 *
 * Only `\n` separates: a `\r` belongs to the line, because that is how Git
 * reports it in the diff, and stripping it here would fail every comparison on
 * a CRLF file. A single trailing newline terminates the last line rather than
 * starting an empty one.
 */
export function splitLines(contents: string): string[] {
  if (contents === '') return [];

  const body = contents.endsWith('\n') ? contents.slice(0, -1) : contents;
  return body.split('\n');
}

/** The side a diff line was read from, and its line number there. */
function sourceOf(
  line: {
    kind: 'context' | 'add' | 'delete';
    oldLineNumber: number | null;
    newLineNumber: number | null;
  },
  text: FileText,
): { lines: string[] | null; number: number | null } {
  return line.kind === 'delete'
    ? { lines: text.original, number: line.oldLineNumber }
    : { lines: text.working, number: line.newLineNumber };
}

/**
 * Whether every line of the diff is found, unchanged, where the diff says it
 * is. This is the check that makes expanded context trustworthy.
 */
export function matchesDiff(diff: FileDiff, text: FileText): boolean {
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      const { lines, number } = sourceOf(line, text);
      if (lines === null || number === null) return false;
      if (lines[number - 1] !== line.content) return false;
    }
  }

  return true;
}

async function readSide(path: string, side: FileSide): Promise<string[] | null> {
  try {
    const lines = splitLines(await getFileContents(path, side));
    return lines.length > MAX_LINES ? null : lines;
  } catch (thrown) {
    // A side that cannot be read is not an error the reader needs to see —
    // the diff itself is unaffected. It only costs this file its context.
    console.error(`[difftrail] reading ${side} ${path} failed`, thrown);
    return null;
  }
}

/**
 * Both sides of a file, or null if they cannot be trusted.
 *
 * An added file has no original and a deleted file has no working copy; those
 * sides are absent rather than missing, and do not by themselves disqualify
 * the file — the line check decides, since a diff never refers to a side that
 * does not exist.
 */
export async function loadFileText(diff: FileDiff): Promise<FileText | null> {
  if (diff.binary || diff.truncated || diff.hunks.length === 0) return null;

  // Both sides are requested by the file's current path, which is how the
  // backend knows it; the backend reads a rename's original from `oldPath`.
  const [original, working] = await Promise.all([
    diff.status === 'added' ? Promise.resolve(null) : readSide(diff.path, 'original'),
    diff.status === 'deleted' ? Promise.resolve(null) : readSide(diff.path, 'working'),
  ]);

  const text: FileText = { original, working };
  return matchesDiff(diff, text) ? text : null;
}
