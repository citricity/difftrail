/**
 * Navigation behaviour, including the part that only exists because diffs load
 * lazily: stepping into a file whose body has not been read yet.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDiffNavigation } from './useDiffNavigation.ts';
import { loadedFile, makeDiff, pendingFile } from '../test/factories.ts';
import type { DocumentFile, FileDiff } from '../types/index.ts';

/** A loader that resolves immediately with the given diff. */
function loaderFor(diff: FileDiff | null) {
  return vi.fn(() => Promise.resolve(diff));
}

function setup(files: DocumentFile[], loader = loaderFor(null)) {
  const view = renderHook(({ list }) => useDiffNavigation(list, loader), {
    initialProps: { list: files },
  });
  return { ...view, loader };
}

describe('useDiffNavigation', () => {
  it('starts with no position and reports the total change count', () => {
    const { result } = setup([loadedFile('a.ts', 2), loadedFile('b.ts', 1)]);

    expect(result.current.current).toBeNull();
    expect(result.current.position).toBeNull();
    expect(result.current.total).toBe(3);
  });

  it('enters at the first change and walks every file in order', () => {
    const { result } = setup([loadedFile('a.ts', 2), loadedFile('b.ts', 1)]);

    const visited: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      act(() => result.current.goNext());
      visited.push(result.current.current!.hunkId!);
    }

    expect(visited).toEqual(['a.ts:hunk:0', 'a.ts:hunk:1', 'b.ts:hunk:0']);
  });

  it('stops at the end instead of wrapping', () => {
    const { result } = setup([loadedFile('a.ts', 1)]);

    act(() => result.current.goNext());
    const atEnd = result.current.current;

    act(() => result.current.goNext());
    expect(result.current.current).toEqual(atEnd);
    expect(result.current.canGoNext).toBe(false);
  });

  it('enters from the bottom when stepping backwards from nowhere', () => {
    const { result } = setup([loadedFile('a.ts', 1), loadedFile('b.ts', 2)]);

    act(() => result.current.goPrevious());
    expect(result.current.current?.hunkId).toBe('b.ts:hunk:1');
  });

  it('loads a pending file and lands on its first hunk going forwards', async () => {
    const loader = loaderFor(makeDiff('b.ts', 3));
    const { result } = setup([loadedFile('a.ts', 1), pendingFile('b.ts')], loader);

    act(() => result.current.goNext()); // a.ts:hunk:0
    act(() => result.current.goNext()); // crosses into the unloaded b.ts

    await waitFor(() => expect(result.current.current?.hunkId).toBe('b.ts:hunk:0'));
    expect(loader).toHaveBeenCalledWith('b.ts');
  });

  it('lands on the last hunk of a pending file when stepping backwards into it', async () => {
    const loader = loaderFor(makeDiff('a.ts', 3));
    const { result } = setup([pendingFile('a.ts'), loadedFile('b.ts', 1)], loader);

    act(() => result.current.goPrevious()); // b.ts:hunk:0
    act(() => result.current.goPrevious()); // crosses back into the unloaded a.ts

    await waitFor(() => expect(result.current.current?.hunkId).toBe('a.ts:hunk:2'));
  });

  it('marks itself busy while a diff is being fetched', async () => {
    let release!: (diff: FileDiff) => void;
    const loader = vi.fn(
      () => new Promise<FileDiff | null>((resolve) => { release = resolve; }),
    );
    const { result } = setup([pendingFile('a.ts')], loader);

    act(() => result.current.goNext());
    expect(result.current.navigating).toBe(true);

    await act(async () => {
      release(makeDiff('a.ts', 1));
      // Let the hook's `.then` run inside this act() block.
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.navigating).toBe(false));
  });

  it('settles on the newest target when the user steps again mid-load', async () => {
    // A slow reply for an earlier step must not yank the view backwards.
    const pending: Array<(diff: FileDiff | null) => void> = [];
    const loader = vi.fn(
      () => new Promise<FileDiff | null>((resolve) => pending.push(resolve)),
    );

    const { result } = setup([pendingFile('a.ts'), pendingFile('b.ts')], loader);

    act(() => result.current.goNext()); // targets a.ts
    act(() => result.current.goTo({ fileId: 'b.ts', hunkId: 'b.ts:hunk:0' }));

    await act(async () => {
      pending[0]?.(makeDiff('a.ts', 2));
      // Let the stale load's `.then` run inside this act() block.
      await Promise.resolve();
    });

    expect(result.current.current).toEqual({ fileId: 'b.ts', hunkId: 'b.ts:hunk:0' });
  });

  it('settles on the file itself when a pending file turns out to have no hunks', async () => {
    const loader = loaderFor(makeDiff('logo.png', 0, { binary: true }));
    const { result } = setup([pendingFile('logo.png')], loader);

    act(() => result.current.goNext());

    await waitFor(() =>
      expect(result.current.current).toEqual({ fileId: 'logo.png', hunkId: null }),
    );
  });

  it('does not stall when a pending file fails to load', async () => {
    const loader = loaderFor(null);
    const { result } = setup([pendingFile('broken.ts')], loader);

    act(() => result.current.goNext());

    await waitFor(() =>
      expect(result.current.current).toEqual({ fileId: 'broken.ts', hunkId: null }),
    );
    expect(result.current.navigating).toBe(false);
  });

  it('does not wait on a file that is already loaded but has nothing to step through', () => {
    const loader = loaderFor(null);
    const { result } = setup([loadedFile('logo.png', 0)], loader);

    act(() => result.current.goNext());

    expect(result.current.current).toEqual({ fileId: 'logo.png', hunkId: null });
    expect(loader).not.toHaveBeenCalled();
  });

  it('re-counts the sequence when a file expands from pending into hunks', () => {
    const { result, rerender } = setup([loadedFile('a.ts', 1), pendingFile('b.ts')]);

    expect(result.current.total).toBe(2);

    rerender({ list: [loadedFile('a.ts', 1), loadedFile('b.ts', 4)] });

    expect(result.current.total).toBe(5);
  });

  it('accepts a direct jump from a click in the document', () => {
    const { result } = setup([loadedFile('a.ts', 3)]);

    act(() => result.current.goTo({ fileId: 'a.ts', hunkId: 'a.ts:hunk:2' }));

    expect(result.current.position).toBe(3);
    expect(result.current.canGoNext).toBe(false);
    expect(result.current.canGoPrevious).toBe(true);
  });

  it('has nothing to do in a clean repository', () => {
    const { result } = setup([]);

    act(() => result.current.goNext());

    expect(result.current.current).toBeNull();
    expect(result.current.canGoNext).toBe(false);
    expect(result.current.canGoPrevious).toBe(false);
  });
});
