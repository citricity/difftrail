/**
 * Diff Trail.
 *
 * The composition root: it wires loading, navigation and the row model
 * together and hands them to the toolbar and the document. All the interesting
 * logic lives in `lib/` and `hooks/`; this file should stay boring.
 */

import { useCallback, useMemo } from 'react';
import { StartupError } from './components/StartupError.tsx';
import { DiffDocument } from './features/diff/DiffDocument.tsx';
import { NavigationControls } from './features/navigation/NavigationControls.tsx';
import { RepositoryHeader } from './features/repository/RepositoryHeader.tsx';
import { SettingsDialog } from './features/settings/SettingsDialog.tsx';
import { useDiffNavigation } from './hooks/useDiffNavigation.ts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.ts';
import { useRepositoryDiff } from './hooks/useRepositoryDiff.ts';
import { useRowMetrics } from './hooks/useRowMetrics.ts';
import { useSettings } from './hooks/useSettings.ts';
import { buildRowModel } from './lib/rows.ts';
import styles from './App.module.css';

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

  const wrapColumn = settingsState.settings.wrap
    ? settingsState.settings.wrapLength
    : null;

  // Rebuilt whenever a diff arrives, a file is collapsed, or wrapping changes.
  // Everything the virtualiser and the scroll model need is derived from here.
  const model = useMemo(
    () => buildRowModel(state.files, metrics, wrapColumn),
    [state.files, metrics, wrapColumn],
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
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.toolbar}>
        <RepositoryHeader repository={state.repository} summary={summary} />
        <NavigationControls navigation={navigation} />
        <SettingsDialog state={settingsState} />
      </header>

      <DiffDocument
        files={state.files}
        model={model}
        metrics={metrics}
        loading={state.phase === 'starting'}
        current={navigation.current}
        onSelect={navigation.goTo}
        onVisibleFileChange={prefetchAround}
        onToggleCollapse={toggleCollapse}
        onLoadFully={handleLoadFully}
        onExpandContext={revealContext}
        wrapColumn={wrapColumn}
      />
    </div>
  );
}
