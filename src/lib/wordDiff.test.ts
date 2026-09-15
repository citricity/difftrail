import { describe, expect, it } from 'vitest';
import { buildHunkSegments, diffLinePair, tokenize } from './wordDiff.ts';
import type { Segment } from './wordDiff.ts';

/** The text a side renders, to check segments reconstruct the original line. */
function text(segments: Segment[]): string {
  return segments.map((segment) => segment.text).join('');
}

function changed(segments: Segment[]): string[] {
  return segments.filter((segment) => segment.changed).map((segment) => segment.text);
}

describe('tokenize', () => {
  it('keeps identifiers whole and separates punctuation', () => {
    expect(tokenize('foo.bar(baz)')).toEqual(['foo', '.', 'bar', '(', 'baz', ')']);
  });

  it('treats whitespace as its own token', () => {
    expect(tokenize('a  b')).toEqual(['a', ' ', ' ', 'b']);
  });

  it('handles an empty line', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('diffLinePair', () => {
  it('highlights only the word that changed', () => {
    const { removed, added } = diffLinePair('const b = 2;', 'const b = 3;');

    expect(changed(removed)).toEqual(['2']);
    expect(changed(added)).toEqual(['3']);
  });

  it('always reconstructs both original lines exactly', () => {
    const cases: Array<[string, string]> = [
      ['const b = 2;', 'const b = 3;'],
      ['  indented', '    indented'],
      ['a', ''],
      ['', 'b'],
      ['foo(bar, baz)', 'foo(bar, qux, baz)'],
      ['héllo wörld', 'héllo there wörld'],
    ];

    for (const [oldLine, newLine] of cases) {
      const { removed, added } = diffLinePair(oldLine, newLine);
      expect(text(removed), oldLine).toBe(oldLine);
      expect(text(added), newLine).toBe(newLine);
    }
  });

  it('marks nothing when the lines are identical', () => {
    const { removed, added } = diffLinePair('same', 'same');

    expect(changed(removed)).toEqual([]);
    expect(changed(added)).toEqual([]);
  });

  it('highlights an insertion without touching the surrounding text', () => {
    const { added } = diffLinePair('foo(a, b)', 'foo(a, c, b)');

    expect(changed(added).join('')).toContain('c');
    expect(text(added)).toBe('foo(a, c, b)');
  });

  it('falls back to the whole line when two lines share almost nothing', () => {
    // Word-level marks would be noise here; this is a replacement, not an edit.
    const { removed, added } = diffLinePair(
      'import { readFile } from "node:fs";',
      'export default 42;',
    );

    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(removed[0].changed).toBe(true);
    expect(added[0].changed).toBe(true);
  });

  it('does not run the quadratic path on a pathological line', () => {
    const long = 'x '.repeat(5000);
    const { removed, added } = diffLinePair(long, `${long}y`);

    // Bailed out to whole-line marks rather than building a huge table.
    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
  });

  it('coalesces neighbouring segments that share a flag', () => {
    const { added } = diffLinePair('a', 'abc');

    // `b` and `c` are separate tokens but one contiguous highlight.
    expect(added.filter((segment) => segment.changed)).toHaveLength(1);
  });
});

describe('buildHunkSegments', () => {
  it('pairs each removed line with the added line that replaced it', () => {
    const segments = buildHunkSegments([
      { kind: 'context', content: 'before' },
      { kind: 'delete', content: 'const a = 1;' },
      { kind: 'delete', content: 'const b = 2;' },
      { kind: 'add', content: 'const a = 9;' },
      { kind: 'add', content: 'const b = 8;' },
      { kind: 'context', content: 'after' },
    ]);

    expect(changed(segments.get(1)!)).toEqual(['1']);
    expect(changed(segments.get(3)!)).toEqual(['9']);
    expect(changed(segments.get(2)!)).toEqual(['2']);
    expect(changed(segments.get(4)!)).toEqual(['8']);
  });

  it('leaves context lines alone', () => {
    const segments = buildHunkSegments([
      { kind: 'context', content: 'untouched' },
      { kind: 'delete', content: 'a' },
      { kind: 'add', content: 'b' },
    ]);

    expect(segments.has(0)).toBe(false);
  });

  it('leaves unpaired lines alone in a lopsided replacement', () => {
    const segments = buildHunkSegments([
      { kind: 'delete', content: 'only one removed' },
      { kind: 'add', content: 'first added' },
      { kind: 'add', content: 'second added' },
    ]);

    expect(segments.has(0)).toBe(true);
    expect(segments.has(1)).toBe(true);
    expect(segments.has(2)).toBe(false);
  });

  it('produces nothing for a pure insertion', () => {
    const segments = buildHunkSegments([
      { kind: 'context', content: 'a' },
      { kind: 'add', content: 'brand new' },
    ]);

    expect(segments.size).toBe(0);
  });

  it('handles several separate replacements in one hunk', () => {
    const segments = buildHunkSegments([
      { kind: 'delete', content: 'x = 1' },
      { kind: 'add', content: 'x = 2' },
      { kind: 'context', content: 'gap' },
      { kind: 'delete', content: 'y = 3' },
      { kind: 'add', content: 'y = 4' },
    ]);

    expect(changed(segments.get(0)!)).toEqual(['1']);
    expect(changed(segments.get(4)!)).toEqual(['4']);
  });
});
