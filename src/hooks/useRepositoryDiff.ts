/**
 * Loading the repository diff, lazily.
 *
 * Startup order matters more than completeness: the header appears, then the
 * file list, then the first diffs. Nothing waits for the whole change set to
 * be processed.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { createLimiter } from '../lib/concurrency.ts';
import {
  documentReducer,
  initialState,
  summarise,
} from '../lib/documentState.ts';
import type { DocumentState } from '../lib/documentState.ts';
import { prepareSyntax } from '../lib/syntax.ts';
import { getChangedFiles, getFileDiff, getRepositoryInfo } from '../services/backend.ts';
import { loadFileText } from '../services/fileText.ts';
import { AppError } from '../types/index.ts';
import type { FileDiff, LineRange } from '../types/index.ts';

/** Diffs read in parallel. Enough to keep Git busy, few enough to stay fair. */
const MAX_CONCURRENT_DIFFS = 5;

/** Files loaded eagerly at startup, so the top of the document is populated. */
const INITIAL_LOAD_COUNT = 3;

/** Files loaded either side of the one in view. */
const PREFETCH_RADIUS = 2;

/** Budget for a diff the user explicitly asked to see after truncation. */
const EXPANDED_MAX_BYTES = 64 * 1024 * 1024;

export interface RepositoryDiff {
  state: DocumentState;
  summary: { files: number; additions: number; deletions: number };
  /**
   * Loads a file's diff if it is not already loaded or in flight, and resolves
   * with it. Resolves with null if the load failed.
   *
   * Returning the diff rather than relying on the next render is what lets
   * navigation decide which hunk to land on immediately after a load.
   */
  ensureLoaded: (fileId: string) => Promise<FileDiff | null>;
  /** Loads the file and its immediate neighbours. */
  prefetchAround: (fileId: string) => void;
  /** Re-requests a truncated diff without the byte limit. */
  loadFully: (fileId: string) => Promise<FileDiff | null>;
  toggleCollapse: (fileId: string) => void;
  /** Reveals a span of unchanged context the hunks left out. */
  revealContext: (fileId: string, range: LineRange) => void;
}

export function useRepositoryDiff(): RepositoryDiff {
  const [state, dispatch] = useReducer(documentReducer, initialState);

  const limiter = useRef(createLimiter(MAX_CONCURRENT_DIFFS));
  /**
   * One promise per file, which is what keeps responses from racing: there is
   * never more than one request in flight for a given file, so a slow reply
   * cannot overwrite a newer one. Failed entries are removed so a retry is
   * possible.
   */
  const inflight = useRef(new Map<string, Promise<FileDiff | null>>());
  const order = useRef<string[]>([]);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(
    (fileId: string, maxBytes?: number): Promise<FileDiff | null> => {
      const existing = inflight.current.get(fileId);
      if (existing !== undefined) return existing;

      const promise = limiter.current.run(async () => {
        dispatch({ type: 'fileLoadStarted', fileId });

        try {
          const diff = await getFileDiff(fileId, maxBytes);

          // Both sides in full, which is what lets the file be highlighted as
          // a program rather than as fragments, and lets the reader expand the
          // context around a hunk. Null when they could not be read or did not
          // match the diff, in which case both features stand down.
          const text = await loadFileText(diff);

          // Highlighting before the dispatch, not after, is what keeps the
          // render path synchronous: by the time these rows exist, their
          // colours are already cached against the hunks. It never rejects, so
          // a file whose grammar is missing or broken still arrives, plain.
          await prepareSyntax(diff, text);

          if (alive.current) dispatch({ type: 'fileLoaded', fileId, diff, text });
          return diff;
        } catch (thrown) {
          // Drop the entry so the user can retry a transient failure.
          inflight.current.delete(fileId);
          if (alive.current) {
            dispatch({
              type: 'fileFailed',
              fileId,
              message: AppError.from(thrown).message,
            });
          }
          return null;
        }
      });

      inflight.current.set(fileId, promise);
      return promise;
    },
    [],
  );

  const ensureLoaded = useCallback(
    (fileId: string): Promise<FileDiff | null> => load(fileId),
    [load],
  );

  const loadFully = useCallback(
    (fileId: string): Promise<FileDiff | null> => {
      inflight.current.delete(fileId);
      return load(fileId, EXPANDED_MAX_BYTES);
    },
    [load],
  );

  const prefetchAround = useCallback(
    (fileId: string): void => {
      const index = order.current.indexOf(fileId);
      if (index === -1) return;

      const from = Math.max(0, index - PREFETCH_RADIUS);
      const to = Math.min(order.current.length - 1, index + PREFETCH_RADIUS);

      // The file in view first; neighbours fill the remaining slots behind it.
      void load(fileId);
      for (let i = from; i <= to; i += 1) {
        if (i !== index) void load(order.current[i]);
      }
    },
    [load],
  );

  const toggleCollapse = useCallback((fileId: string): void => {
    dispatch({ type: 'fileCollapseToggled', fileId });
  }, []);

  const revealContext = useCallback((fileId: string, range: LineRange): void => {
    dispatch({ type: 'contextRevealed', fileId, range });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const repository = await getRepositoryInfo();
        if (!alive.current) return;
        dispatch({ type: 'repositoryLoaded', repository });

        const files = await getChangedFiles();
        if (!alive.current) return;
        dispatch({ type: 'filesLoaded', files });

        order.current = files.map((file) => file.id);
        for (const file of files.slice(0, INITIAL_LOAD_COUNT)) {
          void load(file.id);
        }
      } catch (thrown) {
        if (!alive.current) return;
        dispatch({ type: 'startupFailed', error: AppError.from(thrown) });
      }
    })();
  }, [load]);

  const summary = useMemo(() => summarise(state.files), [state.files]);

  return {
    state,
    summary,
    ensureLoaded,
    prefetchAround,
    loadFully,
    toggleCollapse,
    revealContext,
  };
}
