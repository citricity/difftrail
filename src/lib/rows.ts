/**
 * The virtual row model.
 *
 * Every changed file in the repository contributes rows to one continuous
 * document. The user perceives a single scrolling page; the DOM only ever
 * holds the slice currently in view.
 *
 * Row heights are known up front — a diff line is exactly one line tall, and
 * headers and notices have fixed heights — so offsets are exact and
 * scroll-to-hunk needs no measurement, no guessing and no reflow. A wrapped
 * line is still exact: it is a whole number of rows tall (see `lib/wrap.ts`).
 * Unwrapped, long lines scroll horizontally instead (see `contentWidth`).
 *
 * Only loaded files expand into line rows. An unloaded file is a single
 * placeholder row, and a diff the backend declined to parse (too large,
 * binary) is a single notice row, which is what keeps this array bounded
 * even in a repository with a very large change set.
 */

import type { DiffHunk, DocumentFile, LineRange, ViewMode } from '../types/index.ts';
import { imageMimeType } from './images.ts';
import { pairHunkLines } from './pairing.ts';
import { splitGap } from './ranges.ts';
import { wrapCount } from './wrap.ts';

export type NoticeKind = 'binary' | 'truncated' | 'empty' | 'error' | 'collapsed';

export type DocumentRow =
  | { kind: 'file-header'; fileId: string }
  | { kind: 'hunk-header'; fileId: string; hunkId: string }
  /** `rows` is how many visual lines it occupies once wrapped; 1 when not. */
  | {
      kind: 'line';
      fileId: string;
      hunkId: string;
      lineIndex: number;
      rows: number;
    }
  /**
   * Lines a hunk left out, still hidden. `above` and `below` say whether the
   * file continues on that side, which is what decides which way the reader
   * can expand.
   */
  | {
      kind: 'expander';
      fileId: string;
      range: LineRange;
      above: boolean;
      below: boolean;
    }
  /**
   * One row of the split view: an original-side line, a working-side line, or
   * both. Either may be null, which renders as a blank facing the other.
   */
  | {
      kind: 'split-line';
      fileId: string;
      hunkId: string;
      left: number | null;
      right: number | null;
      rows: number;
    }
  /** A line of unchanged context the reader expanded into view. */
  | {
      kind: 'context';
      fileId: string;
      lineNumber: number;
      oldLineNumber: number;
      rows: number;
    }
  | { kind: 'notice'; fileId: string; notice: NoticeKind }
  /**
   * A changed image, shown before and after. Its own fixed height, like a
   * notice: the pictures are scaled to fit it, so how large they are never
   * reaches the geometry.
   */
  | { kind: 'image'; fileId: string }
  | { kind: 'placeholder'; fileId: string }
  | { kind: 'spacer'; fileId: string };

export interface RowMetrics {
  /** Height of one diff line, in pixels. Measured from the rendered font. */
  lineHeight: number;
  fileHeaderHeight: number;
  expanderHeight: number;
  noticeHeight: number;
  placeholderHeight: number;
  /** Height of the before-and-after row of a changed image. */
  imageHeight: number;
  /** Vertical gap after each file. */
  fileGap: number;
  /** Width of one monospace character, for the horizontal scroll area. */
  charWidth: number;
  /** Width of the line-number gutter. */
  gutterWidth: number;
  /** Space kept clear after the code on each line, before the edge. */
  contentPadding: number;
}

/** Width of the rule between the split view's panes, in pixels. Matches the CSS. */
export const PANE_DIVIDER_WIDTH = 1;

/**
 * How wide one line's column is: the whole viewport in the unified view, one
 * pane in the split view. Both panes are always the same width.
 */
export function lineAreaWidth(viewportWidth: number, viewMode: ViewMode): number {
  return viewMode === 'split'
    ? Math.max(0, (viewportWidth - PANE_DIVIDER_WIDTH) / 2)
    : Math.max(0, viewportWidth);
}

/**
 * The narrowest column auto wrapping will choose.
 *
 * Below this a squeezed window turns every line into a tower of fragments that
 * is harder to read than scrolling, so the lines stop getting narrower and
 * horizontal scrolling takes over the rest.
 */
