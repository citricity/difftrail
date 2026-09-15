/**
 * Line ranges, for the context a reader has asked to see.
 *
 * A file's hunks leave gaps between them. Expanding a gap reveals part of it,
 * possibly from either end and possibly more than once, so what a file "has
 * revealed" is a set of ranges rather than a count — and the row model has to
 * be able to ask, for any gap, which parts of it are now visible and which are
 * still hidden.
 *
 * Ranges are inclusive and one-based, because that is what line numbers are.
 */

import type { LineRange } from '../types/index.ts';

export function rangeLength(range: LineRange): number {
  return Math.max(0, range.end - range.start + 1);
}

/**
 * Adds a range to a revealed set, keeping it sorted, non-overlapping and
 * coalesced.
 *
 * Adjacent ranges are merged as well as overlapping ones: revealing lines
 * 10–19 and then 20–29 is one block of context to the reader, and leaving it
 * as two would put a zero-line expander between them.
 */
export function addRange(ranges: LineRange[], added: LineRange): LineRange[] {
  if (rangeLength(added) === 0) return ranges;

  const merged: LineRange[] = [];
  let pending = added;

  for (const range of ranges) {
    if (range.end + 1 < pending.start) {
      merged.push(range);
    } else if (pending.end + 1 < range.start) {
      merged.push(pending);
      pending = range;
    } else {
      pending = {
        start: Math.min(pending.start, range.start),
        end: Math.max(pending.end, range.end),
      };
    }
  }

  merged.push(pending);
  return merged;
}

export interface GapSegment {
  kind: 'hidden' | 'shown';
  range: LineRange;
}

/**
 * Splits a gap into the alternating runs the row model renders: an expander
 * for each hidden run, context lines for each shown one.
 *
 * Revealing the middle of a gap therefore leaves an expander on either side of
 * the new context, which is what makes repeated expansion converge on the
 * whole file.
 */
export function splitGap(gap: LineRange, revealed: LineRange[]): GapSegment[] {
  if (rangeLength(gap) === 0) return [];

  const segments: GapSegment[] = [];
  let cursor = gap.start;

  for (const range of revealed) {
    if (range.end < cursor) continue;
    if (range.start > gap.end) break;

    const start = Math.max(range.start, gap.start);
    const end = Math.min(range.end, gap.end);

    if (start > cursor) {
      segments.push({ kind: 'hidden', range: { start: cursor, end: start - 1 } });
    }

    segments.push({ kind: 'shown', range: { start, end } });
    cursor = end + 1;
  }

  if (cursor <= gap.end) {
    segments.push({ kind: 'hidden', range: { start: cursor, end: gap.end } });
  }

  return segments;
}
