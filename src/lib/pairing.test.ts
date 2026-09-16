import { describe, expect, it } from 'vitest';
import { pairHunkLines } from './pairing.ts';
import { makeHunk, makeLine } from '../test/factories.ts';
import type { DiffLine } from '../types/index.ts';

const pairs = (lines: DiffLine[]) => pairHunkLines(makeHunk('a.ts', 0, lines));

describe('pairHunkLines', () => {
  it('faces a context line with itself', () => {
    expect(pairs([makeLine('context', 'same')])).toEqual([{ left: 0, right: 0 }]);
  });

  it('faces a replacement across', () => {
    expect(pairs([makeLine('delete', 'was'), makeLine('add', 'is')])).toEqual([
      { left: 0, right: 1 },
    ]);
  });

  it('pairs a changed block positionally', () => {
    const rows = pairs([
      makeLine('delete', 'a'),
      makeLine('delete', 'b'),
      makeLine('add', 'A'),
      makeLine('add', 'B'),
    ]);

    // First deletion faces the first addition, not the line that happens to
    // follow it in the unified sequence.
    expect(rows).toEqual([
      { left: 0, right: 2 },
      { left: 1, right: 3 },
    ]);
  });

  it('faces a blank when one side runs out', () => {
    expect(
      pairs([makeLine('delete', 'a'), makeLine('delete', 'b'), makeLine('add', 'A')]),
    ).toEqual([
      { left: 0, right: 2 },
      { left: 1, right: null },
    ]);

    expect(
      pairs([makeLine('delete', 'a'), makeLine('add', 'A'), makeLine('add', 'B')]),
    ).toEqual([
      { left: 0, right: 1 },
      { left: null, right: 2 },
    ]);
  });

  it('puts a pure insertion opposite blanks', () => {
    expect(pairs([makeLine('add', 'A'), makeLine('add', 'B')])).toEqual([
      { left: null, right: 0 },
      { left: null, right: 1 },
    ]);
  });

  it('puts a pure deletion opposite blanks', () => {
    expect(pairs([makeLine('delete', 'a')])).toEqual([{ left: 0, right: null }]);
  });

  it('keeps separate changed blocks separate', () => {
    // Context between two blocks means the second block's additions must not
    // be paired with the first block's deletions.
    const rows = pairs([
      makeLine('delete', 'a'),
      makeLine('add', 'A'),
      makeLine('context', '-'),
      makeLine('delete', 'b'),
      makeLine('add', 'B'),
    ]);

    expect(rows).toEqual([
      { left: 0, right: 1 },
      { left: 2, right: 2 },
      { left: 3, right: 4 },
    ]);
  });

  it('handles additions that precede deletions in the sequence', () => {
    // Git emits deletions first within a block, but a hunk can hold an
    // addition-only block immediately followed by a deletion-only one.
    const rows = pairs([makeLine('add', 'A'), makeLine('delete', 'a')]);

    expect(rows).toEqual([
      { left: null, right: 0 },
      { left: 1, right: null },
    ]);
  });

  it('accounts for every line exactly once', () => {
    const lines = [
      makeLine('context', 'c1'),
      makeLine('delete', 'd1'),
      makeLine('delete', 'd2'),
      makeLine('add', 'a1'),
      makeLine('context', 'c2'),
      makeLine('add', 'a2'),
    ];

    const seen = pairs(lines)
      .flatMap((p) => [p.left, p.right])
      .filter((i): i is number => i !== null);

    expect([...new Set(seen)].sort((a, b) => a - b)).toEqual(lines.map((_, i) => i));
  });
});