export const MIN_AUTO_WRAP_COLUMN = 20;

/**
 * Columns held back from the edge in auto mode.
 *
 * Lengths are UTF-16 code units, so a line holding wide glyphs or astral
 * characters is a little wider than its length says. With a fixed column
 * nobody notices; wrapping at the edge promises the text fits, and without
 * this slack such a line would lose its last character or so to the clip.
 */
export const AUTO_WRAP_MARGIN = 1;

/**
 * The column that fits a line's code into the viewport, for `auto` wrapping.
 *
 * The code font is monospaced, so this is arithmetic like every other wrap:
 * the line's width, less its gutter and trailing padding, in whole characters.
 * In the split view the width is one pane's, and both panes share the result.
 *
 * Null until the viewport has been measured, which the caller turns into a
 * fallback rather than laying the document out for a width of zero.
 */
export function autoWrapColumn(
  viewportWidth: number,
  metrics: RowMetrics,
  viewMode: ViewMode,
): number | null {
  if (viewportWidth <= 0 || metrics.charWidth <= 0) return null;

  const codeWidth =
    lineAreaWidth(viewportWidth, viewMode) -
    metrics.gutterWidth -
    metrics.contentPadding;

  return Math.max(
    MIN_AUTO_WRAP_COLUMN,
    Math.floor(codeWidth / metrics.charWidth) - AUTO_WRAP_MARGIN,
  );
}

export interface RowModel {
  rows: DocumentRow[];
  /** `offsets[i]` is the top of row `i`; the last entry is the total height. */
  offsets: Float64Array;
  totalHeight: number;
  /** Row index of each file's header row. */
  fileRowIndex: Map<string, number>;
  /** Row index of each hunk's header row. */
  hunkRowIndex: Map<string, number>;
  /** Width the horizontal scroll area must allow for. */
  contentWidth: number;
}

function heightOf(row: DocumentRow, metrics: RowMetrics): number {
  switch (row.kind) {
    case 'file-header':
      return metrics.fileHeaderHeight;
    case 'hunk-header':
      return metrics.lineHeight;
    case 'line':
    case 'split-line':
    case 'context':
      return metrics.lineHeight * row.rows;
    case 'expander':
      return metrics.expanderHeight;
    case 'notice':
      return metrics.noticeHeight;
    case 'placeholder':
      return metrics.placeholderHeight;
    case 'image':
      return metrics.imageHeight;
    case 'spacer':
      return metrics.fileGap;
  }
}

/**
 * The lines a hunk occupies on one side.
 *
 * Git writes a zero-length side as `+c,0`, where `c` is the last line *before*
 * the change rather than the first line of it. Returning an empty span that
 * starts after `c` keeps the arithmetic below uniform: the gap before the hunk
 * still ends at `start - 1`, and the gap after it still begins at `end + 1`.
 */
function span(start: number, count: number): LineRange {
  return count === 0
    ? { start: start + 1, end: start }
    : { start, end: start + count - 1 };
}

function newSpan(hunk: DiffHunk): LineRange {
  return span(hunk.newStart, hunk.newLines);
}

function oldSpan(hunk: DiffHunk): LineRange {
  return span(hunk.oldStart, hunk.oldLines);
}

/** Which notice, if any, stands in for a file's body. */
function noticeFor(file: DocumentFile): NoticeKind | null {
  if (file.collapsed) return 'collapsed';
  if (file.status === 'error') return 'error';
  if (file.diff === null) return null;
  // A binary image is shown rather than excused; see `buildRowModel`.
  if (file.diff.binary) return imageMimeType(file.meta.path) === null ? 'binary' : null;
  if (file.diff.truncated) return 'truncated';
  if (file.diff.hunks.length === 0) return 'empty';
  return null;
}

/**
 * Builds the document's rows.
 *
 * `wrapColumn` is the column long lines wrap at, or null to let them scroll
 * horizontally instead. Wrapping is resolved here rather than in CSS so that
 * every row's height stays exact arithmetic — see `lib/wrap.ts`.
 */
