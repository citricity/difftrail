/**
 * Global Previous/Next Change.
 *
 * The sequence spans the entire repository diff. Crossing from the last hunk
 * of one file into the first hunk of the next is not a special case here — it
 * is just the next entry in the index — which is exactly the behaviour
 * traditional diff tools lack and this application exists to provide.
 *
 * When the next change lives in a file whose diff has not been read yet, the
 * step becomes: identify the target file, load it, then land on the hunk that
 * the direction of travel implies.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  buildNavigationIndex,
  entryHunk,
  indexOfLocation,
  positionOf,
  step,
} from '../lib/navigation.ts';
import type { Direction, NavigationFilter } from '../lib/navigation.ts';
import type { ChangeLocation, DocumentFile, FileDiff } from '../types/index.ts';

export interface DiffNavigation {
  current: ChangeLocation | null;
  /** One-based position in the global sequence, for display. */
  position: number | null;
  total: number;
  canGoNext: boolean;
  canGoPrevious: boolean;
  /** True while a step is waiting on a file's diff to load. */
  navigating: boolean;
  goNext: () => void;
  goPrevious: () => void;
  /** Jump straight to a change, e.g. from a click in the document. */
  goTo: (location: ChangeLocation) => void;
  /**
   * Jump to a file, landing on its first change — loading the file first if
   * need be — so that Next and Previous carry on from there.
   */
  goToFile: (fileId: string) => void;
  /**
   * Jump to one hunk, which may be in a file nobody has opened yet: the file
   * lands at once and the hunk follows when its diff arrives.
   */
  goToHunk: (fileId: string, hunkId: string) => void;
  /**
   * Increments whenever the view must be brought to `current` even if
   * `current` has not changed. Picking the file you are already on, after
   * scrolling away from it, is a request to go back to it; without this the
   * document would see the same location and, rightly, do nothing.
   */
  revealRequest: number;
}

/**
 * `filter` narrows the sequence — focusing a logical change steps through only
 * the hunks it covers, and the readout counts only those.
 */
export function useDiffNavigation(
  files: DocumentFile[],
  ensureLoaded: (fileId: string) => Promise<FileDiff | null>,
  filter?: NavigationFilter,
): DiffNavigation {
  const [current, setCurrent] = useState<ChangeLocation | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [revealRequest, setRevealRequest] = useState(0);

  /**
   * Increments on every step. A load that finishes after the user has already
   * pressed the button again is discarded rather than yanking the view to a
   * stale target.
   */
  const token = useRef(0);

  const entries = useMemo(
    () => buildNavigationIndex(files, filter),
    [files, filter],
  );

  const go = useCallback(
    (direction: Direction) => {
      const target = step(entries, current, direction);
      if (target === null) return;

      if (target.kind === 'hunk') {
        setCurrent({ fileId: target.fileId, hunkId: target.hunkId });
        return;
      }

      // The entry stands for a whole file. If its diff is already resolved
      // there is nothing to wait for — the file itself is the destination.
      if (!target.pending) {
        setCurrent({ fileId: target.fileId, hunkId: null });
        return;
      }

      const ticket = (token.current += 1);
      setNavigating(true);

      void ensureLoaded(target.fileId)
        .then((diff) => {
          if (ticket !== token.current) return;

          const hunkId = diff === null ? null : entryHunk(diff.hunks, direction);
          setCurrent({ fileId: target.fileId, hunkId });
        })
        .finally(() => {
          if (ticket === token.current) setNavigating(false);
        });
    },
    [current, entries, ensureLoaded],
  );

  const goNext = useCallback(() => go('next'), [go]);
  const goPrevious = useCallback(() => go('previous'), [go]);

  const goTo = useCallback((location: ChangeLocation) => {
    token.current += 1;
    setNavigating(false);
    setCurrent(location);
  }, []);

  /**
   * The file header lands first, immediately, and the first hunk follows when
   * it is known. For a loaded file that is the same render; for one not yet
   * read, the reader sees the jump happen at once and settle onto the change a
   * moment later, rather than waiting on a load with nothing moving.
   *
   * A collapsed file has no hunk rows to land on, so its header is the
   * destination — the same place its collapsed notice is.
   */
  const goToFile = useCallback(
    (fileId: string) => {
      const file = files.find((candidate) => candidate.meta.id === fileId);
      if (file === undefined) return;

      const ticket = (token.current += 1);
      setRevealRequest((previous) => previous + 1);

      const settled = file.status === 'loaded' || file.status === 'error';
      if (file.collapsed || settled) {
        const hunkId = file.collapsed
          ? null
          : entryHunk(file.diff?.hunks ?? [], 'next');
        setNavigating(false);
        setCurrent({ fileId, hunkId });
        return;
      }

      setCurrent({ fileId, hunkId: null });
      setNavigating(true);

      void ensureLoaded(fileId)
        .then((diff) => {
          if (ticket !== token.current) return;
          const hunkId = diff === null ? null : entryHunk(diff.hunks, 'next');
          if (hunkId !== null) setCurrent({ fileId, hunkId });
        })
        .finally(() => {
          if (ticket === token.current) setNavigating(false);
        });
    },
    [ensureLoaded, files],
  );

  /**
   * The same two-step as `goToFile`, aimed at one hunk rather than at whatever
   * the file starts with — what the changelog's markers, its contents list and
   * the change bar's arrows all need.
   *
   * It runs on the same ticket as every other step, so a reader who moves on
   * while the diff is loading is not yanked back to a target they have left.
   * A file that comes back without the hunk the notes named leaves the reader
   * on the file rather than pointing the cursor at a row the model does not
   * have; so does a collapsed file, which has no hunk rows at all.
   */
  const goToHunk = useCallback(
    (fileId: string, hunkId: string) => {
      const file = files.find((candidate) => candidate.meta.id === fileId);
      if (file === undefined) return;

      const ticket = (token.current += 1);
      setRevealRequest((previous) => previous + 1);

      // A settled file is not necessarily a file with this hunk in it: the
      // load may have failed, or the diff may have been truncated short of it,
      // and a changelog written against the whole diff knows hunks that the
      // row model never built. Landing on the file header is a place the
      // reader can see; a hunk id with no row is a cursor pointing at nothing.
      const settled = file.status === 'loaded' || file.status === 'error';
      if (file.collapsed || settled) {
        const rendered =
          !file.collapsed &&
          (file.diff?.hunks.some((hunk) => hunk.id === hunkId) ?? false);

        setNavigating(false);
        setCurrent({ fileId, hunkId: rendered ? hunkId : null });
        return;
      }

      setCurrent({ fileId, hunkId: null });
      setNavigating(true);

      void ensureLoaded(fileId)
        .then((diff) => {
          if (ticket !== token.current) return;
          if (diff !== null && diff.hunks.some((hunk) => hunk.id === hunkId)) {
            setCurrent({ fileId, hunkId });
          }
        })
        .finally(() => {
          if (ticket === token.current) setNavigating(false);
        });
    },
    [ensureLoaded, files],
  );

  const currentIndex = indexOfLocation(entries, current);

  return {
    current,
    position: positionOf(entries, current),
    total: entries.length,
    // With no position yet, both directions are available: Next enters at the
    // top of the document and Previous at the bottom.
    canGoNext: entries.length > 0 && currentIndex < entries.length - 1,
    canGoPrevious: entries.length > 0 && currentIndex !== 0,
    navigating,
    goNext,
    goPrevious,
    goTo,
    goToFile,
    goToHunk,
    revealRequest,
  };
}
