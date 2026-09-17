/**
 * The global change sequence.
 *
 * This is the heart of Diff Trek. Previous/Next Change operate across the
 * entire repository diff, so the order is derived from the logical model —
 * never from whatever DOM nodes the virtualiser happens to have rendered.
 *
 * A file that has not been loaded yet still occupies a slot in the sequence.
 * We know it changed (it is in the diff) but not how many hunks it has, so it
 * contributes exactly one entry until its diff arrives, at which point the
 * index is rebuilt and the entry expands into that file's real hunks.
 */

import type { ChangeLocation, DocumentFile } from '../types/index.ts';

export type NavigationEntry =
  /** A specific hunk in a loaded file. */
  | { kind: 'hunk'; fileId: string; hunkId: string }
  /**
   * The file itself: either its diff is not loaded yet, or it has no hunks to
   * step through (binary, truncated, or an empty diff).
   */
  | { kind: 'file'; fileId: string; pending: boolean };

export type Direction = 'next' | 'previous';

/**
 * Flattens files and hunks into the order Next Change walks.
 *
 * Files keep the order Git reported them in; hunks keep the order they appear
 * in the file.
 */
export function buildNavigationIndex(files: DocumentFile[]): NavigationEntry[] {
  const entries: NavigationEntry[] = [];

  for (const file of files) {
    const hunks = file.diff?.hunks ?? [];

    if (file.status === 'loaded' && hunks.length > 0) {
      for (const hunk of hunks) {
        entries.push({ kind: 'hunk', fileId: file.meta.id, hunkId: hunk.id });
      }
      continue;
    }

    // Not loaded yet, or loaded with nothing to step through. Either way the
    // file is one stop on the journey.
    entries.push({
      kind: 'file',
      fileId: file.meta.id,
      pending: file.status !== 'loaded' && file.status !== 'error',
    });
  }

  return entries;
}

export function toLocation(entry: NavigationEntry): ChangeLocation {
  return {
    fileId: entry.fileId,
    hunkId: entry.kind === 'hunk' ? entry.hunkId : null,
  };
}

export function sameLocation(
  a: ChangeLocation | null,
  b: ChangeLocation | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.fileId === b.fileId && a.hunkId === b.hunkId;
}

/** Position of a location in the sequence, or -1 if it is no longer present. */
export function indexOfLocation(
  entries: NavigationEntry[],
  location: ChangeLocation | null,
): number {
  if (location === null) return -1;

  return entries.findIndex(
    (entry) =>
      entry.fileId === location.fileId &&
      (entry.kind === 'hunk' ? entry.hunkId : null) === location.hunkId,
  );
}

/**
 * The entry one step away, or null at either end of the sequence.
 *
 * With no current position, Next starts at the first entry and Previous at the
 * last, so both controls do something sensible on a fresh launch.
 */
export function step(
  entries: NavigationEntry[],
  current: ChangeLocation | null,
  direction: Direction,
): NavigationEntry | null {
  if (entries.length === 0) return null;

  const currentIndex = indexOfLocation(entries, current);

  if (currentIndex === -1) {
    return direction === 'next' ? entries[0] : entries[entries.length - 1];
  }

  const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
  if (targetIndex < 0 || targetIndex >= entries.length) return null;

  return entries[targetIndex];
}

/**
 * Which hunk to land on when entering a file whose diff has just arrived.
 *
 * Moving forwards we enter at the first hunk; moving backwards at the last, so
 * that stepping back over a file boundary is the exact reverse of stepping
 * forward over it.
 */
export function entryHunk(
  hunks: ReadonlyArray<{ id: string }>,
  direction: Direction,
): string | null {
  if (hunks.length === 0) return null;
  return direction === 'next' ? hunks[0].id : hunks[hunks.length - 1].id;
}

/**
 * One-based position of `location` for display, or null when there is none.
 */
export function positionOf(
  entries: NavigationEntry[],
  location: ChangeLocation | null,
): number | null {
  const index = indexOfLocation(entries, location);
  return index === -1 ? null : index + 1;
}
