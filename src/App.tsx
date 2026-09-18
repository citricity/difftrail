/**
 * Diff Trek.
 *
 * The composition root: it wires loading, navigation and the row model
 * together and hands them to the toolbar and the document. All the interesting
 * logic lives in `lib/` and `hooks/`; this file should stay boring.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StartupError } from './components/StartupError.tsx';
import { ChangeBar } from './features/diff/ChangeBar.tsx';
import { DiffDocument } from './features/diff/DiffDocument.tsx';
import { NoteDialogs } from './features/diff/NoteDialogs.tsx';
import { NoteStatus } from './features/diff/NoteStatus.tsx';
import type { NoteDialog } from './features/diff/NoteDialogs.tsx';
import { NavigationControls } from './features/navigation/NavigationControls.tsx';
import { ViewModeToggle } from './features/navigation/ViewModeToggle.tsx';
import { RepositoryHeader } from './features/repository/RepositoryHeader.tsx';
import { GitAliasDialog } from './features/gitAlias/GitAliasDialog.tsx';
import { NotARepository } from './features/gitAlias/NotARepository.tsx';
import { SettingsDialog } from './features/settings/SettingsDialog.tsx';
import { useDiffNavigation } from './hooks/useDiffNavigation.ts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.ts';
import { useAiChangelog } from './hooks/useAiChangelog.ts';
import { useRepositoryDiff } from './hooks/useRepositoryDiff.ts';
import { useRowMetrics } from './hooks/useRowMetrics.ts';
import { useSettings } from './hooks/useSettings.ts';
import { autoWrapColumn, buildRowModel } from './lib/rows.ts';
import {
  changeOfHunk,
  changesInOrder,
  documentOrder,
  fileOfHunk,
  focusFilter,
  stepChange,
} from './lib/noteMarkers.ts';
import { throttle } from './lib/throttle.ts';
import type { Direction } from './lib/navigation.ts';
import type { ResolvedHunk, ViewMode } from './types/index.ts';
import styles from './App.module.css';

/**
 * How often a changing viewport width may rebuild the row model, in ms.
 *
 * A resize drag reports a width every frame, and in auto-wrap mode each new
 * column re-lays out every wrapped line in the document. Ten rebuilds a second
 * still tracks the drag closely, and the throttle's trailing call makes sure
 * the width the drag ends on is always the one laid out.
 */
const RESIZE_THROTTLE_MS = 100;

/** One empty object, so a diff with no changelog does not churn the memos. */
const NO_HUNKS: Readonly<Record<string, ResolvedHunk>> = {};

