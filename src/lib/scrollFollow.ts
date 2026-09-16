/**
 * Which change the reader has scrolled to.
 *
 * Previous/Next Change move the view to a change; this is the other direction —
 * the view moved, so the position readout should follow it. Without it, "3 /
 * 12" keeps naming a hunk the reader scrolled past long ago, and Next jumps
 * back up to the one after it.
 *
 * Like navigation itself, the answer comes from the row model, never from
 * which DOM nodes happen to be rendered.
 */

import type { NavigationEntry } from './navigation.ts';
import { toLocation } from './navigation.ts';
import type { RowModel } from './rows.ts';
import type { ChangeLocation } from '../types/index.ts';

/** Where one navigation entry sits in the document. */
export interface ScrollStop {
  location: ChangeLocation;
  /** Top of the entry's first row. */
  top: number;
  /** Bottom of its last row: a hunk's last line, or a file's last row before its gap. */
  bottom: number;
}

/**
 * The navigation entries that have rows, in document order, with their extent.
 *
 * An entry with no rows — the hunks of a collapsed file — cannot be scrolled
 * to, so it is left out. Rebuild whenever the model or the entries change.
 */
export function buildScrollStops(
  model: RowModel,
  entries: NavigationEntry[],
): ScrollStop[] {
  const stops: ScrollStop[] = [];

  for (const entry of entries) {
    const start =
      entry.kind === 'hunk'
        ? model.hunkRowIndex.get(entry.hunkId)
        : model.fileRowIndex.get(entry.fileId);
    if (start === undefined) continue;

    let end = start + 1;
    if (entry.kind === 'hunk') {
      // A hunk is its header and its lines; expanded context after it is not.
      while (end < model.rows.length) {
        const row = model.rows[end];
        if (!('hunkId' in row) || row.hunkId !== entry.hunkId) break;
        end += 1;
      }
    } else {
      while (end < model.rows.length) {
        const row = model.rows[end];
        if (row.fileId !== entry.fileId || row.kind === 'spacer') break;
        end += 1;
      }
    }

    stops.push({
      location: toLocation(entry),
      top: model.offsets[start],
      bottom: model.offsets[end],
    });
  }

  return stops;
}

/**
 * The change at the reading line, where a reveal puts one — just under the
 * sticky file header.
 *
 * - The change the reading line is inside, if any.
 * - Otherwise the reading line is in a gap (context, an expander, a file
 *   boundary), and the next change counts as soon as it is visible at all.
 * - Otherwise the last change above, which is what Next carries on from.
 *
 * Null when nothing qualifies: above the first change, with none in view.
 */
export function changeInView(
  stops: ScrollStop[],
  readingLine: number,
  viewportBottom: number,
): ChangeLocation | null {
  // Last stop starting at or above the reading line.
  let low = 0;
  let high = stops.length - 1;
  let above = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (stops[mid].top <= readingLine) {
      above = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (above !== -1 && readingLine < stops[above].bottom) {
    return stops[above].location;
  }

  const next = stops[above + 1];
  if (next !== undefined && next.top < viewportBottom) return next.location;

  return above === -1 ? null : stops[above].location;
}
