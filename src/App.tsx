/**
 * Diff Trail.
 *
 * The composition root: it wires loading, navigation and the row model
 * together and hands them to the toolbar and the document. All the interesting
 * logic lives in `lib/` and `hooks/`; this file should stay boring.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StartupError } from './components/StartupError.tsx';
import { DiffDocument } from './features/diff/DiffDocument.tsx';
import { NavigationControls } from './features/navigation/NavigationControls.tsx';
import { ViewModeToggle } from './features/navigation/ViewModeToggle.tsx';
import { RepositoryHeader } from './features/repository/RepositoryHeader.tsx';
import { GitAliasDialog } from './features/gitAlias/GitAliasDialog.tsx';
import { SettingsDialog } from './features/settings/SettingsDialog.tsx';
import { useDiffNavigation } from './hooks/useDiffNavigation.ts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.ts';
import { useRepositoryDiff } from './hooks/useRepositoryDiff.ts';
import { useRowMetrics } from './hooks/useRowMetrics.ts';
import { useSettings } from './hooks/useSettings.ts';
import { autoWrapColumn, buildRowModel } from './lib/rows.ts';
import { throttle } from './lib/throttle.ts';
import type { ViewMode } from './types/index.ts';
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

  const metrics = useRowMetrics();
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

  const navigation = useDiffNavigation(state.files, ensureLoaded);

  useKeyboardShortcuts({
    onNext: navigation.goNext,
    onPrevious: navigation.goPrevious,
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
        <StartupError error={state.error} />
        {/* Opening Diff Trail from Applications, outside any repository, lands
            here — which is exactly when installing git dt is wanted. */}
        <GitAliasDialog />
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.toolbar}>
        <RepositoryHeader repository={state.repository} summary={summary} />
        <NavigationControls navigation={navigation} />
        <ViewModeToggle value={viewMode} onChange={chooseViewMode} />
        <SettingsDialog state={settingsState} />
        <GitAliasDialog />
      </header>

      <DiffDocument
        files={state.files}
        model={model}
        metrics={metrics}
        loading={state.phase === 'starting'}
        comparison={state.repository?.comparison?.label ?? null}
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
      />
    </div>
  );
}