export function App() {
  const {
    state,
    summary,
    ensureLoaded,
    prefetchAround,
    loadFully,
    toggleCollapse,
    revealContext,
  } = useRepositoryDiff();

  /**
   * The AI changelog for what is on screen, if an agent wrote one.
   *
   * Loaded once the file list is in, because a changelog describes a diff and
   * there is nothing to describe before that.
   */
  const changelog = useAiChangelog(state.phase !== 'starting');
  const hasNotes = changelog.changelog !== null;

  /**
   * The markers need room in the gutter, and auto wrapping reads the gutter's
   * width from the document root — so the flag lives there rather than on a
   * container, and the metrics are re-measured when it changes.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (hasNotes) root.dataset.aiChangelog = 'true';
    else delete root.dataset.aiChangelog;

    return () => {
      delete root.dataset.aiChangelog;
    };
  }, [hasNotes]);

  const metrics = useRowMetrics(hasNotes);
  const settingsState = useSettings();
  const { wrap, wrapLength } = settingsState.settings;

  /**
   * The layout this window is in, as against the one it opens with.
   *
   * Seeded from the preference when it arrives, but only until the reader
   * touches the toolbar — after that the window is theirs, and a preference
   * landing late must not snatch it back.
   */
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const chosen = useRef(false);

  useEffect(() => {
    if (!chosen.current) setViewMode(settingsState.settings.defaultViewMode);
  }, [settingsState.settings.defaultViewMode]);

  const chooseViewMode = useCallback((mode: ViewMode) => {
    chosen.current = true;
    setViewMode(mode);
  }, []);

  /**
   * The viewport width auto wrapping fits lines to, throttled.
   *
   * `DiffDocument` measures the viewport and reports every change; only this
   * copy is rate-limited, because the document's own virtualiser and pinned
   * bars need the live width to stay correct mid-drag, and they are cheap.
   */
  const [wrapWidth, setWrapWidth] = useState(0);
  const reportViewportWidth = useMemo(
    () => throttle((width: number) => setWrapWidth(width), RESIZE_THROTTLE_MS),
    [],
  );
  useEffect(() => () => reportViewportWidth.cancel(), [reportViewportWidth]);

  /**
   * The column lines wrap at, or null when they do not.
   *
   * In auto mode it is derived from the width, and only a change of whole
   * column reaches the model — most pixels of a drag change nothing and the
   * memo below keeps the model it has. Until the viewport is first measured
   * the stored column stands in, so the first layout is a plausible one.
   */
  const wrapColumn =
    wrap === 'off'
      ? null
      : wrap === 'column'
        ? wrapLength
        : (autoWrapColumn(wrapWidth, metrics, viewMode) ?? wrapLength);

  // Rebuilt whenever a diff arrives, a file is collapsed, or the wrap column
  // changes — which, in auto mode, includes the window being resized.
  // Everything the virtualiser and the scroll model need is derived from here.
  const model = useMemo(
    () => buildRowModel(state.files, metrics, wrapColumn, viewMode),
    [state.files, metrics, wrapColumn, viewMode],
  );

  /**
   * The logical change the reader has narrowed to, if any.
   *
   * Focus changes the sequence, not the document: every hunk stays on screen,
   * and only Previous/Next, the readout and following the scroll are narrowed.
   */
  const [requestedFocus, setFocused] = useState<string | null>(null);

  /**
   * Derived rather than stored, so a changelog that no longer mentions the
   * focused change lets the focus lapse by itself — correcting it in an effect
   * would mean a render with the reader stepping through an empty sequence.
   */
  const focused =
    requestedFocus !== null && changelog.logicalChange(requestedFocus) !== null
      ? requestedFocus
      : null;

  const navigationFilter = useMemo(() => {
    const hunks = changelog.changelog?.hunks;
    if (focused === null || hunks === undefined) return undefined;
    return focusFilter(hunks, focused);
  }, [focused, changelog]);

  const navigation = useDiffNavigation(state.files, ensureLoaded, navigationFilter);

  /** Which note dialog is open, if any. */
  const [noteDialog, setNoteDialog] = useState<NoteDialog>(null);

  const documentNotes = useMemo(() => {
    if (changelog.changelog === null) return null;

    return {
      hunks: changelog.changelog.hunks,
      state: changelog.state,
      labelOf: changelog.labelOf,
      describe: changelog.describe,
      onOpenHunk: (hunkId: string) => setNoteDialog({ kind: 'hunk', hunkId }),
      onOpenChange: (changeId: string) => setNoteDialog({ kind: 'change', changeId }),
    };
  }, [changelog]);

  /**
   * The logical changes with a hunk on screen, and where the reader sits among
   * them.
   *
   * The current change follows the hunk cursor rather than being stored, so
   * stepping hunks and stepping changes can never disagree about where the
   * reader is. While focused it is the focused change: a hunk serving two
   * intents would otherwise rename the bar out from under the narrowing.
   */
  const notedHunks = changelog.changelog?.hunks ?? NO_HUNKS;

  /**
   * Every hunk the changelog knows, in document order — including those in
   * files whose diffs have not been read yet, so the counter does not climb
   * as the reader scrolls.
   */
  const notedOrder = useMemo(
    () => documentOrder(state.files.map((file) => file.meta.id), notedHunks),
    [state.files, notedHunks],
  );

  const changes = useMemo(
    () => changesInOrder(notedOrder, notedHunks),
    [notedOrder, notedHunks],
  );

  const currentHunk = navigation.current?.hunkId ?? null;
  const currentChange = focused ?? changeOfHunk(notedHunks, currentHunk);
  const changePosition = changes.findIndex((entry) => entry.id === currentChange);

  const nextChange = stepChange(changes, notedOrder, currentHunk, notedHunks, 'next');
  const previousChange = stepChange(
    changes,
    notedOrder,
    currentHunk,
    notedHunks,
    'previous',
  );

  /**
   * Reveals a hunk that may be in a file nobody has opened yet.
   *
   * The file lands first and the hunk follows when its diff arrives, which is
   * what `goToFile` does for the file navigator: the jump happens at once
   * rather than after a wait with nothing moving.
   */
  const revealHunk = useCallback(
    (hunkId: string) => {
      const fileId = fileOfHunk(hunkId);
      const file = state.files.find((candidate) => candidate.meta.id === fileId);

      if (file !== undefined && file.status !== 'loaded' && !file.collapsed) {
        navigation.goTo({ fileId, hunkId: null });
        void ensureLoaded(fileId).then(() => navigation.goTo({ fileId, hunkId }));
        return;
      }

      navigation.goTo({ fileId, hunkId });
    },
    [ensureLoaded, navigation, state.files],
  );

  /**
   * Stepping while focused moves the focus with it, so the arrows read as
   * "the next intent, on its own" rather than silently stepping out of the
   * narrowing the reader asked for.
   */
  const goToChange = useCallback(
    (direction: Direction) => {
      const target = direction === 'next' ? nextChange : previousChange;
      if (target === null) return;

      revealHunk(target.hunkId);
      if (focused !== null) setFocused(target.id);
    },
    [focused, nextChange, previousChange, revealHunk],
  );

  const goToNextChange = useCallback(() => goToChange('next'), [goToChange]);
  const goToPreviousChange = useCallback(
    () => goToChange('previous'),
    [goToChange],
  );

  useKeyboardShortcuts({
    onNext: navigation.goNext,
    onPrevious: navigation.goPrevious,
    onNextChange: changes.length === 0 ? undefined : goToNextChange,
    onPreviousChange: changes.length === 0 ? undefined : goToPreviousChange,
    onEscape: focused === null ? undefined : () => setFocused(null),
  });

  const handleLoadFully = useCallback(
    (fileId: string) => {
      void loadFully(fileId);
    },
    [loadFully],
  );

  if (state.phase === 'failed' && state.error !== null) {
    return (
      <div className={styles.app}>
        {state.error.kind === 'notARepository' ? (
          // Opening Diff Trek from Applications, outside any repository, lands
          // here — which is exactly when installing git dt is wanted. The
          // screen offers it, and carries the dialog itself.
          <NotARepository />
        ) : (
          <>
            <StartupError error={state.error} />
            <GitAliasDialog />
          </>
        )}
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.toolbar}>
        <RepositoryHeader repository={state.repository} summary={summary} />
        <NavigationControls navigation={navigation} />
        {changelog.changelog !== null && (
          <NoteStatus summary={changelog.changelog.summary} />
        )}
        <ViewModeToggle value={viewMode} onChange={chooseViewMode} />
        <SettingsDialog state={settingsState} />
        <GitAliasDialog />
      </header>

      {changes.length > 0 && (
        <ChangeBar
          label={currentChange === null ? null : changelog.labelOf(currentChange)}
          description={
            currentChange === null ? null : changelog.describe(currentChange)
          }
          position={changePosition === -1 ? null : changePosition + 1}
          total={changes.length}
          onHunk={currentHunk !== null}
          focused={focused !== null}
          canGoNext={nextChange !== null}
          canGoPrevious={previousChange !== null}
          onOpenContents={() => setNoteDialog({ kind: 'contents' })}
          onNext={goToNextChange}
          onPrevious={goToPreviousChange}
          onToggleFocus={() =>
            setFocused(focused === null ? currentChange : null)
          }
        />
      )}

      <DiffDocument
        files={state.files}
        model={model}
        metrics={metrics}
        loading={state.phase === 'starting'}
        comparison={
          state.repository === null
            ? undefined
            : (state.repository.comparison?.label ?? null)
        }
        current={navigation.current}
        revealRequest={navigation.revealRequest}
        onSelect={navigation.goTo}
        onScrollToChange={navigation.goTo}
        onSelectFile={navigation.goToFile}
        onVisibleFileChange={prefetchAround}
        onToggleCollapse={toggleCollapse}
        onLoadFully={handleLoadFully}
        onExpandContext={revealContext}
        wrapColumn={wrapColumn}
        viewMode={viewMode}
        onViewportWidthChange={reportViewportWidth}
        notes={documentNotes}
        navigationFilter={navigationFilter}
      />

      {changelog.changelog !== null && (
        <NoteDialogs
          open={noteDialog}
          notes={changelog}
          order={notedOrder}
          onClose={() => setNoteDialog(null)}
          onGoToHunk={(_fileId, hunkId) => revealHunk(hunkId)}
          onOpenChange={(changeId) => {
            const entry = changes.find((candidate) => candidate.id === changeId);
            if (entry !== undefined) revealHunk(entry.hunkId);
            setNoteDialog(null);
          }}
          focused={focused}
          currentChange={currentChange}
          onFocus={(changeId) => {
            setFocused(changeId);
            setNoteDialog(null);
          }}
          onClearFocus={() => {
            setFocused(null);
            setNoteDialog(null);
          }}
        />
      )}
    </div>
  );
}
