/**
 * The virtual row model.
 *
 * Every changed file in the repository contributes rows to one continuous
 * document. The user perceives a single scrolling page; the DOM only ever
 * holds the slice currently in view.
 *
 * Row heights are known up front — a diff line is exactly one line tall, and
 * headers and notices have fixed heights — so offsets are exact and
 * scroll-to-hunk needs no measurement, no guessing and no reflow. Rows never
 * wrap: long lines scroll horizontally instead (see `contentWidth`).
 *
 * Only loaded files expand into line rows. An unloaded file is a single
 * placeholder row, and a diff the backend declined to parse (too large,
 * binary) is a single notice row, which is what keeps this array bounded
 * even in a repository with a very large change set.
 */

import type { DocumentFile } from '../types/index.ts';

export type NoticeKind =
  | 'binary'
  | 'truncated'
  | 'empty'
  | 'error'
  | 'collapsed';

export type DocumentRow =
  | { kind: 'file-header'; fileId: string }
  | { kind: 'hunk-header'; fileId: string; hunkId: string }
  | { kind: 'line'; fileId: string; hunkId: string; lineIndex: number }
  | { kind: 'notice'; fileId: string; notice: NoticeKind }
  | { kind: 'placeholder'; fileId: string }
  | { kind: 'spacer'; fileId: string };

export interface RowMetrics {
  /** Height of one diff line, in pixels. Measured from the rendered font. */
  lineHeight: number;
  fileHeaderHeight: number;
  noticeHeight: number;
  placeholderHeight: number;
  /** Vertical gap after each file. */
  fileGap: number;
  /** Width of one monospace character, for the horizontal scroll area. */
  charWidth: number;
  /** Width of the line-number gutter. */
  gutterWidth: number;
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
    case 'line':
      return metrics.lineHeight;
    case 'notice':
      return metrics.noticeHeight;
    case 'placeholder':
      return metrics.placeholderHeight;
    case 'spacer':
      return metrics.fileGap;
  }
}

/** Which notice, if any, stands in for a file's body. */
function noticeFor(file: DocumentFile): NoticeKind | null {
  if (file.collapsed) return 'collapsed';
  if (file.status === 'error') return 'error';
  if (file.diff === null) return null;
  if (file.diff.binary) return 'binary';
  if (file.diff.truncated) return 'truncated';
  if (file.diff.hunks.length === 0) return 'empty';
  return null;
}

export function buildRowModel(
  files: DocumentFile[],
  metrics: RowMetrics,
): RowModel {
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
    } else {
      if (file.diff.maxLineLength > maxLineLength) {
        maxLineLength = file.diff.maxLineLength;
      }

      for (const hunk of file.diff.hunks) {
        hunkRowIndex.set(hunk.id, rows.length);
        rows.push({ kind: 'hunk-header', fileId, hunkId: hunk.id });

        for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex += 1) {
          rows.push({ kind: 'line', fileId, hunkId: hunk.id, lineIndex });
        }
      }
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
    contentWidth: metrics.gutterWidth + maxLineLength * metrics.charWidth,
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
    hunkId === null
      ? model.fileRowIndex.get(fileId)
      : model.hunkRowIndex.get(hunkId);

  if (rowIndex === undefined) return null;
  return model.offsets[rowIndex];
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
    case 'notice':
      return `n:${row.fileId}:${row.notice}`;
    case 'placeholder':
      return `p:${row.fileId}`;
    case 'spacer':
      return `s:${row.fileId}`;
  }
}

/**
 * The file whose header is closest above `scrollTop` — what a sticky header
 * should be showing.
 */
export function fileAtOffset(model: RowModel, scrollTop: number): string | null {
  if (model.rows.length === 0) return null;
  return model.rows[rowAtOffset(model, scrollTop)].fileId;
}
