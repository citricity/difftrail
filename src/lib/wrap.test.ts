import { describe, expect, it } from 'vitest';
import { wrapCount, wrapRuns } from './wrap.ts';
import type { LineRun } from './runs.ts';

const run = (text: string, color: string | null = null, changed = false): LineRun => ({
  text,
  color,
  changed,
});

const texts = (rows: LineRun[][]): string[] =>
  rows.map((r) => r.map((x) => x.text).join(''));

describe('wrapCount', () => {
  it('is one row when wrapping is off', () => {
    expect(wrapCount(5000, null)).toBe(1);
  });

  it('is one row for an empty line', () => {
    expect(wrapCount(0, 120)).toBe(1);
  });

  it('does not add a row for a line that exactly fills the column', () => {
    expect(wrapCount(120, 120)).toBe(1);
    expect(wrapCount(121, 120)).toBe(2);
    expect(wrapCount(240, 120)).toBe(2);
    expect(wrapCount(241, 120)).toBe(3);
  });
});

describe('wrapRuns', () => {
  it('leaves runs alone when wrapping is off', () => {
    const runs = [run('a'.repeat(500))];
    expect(wrapRuns(runs, null)).toEqual([runs]);
  });

  it('keeps a short line as one row', () => {
    expect(texts(wrapRuns([run('short')], 10))).toEqual(['short']);
  });

  it('gives an empty line one empty row', () => {
    expect(wrapRuns([], 10)).toEqual([[]]);
  });

  it('splits at the column, not at word boundaries', () => {
    // A space at position 3 is ignored: the break is where the column is.
    expect(texts(wrapRuns([run('abc defghijkl')], 5))).toEqual([
      'abc d',
      'efghi',
      'jkl',
    ]);
  });

  it('splits a run that straddles the boundary, keeping its colour', () => {
    const rows = wrapRuns([run('aaa', 'kw'), run('bbbb', 'str')], 5);

    expect(rows).toEqual([[run('aaa', 'kw'), run('bb', 'str')], [run('bb', 'str')]]);
  });

  it('carries changed-word shading across a break', () => {
    const rows = wrapRuns([run('abcdef', null, true)], 4);

    expect(rows).toEqual([[run('abcd', null, true)], [run('ef', null, true)]]);
  });

  it('agrees with wrapCount, whatever the length', () => {
    for (const length of [0, 1, 39, 40, 41, 119, 120, 121, 239, 240, 241, 601]) {
      const rows = wrapRuns(length === 0 ? [] : [run('x'.repeat(length))], 120);
      expect(rows).toHaveLength(wrapCount(length, 120));
    }
  });

  it('reproduces the line exactly however it is split', () => {
    const runs = [
      run('const '),
      run('fileStream', 'var'),
      run(' = fs.createReadStream(p);'),
    ];
    const joined = runs.map((r) => r.text).join('');

    for (const column of [1, 2, 7, 13, 120]) {
      expect(texts(wrapRuns(runs, column)).join('')).toBe(joined);
    }
  });
});
