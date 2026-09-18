import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAiChangelog } from '../services/backend.ts';
import { changeLabel } from '../lib/noteMarkers.ts';
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
  onOpenChange: (change: string) => void;
}

export interface AiChangelogView {
  changelog: AiChangelog | null;
  /** The notes for one hunk, or null when the changelog never saw it. */
  hunk: (hunkId: string) => ResolvedHunk | null;
  state: (hunkId: string) => HunkNoteState;
  logicalChange: (id: string) => LogicalChange | null;
  /** Display order of the logical changes, for labels and colours. */
  labelOf: (id: string) => string;
  /** The change's description, for a marker's tooltip. */
  describe: (id: string) => string;
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
export function useAiChangelog(ready: boolean): AiChangelogView & {
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

  /**
   * `A`, `B`, `C`… so a marker is readable without relying on its colour, and
   * `AA` onwards past twenty-six rather than starting again at `A`.
   */
  const labels = useMemo(() => {
    const assigned = new Map<string, string>();
    changelog?.logicalChanges.forEach((change, index) => {
      assigned.set(change.id, changeLabel(index));
    });
    return assigned;
  }, [changelog]);

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

  const labelOf = useCallback((id: string) => labels.get(id) ?? '?', [labels]);

  const describe = useCallback(
    (id: string) => logicalChange(id)?.description ?? 'Logical change',
    [logicalChange],
  );

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return { changelog, hunk, state, logicalChange, labelOf, describe, reload };
}