export function buildRowModel(
  files: DocumentFile[],
  metrics: RowMetrics,
  wrapColumn: number | null = null,
  viewMode: ViewMode = 'unified',
): RowModel {
  const split = viewMode === 'split';
  const rows: DocumentRow[] = [];
  const fileRowIndex = new Map<string, number>();
  const hunkRowIndex = new Map<string, number>();
  let maxLineLength = 0;

  for (const file of files) {
    const fileId = file.meta.id;

    fileRowIndex.set(fileId, rows.length);
    rows.push({ kind: 'file-header', fileId });

    const notice = noticeFor(file);

    if (notice !== null) {
      rows.push({ kind: 'notice', fileId, notice });
    } else if (file.diff === null) {
      rows.push({ kind: 'placeholder', fileId });
    } else if (file.diff.binary) {
      // `noticeFor` only lets a binary file through when it is an image.
      rows.push({ kind: 'image', fileId });
    } else {
      if (file.diff.maxLineLength > maxLineLength) {
        maxLineLength = file.diff.maxLineLength;
      }

      const hunks = file.diff.hunks;

      /**
       * Expansion needs the working file: gaps are the lines the hunks left
       * out of it. A file without one — a deletion — has no gaps to begin
       * with, since its diff covers all of it.
       */
      const working = file.text?.working ?? null;

      /**
       * Emits one gap, as an expander per hidden run and context rows per
       * revealed one. `delta` converts a working-side line number to its
       * original-side counterpart, which is constant across a gap because
       * nothing in it changed.
       */
      const emitGap = (gap: LineRange, delta: number): void => {
        if (working === null) return;

        for (const segment of splitGap(gap, file.revealed)) {
          if (segment.kind === 'hidden') {
            rows.push({
              kind: 'expander',
              fileId,
              range: segment.range,
              above: segment.range.start > 1,
              below: segment.range.end < working.length,
            });
            continue;
          }

          for (let n = segment.range.start; n <= segment.range.end; n += 1) {
            const content = working[n - 1] ?? '';
            if (content.length > maxLineLength) maxLineLength = content.length;

            rows.push({
              kind: 'context',
              fileId,
              lineNumber: n,
              oldLineNumber: n + delta,
              rows: wrapCount(content.length, wrapColumn),
            });
          }
        }
      };

      if (hunks.length > 0) {
        const first = hunks[0];
        emitGap(
          { start: 1, end: newSpan(first).start - 1 },
          oldSpan(first).start - newSpan(first).start,
        );
      }

      hunks.forEach((hunk, index) => {
        hunkRowIndex.set(hunk.id, rows.length);
        rows.push({ kind: 'hunk-header', fileId, hunkId: hunk.id });

        if (split) {
          // A split row is as tall as its taller side: the two panes share a
          // baseline, so a line that wraps on one side pushes the other's
          // blank space down with it.
          for (const pair of pairHunkLines(hunk)) {
            const height = Math.max(
              pair.left === null
                ? 1
                : wrapCount(hunk.lines[pair.left].content.length, wrapColumn),
              pair.right === null
                ? 1
                : wrapCount(hunk.lines[pair.right].content.length, wrapColumn),
            );

            rows.push({
              kind: 'split-line',
              fileId,
              hunkId: hunk.id,
              left: pair.left,
              right: pair.right,
              rows: height,
            });
          }
        } else {
          for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex += 1) {
            rows.push({
              kind: 'line',
              fileId,
              hunkId: hunk.id,
              lineIndex,
              rows: wrapCount(hunk.lines[lineIndex].content.length, wrapColumn),
            });
          }
        }

        const next = hunks[index + 1];
        const start = newSpan(hunk).end + 1;

        // A middle gap can be measured from either hunk it sits between and
        // the answers agree, because the lines in it are unchanged. The one
        // after the last hunk has only the hunk above to go on.
        if (next === undefined) {
          emitGap(
            { start, end: working?.length ?? 0 },
            oldSpan(hunk).end - newSpan(hunk).end,
          );
        } else {
          emitGap(
            { start, end: newSpan(next).start - 1 },
            oldSpan(next).start - newSpan(next).start,
          );
        }
      });
    }

    rows.push({ kind: 'spacer', fileId });
  }

  const offsets = new Float64Array(rows.length + 1);
  let top = 0;
  for (let i = 0; i < rows.length; i += 1) {
    offsets[i] = top;
    top += heightOf(rows[i], metrics);
  }
  offsets[rows.length] = top;

  return {
    rows,
    offsets,
    totalHeight: top,
    fileRowIndex,
    hunkRowIndex,
    // Wrapping caps the horizontal extent at the wrap column — there is
    // nothing further right to scroll to — but a document of short lines is
    // narrower still.
    contentWidth:
      metrics.gutterWidth +
      (wrapColumn === null ? maxLineLength : Math.min(maxLineLength, wrapColumn)) *
        metrics.charWidth,
  };
}

