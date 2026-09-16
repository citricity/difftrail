/**
 * Loading the two sides of a changed image.
 *
 * Cached against the `FileDiff` it belongs to, the same way syntax colours are
 * cached against their hunk: a row scrolled out of view and back re-renders
 * without refetching, and a re-read diff (a different object) starts afresh
 * rather than showing an image from before the working tree changed. A
 * `WeakMap`, so the images go when the diff does.
 */

import { bytesToDataUrl, imageMimeType } from '../lib/images.ts';
import type { ChangedFile, FileDiff, FileSide } from '../types/index.ts';
import { AppError } from '../types/index.ts';
import { getImageBytes } from './backend.ts';

export type ImageSide =
  /** This side has no file: the original of an addition, the working copy of a deletion. */
  | { state: 'absent' }
  | { state: 'loaded'; url: string }
  | { state: 'failed'; message: string };

const cache = new WeakMap<FileDiff, Partial<Record<FileSide, Promise<ImageSide>>>>();

/** Whether a side exists at all, going by what Git said happened to the file. */
function sideExists(meta: ChangedFile, side: FileSide): boolean {
  if (side === 'original') return meta.status !== 'added';
  return meta.status !== 'deleted';
}

/** One side of an image. Never rejects: a failure is a state to show. */
export function loadImageSide(
  meta: ChangedFile,
  diff: FileDiff,
  side: FileSide,
): Promise<ImageSide> {
  let sides = cache.get(diff);
  if (sides === undefined) {
    sides = {};
    cache.set(diff, sides);
  }

  const cached = sides[side];
  if (cached !== undefined) return cached;

  const mime = imageMimeType(meta.path);
  const pending: Promise<ImageSide> =
    mime === null || !sideExists(meta, side)
      ? Promise.resolve({ state: 'absent' })
      : getImageBytes(meta.path, side).then(
          (bytes): ImageSide => ({ state: 'loaded', url: bytesToDataUrl(bytes, mime) }),
          (thrown: unknown): ImageSide => {
            // A failed side is remembered, not retried on every scroll past it.
            const error = AppError.from(thrown);
            return { state: 'failed', message: error.message };
          },
        );

  sides[side] = pending;
  return pending;
}
