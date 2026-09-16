/**
 * The virtual row model.
 *
 * These tests pin the arithmetic the scroll behaviour rests on: exact offsets,
 * a total height that matches the sum of the rows, and a binary search that
 * agrees with a linear scan.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTO_WRAP_MARGIN,
  MIN_AUTO_WRAP_COLUMN,
  anchorAt,
  autoWrapColumn,
  buildRowModel,
  fileAtOffset,
  offsetOfAnchor,
  offsetOfTarget,
  rowAtOffset,
  rowKey,
  visibleRange,
} from './rows.ts';
import type { RowMetrics } from './rows.ts';
import {
  loadedFile,
  makeDiff,
  makeHunk,
  makeLine,
  makeMeta,
  pendingFile,
} from '../test/factories.ts';
import type { DocumentFile } from '../types/index.ts';

const METRICS: RowMetrics = {
  lineHeight: 20,
  fileHeaderHeight: 40,
  expanderHeight: 24,
  noticeHeight: 50,
  placeholderHeight: 60,
  fileGap: 10,
  charWidth: 8,
  gutterWidth: 100,
  contentPadding: 16,
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

    expect(model.rows.map((row) => row.kind)).toEqual([
      'file-header',
      'placeholder',
      'spacer',
    ]);
  });

  it('reduces a binary, truncated, collapsed or failed file to one notice row', () => {
    const cases: Array<[string, DocumentFile, string]> = [
      ['binary', fileWith('a', { diff: makeDiff('a', 0, { binary: true }) }), 'binary'],
      [
        'truncated',
        fileWith('b', { diff: makeDiff('b', 0, { truncated: true }) }),
        'truncated',
      ],
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

    expect(expanded.rows.filter((row) => row.kind === 'line').length).toBeGreaterThan(
      0,
    );
    expect(collapsed.rows.filter((row) => row.kind === 'line')).toHaveLength(0);
    expect(collapsed.fileRowIndex.has('a.ts')).toBe(true);
  });

  it('computes offsets that match a running total of the row heights', () => {
    const model = buildRowModel(
      [loadedFile('a.ts', 1), loadedFile('b.ts', 1)],
      METRICS,
    );

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
    const narrow = fileWith('a.ts', {
      diff: makeDiff('a.ts', 1, { maxLineLength: 10 }),
    });
    const wide = fileWith('b.ts', {
      diff: makeDiff('b.ts', 1, { maxLineLength: 200 }),
    });

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
    expect(visibleRange(buildRowModel([], METRICS), 0, 500, 5)).toEqual({
      start: 0,
      end: 0,
    });
  });
});

describe('offsetOfTarget', () => {
  const model = buildRowModel([loadedFile('a.ts', 2), pendingFile('b.ts')], METRICS);

  it('finds a hunk', () => {
    expect(offsetOfTarget(model, 'a.ts', 'a.ts:hunk:1')).toBe(model.offsets[4]);
  });

  it('finds a file when no hunk is named', () => {
    expect(offsetOfTarget(model, 'b.ts', null)).toBe(
      model.offsets[model.fileRowIndex.get('b.ts')!],
    );
  });

  it('returns null for a hunk that is not loaded yet, so the caller can wait', () => {
    expect(offsetOfTarget(model, 'b.ts', 'b.ts:hunk:0')).toBeNull();
  });
});

describe('fileAtOffset', () => {
  it('names the file the viewport is inside', () => {
    const model = buildRowModel(
      [loadedFile('a.ts', 1), loadedFile('b.ts', 1)],
      METRICS,
    );

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
    const after = buildRowModel(
      [loadedFile('a.ts', 1), loadedFile('b.ts', 1)],
      METRICS,
    );

    const keyOf = (model: typeof before, fileId: string) =>
      model.rows.filter((row) => row.fileId === fileId).map(rowKey);

    // b.ts did not change, so its keys are identical even though every one of
    // its row indices shifted when a.ts expanded.
    expect(keyOf(before, 'b.ts')).toEqual(keyOf(after, 'b.ts'));
    expect(before.fileRowIndex.get('b.ts')).not.toBe(after.fileRowIndex.get('b.ts'));
  });

  it('gives every row in a document a distinct key', () => {
    const model = buildRowModel(
      [
        loadedFile('a.ts', 2),
        pendingFile('b.ts'),
        fileWith('c.ts', { collapsed: true }),
      ],
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
      text: null,
      revealed: [],
    };

    const model = buildRowModel([renamed], METRICS);
    expect(model.fileRowIndex.has('new.ts')).toBe(true);
  });
});

describe('expanding context', () => {
  /**
   * One hunk covering new lines 21-22 of a 60-line file, so there is a gap of
   * 20 lines above it and 38 below. The old side sits two lines earlier, which
   * is what the context rows' left-hand numbers have to reflect.
   */
  function withContext(revealed: DocumentFile['revealed'] = []): DocumentFile {
    const hunk = makeHunk('a.ts', 0, [
      makeLine('delete', 'was', { old: 19 }),
      makeLine('add', 'is', { new: 21 }),
      makeLine('context', 'same', { old: 20, new: 22 }),
    ]);

    const file = loadedFile('a.ts', 1);
    return {
      ...file,
      diff: {
        ...makeDiff('a.ts', 1),
        hunks: [{ ...hunk, oldStart: 19, newStart: 21 }],
      },
      text: {
        original: Array.from({ length: 58 }, (_, i) => `old ${i + 1}`),
        working: Array.from({ length: 60 }, (_, i) => `line ${i + 1}`),
      },
      revealed,
    };
  }

  const kinds = (file: DocumentFile) =>
    buildRowModel([file], METRICS).rows.map((row) => row.kind);

  it('puts an expander on each side of a hunk that hides lines', () => {
    expect(kinds(withContext())).toEqual([
      'file-header',
      'expander',
      'hunk-header',
      'line',
      'line',
      'line',
      'expander',
      'spacer',
    ]);
  });

  it('offers no expander where there is nothing hidden', () => {
    // A file with no text loaded cannot expand, whatever its hunks.
    const file = loadedFile('a.ts', 1);
    expect(kinds(file)).not.toContain('expander');
  });

  it('turns a revealed range into context rows', () => {
    const rows = buildRowModel([withContext([{ start: 11, end: 20 }])], METRICS).rows;
    const context = rows.filter((row) => row.kind === 'context');

    expect(context).toHaveLength(10);
    expect(rows.map((row) => row.kind).slice(0, 4)).toEqual([
      'file-header',
      'expander',
      'context',
      'context',
    ]);
  });

  it('numbers revealed context correctly on both sides', () => {
    const rows = buildRowModel([withContext([{ start: 11, end: 20 }])], METRICS).rows;
    const first = rows.find((row) => row.kind === 'context');

    // New line 11 is old line 9: the hunk's old side starts two lines earlier.
    expect(first).toEqual({
      kind: 'context',
      fileId: 'a.ts',
      lineNumber: 11,
      oldLineNumber: 9,
      rows: 1,
    });
  });

  it('leaves an expander on both sides of context revealed mid-gap', () => {
    const rows = buildRowModel([withContext([{ start: 6, end: 10 }])], METRICS).rows;

    expect(rows.map((row) => row.kind).slice(0, 9)).toEqual([
      'file-header',
      'expander',
      'context',
      'context',
      'context',
      'context',
      'context',
      'expander',
      'hunk-header',
    ]);
  });

  it('marks which sides an expander can grow towards', () => {
    const rows = buildRowModel([withContext()], METRICS).rows;
    const expanders = rows.filter((row) => row.kind === 'expander');

    // Nothing above the top of the file; nothing below the bottom.
    expect(expanders[0]).toMatchObject({
      range: { start: 1, end: 20 },
      above: false,
      below: true,
    });
    expect(expanders[1]).toMatchObject({
      range: { start: 23, end: 60 },
      above: true,
      below: false,
    });
  });

  it('widens the scroll area for long revealed lines', () => {
    const file = withContext([{ start: 1, end: 20 }]);
    const long = 'x'.repeat(400);
    file.text = { ...file.text!, working: [...file.text!.working!] };
    file.text.working![4] = long;

    const model = buildRowModel([file], METRICS);
    expect(model.contentWidth).toBe(METRICS.gutterWidth + 400 * METRICS.charWidth);
  });

  it('still gives every row a distinct key', () => {
    const model = buildRowModel([withContext([{ start: 1, end: 20 }])], METRICS);
    const keys = model.rows.map(rowKey);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('wrapping', () => {
  const long = 'x'.repeat(250);

  function fileWithLongLine(): DocumentFile {
    const hunk = makeHunk('a.ts', 0, [
      makeLine('context', 'short', { old: 1, new: 1 }),
      makeLine('add', long, { new: 2 }),
    ]);

    return {
      ...loadedFile('a.ts', 1),
      // `maxLineLength` is what the Rust parser reports, not something the row
      // model recomputes from the lines, so the fixture has to state it.
      diff: { ...makeDiff('a.ts', 1), hunks: [hunk], maxLineLength: long.length },
    };
  }

  it('leaves every line one row tall when wrapping is off', () => {
    const model = buildRowModel([fileWithLongLine()], METRICS);
    const lines = model.rows.filter((row) => row.kind === 'line');

    expect(lines.map((row) => row.rows)).toEqual([1, 1]);
  });

  it('makes a wrapped line as many rows tall as it wraps to', () => {
    const model = buildRowModel([fileWithLongLine()], METRICS, 120);
    const lines = model.rows.filter((row) => row.kind === 'line');

    // 250 characters at 120 is three visual lines; 'short' is still one.
    expect(lines.map((row) => row.rows)).toEqual([1, 3]);
  });

  it('keeps offsets and the total height exact across a wrapped line', () => {
    const model = buildRowModel([fileWithLongLine()], METRICS, 120);

    // The whole scroll model rests on this: offsets are the running sum of
    // heights, and a wrapped line contributes its full height to them.
    let expected = 0;
    model.rows.forEach((row, index) => {
      expect(model.offsets[index]).toBe(expected);
      expected += row.kind === 'line' ? METRICS.lineHeight * row.rows : 0;
      if (row.kind === 'file-header') expected += METRICS.fileHeaderHeight - 0;
      if (row.kind === 'hunk-header') expected += METRICS.lineHeight;
      if (row.kind === 'spacer') expected += METRICS.fileGap;
    });

    expect(model.totalHeight).toBe(expected);
  });

  it('finds the right row at an offset inside a wrapped line', () => {
    const model = buildRowModel([fileWithLongLine()], METRICS, 120);
    const index = model.rows.findIndex((row) => row.kind === 'line' && row.rows === 3);

    const top = model.offsets[index];
    // Two rows into the wrapped line is still that same line.
    expect(rowAtOffset(model, top + METRICS.lineHeight * 2)).toBe(index);
    expect(rowAtOffset(model, top + METRICS.lineHeight * 3)).toBe(index + 1);
  });

  it('caps the scroll width at the wrap column', () => {
    const wrapped = buildRowModel([fileWithLongLine()], METRICS, 120);
    const scrolling = buildRowModel([fileWithLongLine()], METRICS);

    expect(wrapped.contentWidth).toBe(METRICS.gutterWidth + 120 * METRICS.charWidth);
    expect(scrolling.contentWidth).toBeGreaterThan(wrapped.contentWidth);
  });

  it('does not widen a document of short lines to the wrap column', () => {
    const model = buildRowModel([loadedFile('a.ts', 1)], METRICS, 120);
    expect(model.contentWidth).toBeLessThan(
      METRICS.gutterWidth + 120 * METRICS.charWidth,
    );
  });
});

describe('the split view', () => {
  function replacement(): DocumentFile {
    const hunk = makeHunk('a.ts', 0, [
      makeLine('context', 'before', { old: 1, new: 1 }),
      makeLine('delete', 'was one', { old: 2 }),
      makeLine('delete', 'was two', { old: 3 }),
      makeLine('add', 'is one', { new: 2 }),
      makeLine('context', 'after', { old: 4, new: 3 }),
    ]);

    return {
      ...loadedFile('a.ts', 1),
      diff: { ...makeDiff('a.ts', 1), hunks: [hunk] },
    };
  }

  it('leaves the unified view alone', () => {
    const model = buildRowModel([replacement()], METRICS);
    expect(model.rows.filter((row) => row.kind === 'split-line')).toHaveLength(0);
    expect(model.rows.filter((row) => row.kind === 'line')).toHaveLength(5);
  });

  it('turns five unified lines into four split rows', () => {
    // Two deletions against one addition is three rows, not four: the extra
    // deletion faces a blank rather than a line of its own.
    const model = buildRowModel([replacement()], METRICS, null, 'split');
    const split = model.rows.filter((row) => row.kind === 'split-line');

    expect(split.map((row) => [row.left, row.right])).toEqual([
      [0, 0],
      [1, 3],
      [2, null],
      [4, 4],
    ]);
  });

  it('keeps the hunk header and file header spanning both panes', () => {
    const model = buildRowModel([replacement()], METRICS, null, 'split');
    expect(model.rows.map((row) => row.kind)).toEqual([
      'file-header',
      'hunk-header',
      'split-line',
      'split-line',
      'split-line',
      'split-line',
      'spacer',
    ]);
  });

  it('makes a row as tall as its taller side', () => {
    const long = 'x'.repeat(250);
    const hunk = makeHunk('a.ts', 0, [
      makeLine('delete', 'short', { old: 1 }),
      makeLine('add', long, { new: 1 }),
    ]);
    const file = {
      ...loadedFile('a.ts', 1),
      diff: { ...makeDiff('a.ts', 1), hunks: [hunk], maxLineLength: long.length },
    };

    const model = buildRowModel([file], METRICS, 120, 'split');
    const row = model.rows.find((r) => r.kind === 'split-line');

    // The addition wraps to three; the deletion is one. The pair is three.
    expect(row && row.kind === 'split-line' && row.rows).toBe(3);
  });

  it('still gives every row a distinct key', () => {
    const model = buildRowModel([replacement()], METRICS, null, 'split');
    const keys = model.rows.map(rowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps offsets exact across split rows', () => {
    const model = buildRowModel([replacement()], METRICS, null, 'split');
    let expected = 0;
    model.rows.forEach((row, index) => {
      expect(model.offsets[index]).toBe(expected);
      expected +=
        row.kind === 'split-line'
          ? METRICS.lineHeight * row.rows
          : row.kind === 'hunk-header'
            ? METRICS.lineHeight
            : row.kind === 'file-header'
              ? METRICS.fileHeaderHeight
              : METRICS.fileGap;
    });
    expect(model.totalHeight).toBe(expected);
  });
});

/** A 250-character line with a short line after it, so wrapping moves the latter. */
function fileWithLongLineAbove(): DocumentFile {
  const long = 'x'.repeat(250);
  const hunk = makeHunk('a.ts', 0, [
    makeLine('add', long, { new: 1 }),
    makeLine('context', 'after', { old: 1, new: 2 }),
  ]);

  return {
    ...loadedFile('a.ts', 1),
    diff: { ...makeDiff('a.ts', 1), hunks: [hunk], maxLineLength: long.length },
  };
}

function indexOfKey(model: ReturnType<typeof buildRowModel>, key: string): number {
  return model.rows.findIndex((row) => rowKey(row) === key);
}

describe('autoWrapColumn', () => {
  it('fits the code into what the line has left after its gutter and padding', () => {
    // 100 gutter + 16 padding leaves 800px, which is 100 characters at 8px.
    const width = METRICS.gutterWidth + METRICS.contentPadding + 800;
    expect(autoWrapColumn(width, METRICS, 'unified')).toBe(100 - AUTO_WRAP_MARGIN);
  });

  it('rounds down, so a partly visible character wraps rather than clipping', () => {
    const width = METRICS.gutterWidth + METRICS.contentPadding + 807;
    expect(autoWrapColumn(width, METRICS, 'unified')).toBe(100 - AUTO_WRAP_MARGIN);
  });

  it('fits one pane in the split view, less the divider between them', () => {
    const pane = METRICS.gutterWidth + METRICS.contentPadding + 400;
    const viewport = pane * 2 + 1;
    expect(autoWrapColumn(viewport, METRICS, 'split')).toBe(50 - AUTO_WRAP_MARGIN);
  });

  it('never goes below the minimum in a very narrow window', () => {
    expect(autoWrapColumn(150, METRICS, 'unified')).toBe(MIN_AUTO_WRAP_COLUMN);
    expect(autoWrapColumn(150, METRICS, 'split')).toBe(MIN_AUTO_WRAP_COLUMN);
  });

  it('has no answer before the viewport has been measured', () => {
    expect(autoWrapColumn(0, METRICS, 'unified')).toBeNull();
  });

  it('lays out a document that needs no horizontal scrolling', () => {
    const viewport = 700;
    const column = autoWrapColumn(viewport, METRICS, 'unified');
    const model = buildRowModel([fileWithLongLineAbove()], METRICS, column);

    expect(model.contentWidth + METRICS.contentPadding).toBeLessThanOrEqual(viewport);
  });
});

describe('scroll anchoring', () => {
  it('puts the same row back at the top when the wrap column changes', () => {
    const narrow = buildRowModel([fileWithLongLineAbove()], METRICS, 50);
    const wide = buildRowModel([fileWithLongLineAbove()], METRICS, 125);

    const after = narrow.rows.findIndex((row) => row.kind === 'line' && row.rows === 1);
    const scrollTop = narrow.offsets[after];

    const anchor = anchorAt(narrow, scrollTop);
    if (anchor === null) throw new Error('expected an anchor');

    // The long line above is five rows at 50 and two at 125, so the row after
    // it sits three rows higher in the wide model — and the anchor follows.
    const restored = offsetOfAnchor(wide, anchor);
    expect(restored).toBe(wide.offsets[indexOfKey(wide, anchor.key)]);
    expect(restored).toBe(scrollTop - METRICS.lineHeight * 3);
  });

  it('keeps the same part of a wrapped line in view as it changes height', () => {
    const narrow = buildRowModel([fileWithLongLineAbove()], METRICS, 50);
    const wide = buildRowModel([fileWithLongLineAbove()], METRICS, 125);

    const index = narrow.rows.findIndex((row) => row.kind === 'line' && row.rows === 5);
    const anchor = anchorAt(narrow, narrow.offsets[index] + METRICS.lineHeight * 2.5);
    if (anchor === null) throw new Error('expected an anchor');

    expect(anchor.fraction).toBeCloseTo(0.5);
    // Halfway down a line two rows tall is one row in.
    expect(offsetOfAnchor(wide, anchor)).toBeCloseTo(
      wide.offsets[indexOfKey(wide, anchor.key)] + METRICS.lineHeight,
    );
  });

  it('gives up when the anchored row is no longer in the model', () => {
    const model = buildRowModel([fileWithLongLineAbove()], METRICS, 120);
    const anchor = anchorAt(model, model.offsets[2]);
    if (anchor === null) throw new Error('expected an anchor');

    const other = buildRowModel([loadedFile('elsewhere.ts', 1)], METRICS, 120);
    expect(offsetOfAnchor(other, anchor)).toBeNull();
  });

  it('has nothing to anchor to in an empty document', () => {
    expect(anchorAt(buildRowModel([], METRICS), 0)).toBeNull();
  });
});
