/**
 * Cached word-level segments per hunk.
 *
 * A hunk's lines never change once loaded, so its segments are computed at
 * most once. The cache is a WeakMap keyed by the hunk object itself, which
 * means it needs no eviction policy: entries disappear when the diff they
 * belong to does.
 */

import type { DiffHunk } from '../types/index.ts';
import { buildHunkSegments } from './wordDiff.ts';
import type { Segment } from './wordDiff.ts';

const cache = new WeakMap<DiffHunk, Map<number, Segment[]>>();

export function segmentsForHunk(hunk: DiffHunk): Map<number, Segment[]> {
  const cached = cache.get(hunk);
  if (cached !== undefined) return cached;

  const segments = buildHunkSegments(hunk.lines);
  cache.set(hunk, segments);
  return segments;
}