/**
 * Index of the row containing vertical position `y`.
 *
 * Binary search over the offsets, so this stays O(log n) however many rows the
 * document holds.
 */
export function rowAtOffset(model: RowModel, y: number): number {
  const { offsets, rows } = model;
  if (rows.length === 0) return 0;

  let low = 0;
  let high = rows.length - 1;

  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid] <= y) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

export interface RowRange {
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * The slice of rows to render for a viewport, padded by `overscan` rows on
 * each side so that fast scrolling does not reveal blank space.
 */
export function visibleRange(
  model: RowModel,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): RowRange {
  if (model.rows.length === 0) return { start: 0, end: 0 };

  const first = rowAtOffset(model, scrollTop);
  const last = rowAtOffset(model, scrollTop + viewportHeight);

  return {
    start: Math.max(0, first - overscan),
    end: Math.min(model.rows.length, last + overscan + 1),
  };
}

/**
 * Vertical position of a hunk, or of a file when `hunkId` is null.
 *
 * Returns null when the target is not in the current model — normally because
 * its file has not been loaded yet, which the caller resolves by loading it
 * and asking again.
 */
export function offsetOfTarget(
  model: RowModel,
  fileId: string,
  hunkId: string | null,
): number | null {
  const rowIndex =
    hunkId === null ? model.fileRowIndex.get(fileId) : model.hunkRowIndex.get(hunkId);

  if (rowIndex === undefined) return null;
  return model.offsets[rowIndex];
}

/**
 * The bottom of a hunk's last row, for revealing the far end of a block.
 *
 * `offsetOfTarget` answers where a hunk begins, which is what a jump to a
 * change normally wants. The marker at the end of a run wants the other edge:
 * a run of one long hunk still has a top and a bottom, tens of lines apart,
 * and an arrow that took the reader to the top of the hunk they are already in
 * would look broken.
 */
export function offsetOfHunkEnd(
  model: RowModel,
  hunkId: string,
): number | null {
  const header = model.hunkRowIndex.get(hunkId);
  if (header === undefined) return null;

  let last = header;
  for (let index = header + 1; index < model.rows.length; index += 1) {
    const row = model.rows[index];
    const belongs =
      row !== undefined &&
      (row.kind === 'line' || row.kind === 'split-line') &&
      row.hunkId === hunkId;

    if (!belongs) break;
    last = index;
  }

  return model.offsets[last + 1] ?? null;
}

/**
 * A key that identifies a row by what it *is* rather than where it sits.
 *
 * Row indices shift every time a file's diff arrives, so keying React on the
 * index would remount the whole window on each load.
 */
export function rowKey(row: DocumentRow): string {
  switch (row.kind) {
    case 'file-header':
      return `f:${row.fileId}`;
    case 'hunk-header':
      return `h:${row.hunkId}`;
    case 'line':
      return `l:${row.hunkId}:${row.lineIndex}`;
    case 'split-line':
      return `s:${row.hunkId}:${row.left ?? 'x'}:${row.right ?? 'x'}`;
    case 'expander':
      return `x:${row.fileId}:${row.range.start}`;
    case 'context':
      return `c:${row.fileId}:${row.lineNumber}`;
    case 'notice':
      return `n:${row.fileId}:${row.notice}`;
    case 'placeholder':
      return `p:${row.fileId}`;
    case 'image':
      return `i:${row.fileId}`;
    case 'spacer':
      return `s:${row.fileId}`;
  }
}

/** Breathing room above a revealed change, on top of the sticky file header. */
export const SCROLL_MARGIN = 8;

/**
 * The least height of the end-of-document section: enough for its message and
 * mascot, in a window tall enough that nothing else is needed.
 */
export const END_OF_DOCUMENT_MIN_HEIGHT = 220;

/**
 * How tall the space after the last file is.
 *
 * Revealing a change scrolls it to just under the sticky file header. Near the
 * end of the document there used to be too little below to scroll that far, so
 * the change stopped partway down the viewport and the sticky header went on
 * naming the file above it. This space is what makes every change revealable:
 * it is at least a viewport tall, less the header and margin a reveal leaves
 * above its target, so even a change in the last row can reach that position.
 *
 * It sits outside the row model on purpose. It depends on the viewport's
 * height, which the model does not know and should not be rebuilt for, and it
 * is not part of any file — so offsets, the binary search and the navigation
 * index are untouched. `DiffDocument` adds it to the canvas below
 * `model.totalHeight`.
 */
export function endOfDocumentHeight(
  viewportHeight: number,
  metrics: RowMetrics,
): number {
  return Math.max(
    END_OF_DOCUMENT_MIN_HEIGHT,
    viewportHeight - metrics.fileHeaderHeight - SCROLL_MARGIN,
  );
}

/**
 * Where the reader is, in terms that survive a rebuild of the model.
 *
 * An offset does not: when the wrap column changes, every wrapped line above
 * the viewport changes height, so the same `scrollTop` lands somewhere else
 * entirely. So the position is recorded as the row at the top of the viewport
 * — by key, which does not depend on index or height — and how far down that
 * row the top edge was.
 */
export interface ScrollAnchor {
  key: string;
  fileId: string;
  /** 0 at the row's top edge, approaching 1 at its bottom. */
  fraction: number;
}

export function anchorAt(model: RowModel, scrollTop: number): ScrollAnchor | null {
  if (model.rows.length === 0) return null;

  const index = rowAtOffset(model, scrollTop);
  const row = model.rows[index];
  const top = model.offsets[index];
  const height = model.offsets[index + 1] - top;

  return {
    key: rowKey(row),
    fileId: row.fileId,
    fraction: height > 0 ? Math.min(1, Math.max(0, (scrollTop - top) / height)) : 0,
  };
}

/**
 * The `scrollTop` that puts an anchor back at the top of the viewport, or null
 * when its file is no longer in the model.
 *
 * The search starts at the anchor's file header and stops at the next file,
 * so it costs one file's rows rather than the document's. The fraction is
 * applied to the row's new height, which keeps the same part of a wrapped
 * line in view as it grows or shrinks.
 *
 * When the row itself has gone but its file has not — a placeholder replaced
 * by the diff it stood for, a collapsed file's lines, rows whose kind changed
 * with the view mode — the file's header stands in. Staying in the right file
 * is what matters; the offset would otherwise stay put while everything above
 * it moved.
 */
export function offsetOfAnchor(model: RowModel, anchor: ScrollAnchor): number | null {
  const start = model.fileRowIndex.get(anchor.fileId);
  if (start === undefined) return null;

  for (let index = start; index < model.rows.length; index += 1) {
    const row = model.rows[index];
    if (row.fileId !== anchor.fileId) break;
    if (rowKey(row) !== anchor.key) continue;

    const top = model.offsets[index];
    const height = model.offsets[index + 1] - top;
    return top + anchor.fraction * height;
  }

  return model.offsets[start];
}

/**
 * The file whose header is closest above `scrollTop` — what a sticky header
 * should be showing.
 */
export function fileAtOffset(model: RowModel, scrollTop: number): string | null {
  if (model.rows.length === 0) return null;
  return model.rows[rowAtOffset(model, scrollTop)].fileId;
}
