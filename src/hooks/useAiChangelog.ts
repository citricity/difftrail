import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAiChangelog } from '../services/backend.ts';
import type { AiChangelog, LogicalChange, ResolvedHunk } from '../types/index.ts';

/**
 * How a hunk stands with respect to the changelog.
 *
 * The distinction between the last two is the point of the whole feature: a
 * hunk the notes know about but say nothing about was probably not meant to be
 * there, while a hunk the notes have never seen is usually the reader's own
 * later edit and must not read as an accusation.
 */
export type HunkNoteState =
  | 'explained'
  | 'unexplained'
  | 'changedSince';

/**
 * What `DiffDocument` needs to draw the markers: the resolved notes, the
 * labels, and what to do when one is clicked. Assembled by `App`, so the
 * document itself knows nothing about dialogs.
 */
export interface DocumentNotes {
  hunks: Record<string, ResolvedHunk>;
  state: (hunkId: string) => HunkNoteState;
  labelOf: (change: string) => string;
  /** One line for a marker's tooltip. */
  describe: (change: string) => string;
  onOpenHunk: (hunkId: string) => void;
  /** `hunkId` says which of the change's hunks the reader opened it from. */
  onOpenChange: (change: string, hunkId?: string) => void;
}

export interface AiChangelogData {
  changelog: AiChangelog | null;
  /** The notes for one hunk, or null when the changelog never saw it. */
  hunk: (hunkId: string) => ResolvedHunk | null;
  state: (hunkId: string) => HunkNoteState;
  logicalChange: (id: string) => LogicalChange | null;
  /** The change's description, for a marker's tooltip. */
  describe: (id: string) => string;
}

/**
 * The changelog as the UI reads it.
 *
 * `labelOf` is supplied by the composition root rather than by the hook: a
 * label is a position in the document, and only the caller knows what the
 * document is showing and in what order.
 */
export interface AiChangelogView extends AiChangelogData {
  labelOf: (id: string) => string;
}

const EMPTY: AiChangelog | null = null;

/**
 * Loads the changelog for the current comparison, once.
 *
 * Nothing here re-fetches on its own. The changelog describes a diff, and when
 * the diff changes underneath us the answer is a stale-notes warning rather
 * than a silent reload — which would replace the notes a reader was in the
 * middle of without telling them.
 */
export function useAiChangelog(ready: boolean): AiChangelogData & {
  reload: () => void;
} {
  const [changelog, setChangelog] = useState<AiChangelog | null>(EMPTY);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;

    getAiChangelog()
      .then((loaded) => {
        if (!cancelled) setChangelog(loaded);
      })
      .catch((thrown: unknown) => {
        // Notes are a nicety and never load-bearing: a diff that renders
        // without them is far better than an error in front of the diff.
        console.error('[difftrek] get_ai_changelog failed', thrown);
        if (!cancelled) setChangelog(EMPTY);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, attempt]);

  const hunk = useCallback(
    (hunkId: string) => changelog?.hunks[hunkId] ?? null,
    [changelog],
  );

  const state = useCallback(
    (hunkId: string): HunkNoteState => {
      const resolved = changelog?.hunks[hunkId];
      if (resolved === undefined) return 'changedSince';
      return resolved.reasons.length === 0 &&
        resolved.logicalChangeIds.length === 0
        ? 'unexplained'
        : 'explained';
    },
    [changelog],
  );

  const logicalChange = useCallback(
    (id: string) =>
      changelog?.logicalChanges.find((change) => change.id === id) ?? null,
    [changelog],
  );

  const describe = useCallback(
    (id: string) => logicalChange(id)?.description ?? 'Logical change',
    [logicalChange],
  );

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  /**
   * Memoised, because consumers hang memos off this object: App derives the
   * change list, the document's notes and the navigation filter from it, and a
   * fresh literal every render would rebuild all three on every keystroke.
   */
  return useMemo(
    () => ({ changelog, hunk, state, logicalChange, describe, reload }),
    [changelog, hunk, state, logicalChange, describe, reload],
  );
}
