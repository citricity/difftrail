/**
 * Pairing a hunk's lines into two columns.
 *
 * A unified diff is a single sequence: some context, a run of deletions, the
 * additions that replace them, more context. A split view has to decide which
 * deletion sits opposite which addition, and Git does not say — it only says
 * what went and what came.
 *
 * The rule that matches what every side-by-side tool does, and what a reader
 * expects, is positional: within one changed block the first deletion faces
 * the first addition, the second the second, and whichever side runs out first
 * faces blanks for the remainder. Context lines face themselves.
 *
 * Doing this on the hunk rather than in the renderer keeps it testable, and
 * keeps the row model able to say how tall a row is without consulting the DOM.
 */

import type { DiffHunk } from '../types/index.ts';

export interface LinePair {
  /** Index into `hunk.lines` of the original-side line, or null for a blank. */
  left: number | null;
  /** Index into `hunk.lines` of the working-side line, or null for a blank. */
  right: number | null;
}

export function pairHunkLines(hunk: DiffHunk): LinePair[] {
  const pairs: LinePair[] = [];
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    if (lines[i].kind === 'context') {
      pairs.push({ left: i, right: i });
      i += 1;
      continue;
    }

    // Gather the whole changed block before pairing any of it: the additions
    // that replace a run of deletions come after all of them, so neither side
    // is known until the block ends.
    const deletions: number[] = [];
    const additions: number[] = [];

    while (i < lines.length && lines[i].kind === 'delete') {
      deletions.push(i);
      i += 1;
    }
    while (i < lines.length && lines[i].kind === 'add') {
      additions.push(i);
      i += 1;
    }

    const rows = Math.max(deletions.length, additions.length);
    for (let n = 0; n < rows; n += 1) {
      pairs.push({ left: deletions[n] ?? null, right: additions[n] ?? null });
    }
  }

  return pairs;
}
