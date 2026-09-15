/**
 * Global navigation order — the behaviour Diff Trail exists to provide.
 *
 * The scenario from the design notes is the one asserted here: pressing Next
 * Change repeatedly walks foo/0, foo/1, bar/0, baz/0, baz/1 without the
 * reader ever having to think about file boundaries.
 */

import { describe, expect, it } from 'vitest';
import {
  buildNavigationIndex,
  entryHunk,
  indexOfLocation,
  positionOf,
  sameLocation,
  step,
  toLocation,
} from './navigation.ts';
import { loadedFile, pendingFile } from '../test/factories.ts';
import type { ChangeLocation } from '../types/index.ts';

/** Walks the whole sequence, returning the ids visited in order. */
function walk(files: ReturnType<typeof loadedFile>[]): string[] {
  const entries = buildNavigationIndex(files);
  const visited: string[] = [];

  let current: ChangeLocation | null = null;
  for (;;) {
    const next = step(entries, current, 'next');
    if (next === null) break;
    current = toLocation(next);
    visited.push(current.hunkId ?? `${current.fileId} (file)`);
  }

  return visited;
}

describe('buildNavigationIndex', () => {
  it('walks every hunk of every file in document order', () => {
    const files = [loadedFile('foo.ts', 2), loadedFile('bar.ts', 1), loadedFile('baz.ts', 2)];

    expect(walk(files)).toEqual([
      'foo.ts:hunk:0',
      'foo.ts:hunk:1',
      'bar.ts:hunk:0',
      'baz.ts:hunk:0',
      'baz.ts:hunk:1',
    ]);
  });

  it('gives an unloaded file exactly one slot, marked pending', () => {
    const entries = buildNavigationIndex([
      loadedFile('foo.ts', 2),
      pendingFile('huge.ts'),
      loadedFile('baz.ts', 1),
    ]);

    expect(entries).toHaveLength(4);
    expect(entries[2]).toEqual({ kind: 'file', fileId: 'huge.ts', pending: true });
  });

  it('gives a loaded file with no hunks a slot that is not pending', () => {
    const binary = loadedFile('logo.png', 0);
    const entries = buildNavigationIndex([binary]);

    expect(entries).toEqual([{ kind: 'file', fileId: 'logo.png', pending: false }]);
  });

  it('does not wait on a file that failed to load', () => {
    const failed = { ...pendingFile('broken.ts'), status: 'error' as const, error: 'nope' };
    const entries = buildNavigationIndex([failed]);

    expect(entries[0]).toEqual({ kind: 'file', fileId: 'broken.ts', pending: false });
  });

  it('expands a pending slot into real hunks once the diff arrives', () => {
    const before = buildNavigationIndex([
      loadedFile('foo.ts', 1),
      pendingFile('bar.ts'),
    ]);
    const after = buildNavigationIndex([
      loadedFile('foo.ts', 1),
      loadedFile('bar.ts', 3),
    ]);

    expect(before).toHaveLength(2);
    expect(after).toHaveLength(4);
  });

  it('is empty for a clean repository', () => {
    expect(buildNavigationIndex([])).toEqual([]);
  });
});

describe('step', () => {
  const files = [loadedFile('foo.ts', 2), loadedFile('bar.ts', 1)];
  const entries = buildNavigationIndex(files);

  it('crosses a file boundary without any special case', () => {
    const lastOfFoo: ChangeLocation = { fileId: 'foo.ts', hunkId: 'foo.ts:hunk:1' };
    const next = step(entries, lastOfFoo, 'next');

    expect(next).toEqual({ kind: 'hunk', fileId: 'bar.ts', hunkId: 'bar.ts:hunk:0' });
  });

  it('crosses back the other way', () => {
    const firstOfBar: ChangeLocation = { fileId: 'bar.ts', hunkId: 'bar.ts:hunk:0' };
    const previous = step(entries, firstOfBar, 'previous');

    expect(previous).toEqual({ kind: 'hunk', fileId: 'foo.ts', hunkId: 'foo.ts:hunk:1' });
  });

  it('starts at the top going forwards and the bottom going backwards', () => {
    expect(step(entries, null, 'next')).toEqual(entries[0]);
    expect(step(entries, null, 'previous')).toEqual(entries[entries.length - 1]);
  });

  it('stops at each end rather than wrapping', () => {
    const first: ChangeLocation = { fileId: 'foo.ts', hunkId: 'foo.ts:hunk:0' };
    const last: ChangeLocation = { fileId: 'bar.ts', hunkId: 'bar.ts:hunk:0' };

    expect(step(entries, first, 'previous')).toBeNull();
    expect(step(entries, last, 'next')).toBeNull();
  });

  it('returns null when there is nothing to navigate', () => {
    expect(step([], null, 'next')).toBeNull();
  });

  it('re-enters from the start when the current location has disappeared', () => {
    // A file can leave the diff while the app is open; navigation must not
    // wedge on a location that no longer exists.
    const stale: ChangeLocation = { fileId: 'gone.ts', hunkId: 'gone.ts:hunk:0' };
    expect(step(entries, stale, 'next')).toEqual(entries[0]);
  });
});

describe('entryHunk', () => {
  const hunks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('enters at the first hunk when moving forwards', () => {
    expect(entryHunk(hunks, 'next')).toBe('a');
  });

  it('enters at the last hunk when moving backwards', () => {
    expect(entryHunk(hunks, 'previous')).toBe('c');
  });

  it('has nothing to enter when the file has no hunks', () => {
    expect(entryHunk([], 'next')).toBeNull();
  });
});

describe('location helpers', () => {
  const entries = buildNavigationIndex([loadedFile('foo.ts', 2), loadedFile('bar.ts', 1)]);

  it('reports a one-based position for display', () => {
    expect(positionOf(entries, { fileId: 'bar.ts', hunkId: 'bar.ts:hunk:0' })).toBe(3);
    expect(positionOf(entries, null)).toBeNull();
  });

  it('reports -1 for a location that is not in the index', () => {
    expect(indexOfLocation(entries, { fileId: 'nope.ts', hunkId: null })).toBe(-1);
  });

  it('compares locations by value', () => {
    expect(sameLocation({ fileId: 'a', hunkId: 'h' }, { fileId: 'a', hunkId: 'h' })).toBe(true);
    expect(sameLocation({ fileId: 'a', hunkId: 'h' }, { fileId: 'a', hunkId: null })).toBe(false);
    expect(sameLocation(null, null)).toBe(true);
    expect(sameLocation(null, { fileId: 'a', hunkId: null })).toBe(false);
  });

  it('distinguishes a file slot from a hunk slot', () => {
    expect(toLocation({ kind: 'file', fileId: 'a', pending: true })).toEqual({
      fileId: 'a',
      hunkId: null,
    });
    expect(toLocation({ kind: 'hunk', fileId: 'a', hunkId: 'a:hunk:0' })).toEqual({
      fileId: 'a',
      hunkId: 'a:hunk:0',
    });
  });
});
