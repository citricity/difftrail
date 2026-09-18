/**
 * Where a logical change starts and stops in the document.
 *
 * The backend says which logical changes cover each hunk; it does not say
 * where a span begins, and it should not — spans are re-openable, so one
 * change can cover hunks 1 and 3 but not 2, and what counts as "the start" is a
 * question about the document on screen. A file that has not loaded has no
 * hunks here, so its markers appear when it does.
 */

import type { ResolvedHunk } from '../types/index.ts';

export interface HunkMarkers {
  /** Logical changes whose run of hunks begins at this one. */
  starts: string[];
  /** Logical changes whose run of hunks ends at this one. */
  ends: string[];
  /** Covered, but neither the first hunk of the run nor the last. */
  inside: string[];
}

const NONE: HunkMarkers = { starts: [], ends: [], inside: [] };

export function noMarkers(): HunkMarkers {
  return NONE;
}

/**
 * Marks the ends of each logical change's runs, in document order.
 *
 * `order` is every hunk the document currently holds, in the order it shows
 * them; `hunks` is the resolved notes, keyed by hunk id.
 */
export function buildNoteMarkers(
  order: readonly string[],
  hunks: Readonly<Record<string, ResolvedHunk>>,
): Map<string, HunkMarkers> {
  const markers = new Map<string, HunkMarkers>();

  const covers = (index: number, change: string): boolean => {
    const id = order[index];
    if (id === undefined) return false;
    return hunks[id]?.logicalChangeIds.includes(change) ?? false;
  };

  order.forEach((id, index) => {
    const changes = hunks[id]?.logicalChangeIds ?? [];
    if (changes.length === 0) return;

    const starts: string[] = [];
    const ends: string[] = [];
    const inside: string[] = [];

    for (const change of changes) {
      const first = !covers(index - 1, change);
      const last = !covers(index + 1, change);

      if (first) starts.push(change);
      if (last) ends.push(change);
      if (!first && !last) inside.push(change);
    }

    markers.set(id, { starts, ends, inside });
  });

  return markers;
}

/**
 * The hunks one logical change covers, in document order.
 *
 * What the change's own modal lists, and what focusing it steps through.
 */
export function hunksOfChange(
  order: readonly string[],
  hunks: Readonly<Record<string, ResolvedHunk>>,
  change: string,
): string[] {
  return order.filter((id) => hunks[id]?.logicalChangeIds.includes(change));
}

/**
 * The file a hunk id belongs to.
 *
 * Hunk ids are `<path>:hunk:<index>`, which `CLAUDE.md` names as the model's
 * stable logical id and the Rust parser builds. Splitting on the last `:hunk:`
 * rather than the first is what keeps a path containing `:hunk:` — unlikely,
 * but free to handle — from losing its tail.
 */
export function fileOfHunk(hunkId: string): string {
  const marker = hunkId.lastIndexOf(':hunk:');
  return marker === -1 ? hunkId : hunkId.slice(0, marker);
}
