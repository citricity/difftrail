/**
 * The virtual row model.
 *
 * These tests pin the arithmetic the scroll behaviour rests on: exact offsets,
 * a total height that matches the sum of the rows, and a binary search that
 * agrees with a linear scan.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRowModel,
  fileAtOffset,
  offsetOfTarget,
  rowAtOffset,
  rowKey,
  visibleRange,
} from './rows.ts';
import type { RowMetrics } from './rows.ts';
import { loadedFile, makeDiff, makeMeta, pendingFile } from '../test/factories.ts';
import type { DocumentFile } from '../types/index.ts';

const METRICS: RowMetrics = {
  lineHeight: 20,
  fileHeaderHeight: 40,
  noticeHeight: 50,
  placeholderHeight: 60,
  fileGap: 10,
  charWidth: 8,
  gutterWidth: 100,
};

function fileWith(path: string, overrides: Partial<DocumentFile>): DocumentFile {
  return { ...loadedFile(path, 1), ...overrides };
}

describe('buildRowModel', () => {
  it('lays a loaded file out as header, then hunk header and lines, then a gap', () => {
    const model = buildRowModel([loadedFile('a.ts', 1)], METRICS);

    expect(model.rows.map((row) => row.kind)).toEqual([
      'file-header',
      'hunk-header',
      'line',
      'line',
      'spacer',
    ]);
  });

  it('reduces an unloaded file to a single placeholder row', () => {
    const model = buildRowModel([pendingFile('huge.ts')], METRICS);

    expect(model.rows.map((row) => row.kind)).toEqual(['file-header', 'placeholder', 'spacer']);
  });

  it('reduces a binary, truncated, collapsed or failed file to one notice row', () => {
    const cases: Array<[string, DocumentFile, string]> = [
      ['binary', fileWith('a', { diff: makeDiff('a', 0, { binary: true }) }), 'binary'],
      ['truncated', fileWith('b', { diff: makeDiff('b', 0, { truncated: true }) }), 'truncated'],
      ['empty', fileWith('c', { diff: makeDiff('c', 0) }), 'empty'],
      ['collapsed', fileWith('d', { collapsed: true }), 'collapsed'],
      ['error', fileWith('e', { status: 'error', diff: null, error: 'boom' }), 'error'],
    ];

    for (const [label, file, expected] of cases) {
      const model = buildRowModel([file], METRICS);
      const notice = model.rows.find((row) => row.kind === 'notice');

      expect(notice, label).toBeDefined();
      expect(notice?.kind === 'notice' ? notice.notice : null, label).toBe(expected);
    }
  });

  it('collapsing a file hides its lines without removing it from the document', () => {
    const expanded = buildRowModel([loadedFile('a.ts', 3)], METRICS);
    const collapsed = buildRowModel([fileWith('a.ts', { collapsed: true })], METRICS);

    expect(expanded.rows.filter((row) => row.kind === 'line').length).toBeGreaterThan(0);
    expect(collapsed.rows.filter((row) => row.kind === 'line')).toHaveLength(0);
    expect(collapsed.fileRowIndex.has('a.ts')).toBe(true);
  });

  it('computes offsets that match a running total of the row heights', () => {
    const model = buildRowModel([loadedFile('a.ts', 1), loadedFile('b.ts', 1)], METRICS);

    // header 40 + hunk 20 + line 20 + line 20 + gap 10 = 110 per file.
    expect(model.offsets[0]).toBe(0);
    expect(model.offsets[1]).toBe(40);
    expect(model.offsets[2]).toBe(60);
    expect(model.totalHeight).toBe(220);
    expect(model.offsets[model.rows.length]).toBe(model.totalHeight);
  });

  it('indexes every file and hunk for direct lookup', () => {
    const model = buildRowModel([loadedFile('a.ts', 2)], METRICS);

    expect(model.fileRowIndex.get('a.ts')).toBe(0);
    expect(model.hunkRowIndex.get('a.ts:hunk:0')).toBe(1);
    expect(model.hunkRowIndex.get('a.ts:hunk:1')).toBe(4);
  });

  it('sizes the horizontal scroll area from the longest line in the whole diff', () => {
    const narrow = fileWith('a.ts', { diff: makeDiff('a.ts', 1, { maxLineLength: 10 }) });
    const wide = fileWith('b.ts', { diff: makeDiff('b.ts', 1, { maxLineLength: 200 }) });

    const model = buildRowModel([narrow, wide], METRICS);

    expect(model.contentWidth).toBe(100 + 200 * 8);
  });

  it('is empty for a clean repository', () => {
    const model = buildRowModel([], METRICS);

    expect(model.rows).toHaveLength(0);
    expect(model.totalHeight).toBe(0);
  });
});

describe('rowAtOffset', () => {
  const model = buildRowModel(
    [loadedFile('a.ts', 2), pendingFile('b.ts'), loadedFile('c.ts', 1)],
    METRICS,
  );

  it('agrees with a linear scan at every pixel', () => {
    for (let y = 0; y < model.totalHeight; y += 1) {
      let expected = 0;
      for (let i = 0; i < model.rows.length; i += 1) {
        if (model.offsets[i] <= y) expected = i;
        else break;
      }

      expect(rowAtOffset(model, y), `y=${y}`).toBe(expected);
    }
  });

  it('clamps above and below the document', () => {
    expect(rowAtOffset(model, -500)).toBe(0);
    expect(rowAtOffset(model, model.totalHeight + 500)).toBe(model.rows.length - 1);
  });

  it('returns row zero for an empty document', () => {
    expect(rowAtOffset(buildRowModel([], METRICS), 0)).toBe(0);
  });
});

describe('visibleRange', () => {
  const model = buildRowModel([loadedFile('a.ts', 4)], METRICS);

  it('covers the viewport', () => {
    const range = visibleRange(model, 100, 80, 0);

    expect(model.offsets[range.start]).toBeLessThanOrEqual(100);
    expect(model.offsets[range.end - 1]).toBeLessThanOrEqual(180);
  });

  it('pads by the overscan without running off either end', () => {
    const padded = visibleRange(model, 100, 80, 3);
    const tight = visibleRange(model, 100, 80, 0);

    expect(padded.start).toBeLessThan(tight.start);
    expect(padded.end).toBeGreaterThan(tight.end);

    const atTop = visibleRange(model, 0, 80, 50);
    expect(atTop.start).toBe(0);
    expect(atTop.end).toBe(model.rows.length);
  });

  it('is empty for an empty document', () => {
    expect(visibleRange(buildRowModel([], METRICS), 0, 500, 5)).toEqual({ start: 0, end: 0 });
  });
});

describe('offsetOfTarget', () => {
  const model = buildRowModel([loadedFile('a.ts', 2), pendingFile('b.ts')], METRICS);

  it('finds a hunk', () => {
    expect(offsetOfTarget(model, 'a.ts', 'a.ts:hunk:1')).toBe(model.offsets[4]);
  });

  it('finds a file when no hunk is named', () => {
    expect(offsetOfTarget(model, 'b.ts', null)).toBe(model.offsets[model.fileRowIndex.get('b.ts')!]);
  });

  it('returns null for a hunk that is not loaded yet, so the caller can wait', () => {
    expect(offsetOfTarget(model, 'b.ts', 'b.ts:hunk:0')).toBeNull();
  });
});

describe('fileAtOffset', () => {
  it('names the file the viewport is inside', () => {
    const model = buildRowModel([loadedFile('a.ts', 1), loadedFile('b.ts', 1)], METRICS);

    expect(fileAtOffset(model, 0)).toBe('a.ts');
    expect(fileAtOffset(model, 115)).toBe('b.ts');
  });

  it('has no answer for an empty document', () => {
    expect(fileAtOffset(buildRowModel([], METRICS), 0)).toBeNull();
  });
});

describe('rowKey', () => {
  it('identifies a row by what it is, so loading a file does not remount the window', () => {
    const before = buildRowModel([pendingFile('a.ts'), loadedFile('b.ts', 1)], METRICS);
    const after = buildRowModel([loadedFile('a.ts', 1), loadedFile('b.ts', 1)], METRICS);

    const keyOf = (model: typeof before, fileId: string) =>
      model.rows.filter((row) => row.fileId === fileId).map(rowKey);

    // b.ts did not change, so its keys are identical even though every one of
    // its row indices shifted when a.ts expanded.
    expect(keyOf(before, 'b.ts')).toEqual(keyOf(after, 'b.ts'));
    expect(before.fileRowIndex.get('b.ts')).not.toBe(after.fileRowIndex.get('b.ts'));
  });

  it('gives every row in a document a distinct key', () => {
    const model = buildRowModel(
      [loadedFile('a.ts', 2), pendingFile('b.ts'), fileWith('c.ts', { collapsed: true })],
      METRICS,
    );

    const keys = model.rows.map(rowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('metadata-only files', () => {
  it('keeps a renamed file in the document', () => {
    const renamed: DocumentFile = {
      meta: makeMeta('new.ts', { oldPath: 'old.ts', status: 'renamed' }),
      status: 'loaded',
      diff: makeDiff('new.ts', 1),
      error: null,
      collapsed: false,
    };

    const model = buildRowModel([renamed], METRICS);
    expect(model.fileRowIndex.has('new.ts')).toBe(true);
  });
});
