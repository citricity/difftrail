import { describe, expect, it } from 'vitest';
import { matchesDiff, splitLines } from './fileText.ts';
import { makeDiff, makeHunk, makeLine } from '../test/factories.ts';
import type { FileDiff, FileText } from '../types/index.ts';

function diffOf(lines: Parameters<typeof makeHunk>[2]): FileDiff {
  return { ...makeDiff('a.ts', 0), hunks: [makeHunk('a.ts', 0, lines)] };
}

describe('splitLines', () => {
  it('treats a trailing newline as a terminator, not a new line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
  });

  it('has no lines in an empty file', () => {
    expect(splitLines('')).toEqual([]);
  });

  it('keeps a blank line in the middle', () => {
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b']);
  });

  it('leaves a carriage return on the line it belongs to', () => {
    // Git reports CRLF content with the \r intact, so stripping it here would
    // fail every comparison on a CRLF file.
    expect(splitLines('a\r\nb\r\n')).toEqual(['a\r', 'b\r']);
  });
});

describe('matchesDiff', () => {
  const text: FileText = {
    original: ['one', 'two', 'three'],
    working: ['one', 'TWO', 'three'],
  };

  it('accepts a diff whose lines are where it says they are', () => {
    const diff = diffOf([
      makeLine('context', 'one', { old: 1, new: 1 }),
      makeLine('delete', 'two', { old: 2 }),
      makeLine('add', 'TWO', { new: 2 }),
      makeLine('context', 'three', { old: 3, new: 3 }),
    ]);

    expect(matchesDiff(diff, text)).toBe(true);
  });

  it('rejects a diff whose content no longer matches the file', () => {
    // The working tree moved between reading the diff and reading the file.
    const diff = diffOf([makeLine('add', 'something else', { new: 2 })]);

    expect(matchesDiff(diff, text)).toBe(false);
  });

  it('rejects a line pointing past the end of the file', () => {
    const diff = diffOf([makeLine('add', 'four', { new: 4 })]);

    expect(matchesDiff(diff, text)).toBe(false);
  });

  it('rejects a deletion when the original side could not be read', () => {
    const diff = diffOf([makeLine('delete', 'two', { old: 2 })]);

    expect(matchesDiff(diff, { original: null, working: text.working })).toBe(false);
  });

  it('reads each line from the side it belongs to', () => {
    // 'two' exists only in the original and 'TWO' only in the working copy, so
    // a check against the wrong side fails both ways round.
    const deletion = diffOf([makeLine('delete', 'TWO', { old: 2 })]);
    const addition = diffOf([makeLine('add', 'two', { new: 2 })]);

    expect(matchesDiff(deletion, text)).toBe(false);
    expect(matchesDiff(addition, text)).toBe(false);
  });
});
