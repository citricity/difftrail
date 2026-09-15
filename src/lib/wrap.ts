/**
 * Wrapping long lines, in the model rather than in CSS.
 *
 * The whole scroll model rests on knowing every row's height without measuring
 * it, and `white-space: pre-wrap` would take that away — the browser breaks at
 * word boundaries where it can, so the number of visual lines depends on where
 * the spaces happen to fall, and only the DOM would know.
 *
 * Wrapping at a fixed column instead keeps the arithmetic exact: a line is
 * `ceil(length / column)` rows tall, full stop. Diff Trail does the splitting
 * itself, which also puts the line numbers and the continuation marker under
 * its control rather than the layout engine's.
 *
 * Lengths are counted in UTF-16 code units, like everything else here and like
 * the parser's `maxLineLength`. Wide glyphs and astral characters therefore
 * wrap a little early or late; source code rarely notices.
 */

import type { LineRun } from './runs.ts';

/** How many rows a line of `length` characters occupies. */
export function wrapCount(length: number, column: number | null): number {
  if (column === null || column <= 0) return 1;
  return Math.max(1, Math.ceil(length / column));
}

/**
 * Cuts a line's runs into one list per visual row.
 *
 * Runs are split mid-run where a boundary falls inside one, keeping the colour
 * and changed-word shading of the run they came from — so a wrapped identifier
 * stays the same colour either side of the break.
 *
 * Always returns at least one row, so an empty line still occupies its row.
 */
export function wrapRuns(runs: LineRun[], column: number | null): LineRun[][] {
  if (column === null || column <= 0) return [runs];

  const rows: LineRun[][] = [];
  let row: LineRun[] = [];
  let used = 0;

  for (const run of runs) {
    let remaining = run.text;

    while (remaining.length > 0) {
      const take = Math.min(column - used, remaining.length);
      row.push({ ...run, text: remaining.slice(0, take) });
      remaining = remaining.slice(take);
      used += take;

      // Only close the row when it is actually full. A line whose length is an
      // exact multiple of the column ends here with nothing left over, and
      // must not go on to claim an empty row after it.
      if (used === column) {
        rows.push(row);
        row = [];
        used = 0;
      }
    }
  }

  if (row.length > 0 || rows.length === 0) rows.push(row);
  return rows;
}
