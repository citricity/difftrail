import { useCallback, useEffect, useRef, useState } from 'react';
import { GitCompare, SquareTerminal } from 'lucide-react';
import { getGitAliasStatus } from '../../services/backend.ts';
import type { GitAliasStatus } from '../../types/index.ts';
import { GitAliasDialog } from './GitAliasDialog.tsx';
import type { GitAliasDialogHandle } from './GitAliasDialog.tsx';
import styles from './NotARepository.module.css';

/**
 * What `git dt` looks like from here.
 *
 * `other` is a `dt` alias that launches something else — usually another copy
 * of Diff Trek, moved or reinstalled since — so the call to action becomes an
 * update rather than an install.
 */
type Alias = 'checking' | 'installed' | 'other' | 'missing';

function aliasFrom(status: GitAliasStatus): Alias {
  if (status.installed) return 'installed';
  return status.existing !== null ? 'other' : 'missing';
}

/**
 * Shown when Diff Trek is opened outside a Git repository.
 *
 * That is not a failure so much as the normal result of opening the app from
 * Applications or the Dock, so it gets guidance rather than an error and a
 * line of Git's stderr. What the guidance is depends on whether `git dt` is
 * set up: without it, installing the command is the one thing worth doing
 * here; with it, the screen explains how Diff Trek is meant to be opened.
 */
export function NotARepository() {
  const [alias, setAlias] = useState<Alias>('checking');
  const dialog = useRef<GitAliasDialogHandle>(null);
  /**
   * Set once the dialog has reported a status. Anything it reports is newer
   * than the read this screen started on mount, so that read, if it is still
   * outstanding, must not overwrite it.
   */
  const heardFromDialog = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const stale = () => cancelled || heardFromDialog.current;

    getGitAliasStatus().then(
      (status) => {
        if (!stale()) setAlias(aliasFrom(status));
      },
      (thrown: unknown) => {
        console.error('[difftrek] could not read the git dt alias', thrown);
        // Offer the install: if Git itself is the problem, the dialog says so.
        if (!stale()) setAlias('missing');
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  // Installing from the dialog, or from the menu, changes what this screen says.
  const handleStatusChange = useCallback((status: GitAliasStatus) => {
    heardFromDialog.current = true;
    setAlias(aliasFrom(status));
  }, []);

  const openDialog = useCallback(() => dialog.current?.open(), []);

  return (
    <div className={styles.screen}>
      {alias === 'checking' && (
        <p className={styles.message} role="status">
          Checking for the <code>git dt</code> command…
        </p>
      )}

      {alias === 'installed' && (
        <>
          <GitCompare className={styles.icon} size={22} aria-hidden="true" />
          <h1 className={styles.title}>Open Diff Trek from Git</h1>
          <p className={styles.message}>
            Diff Trek currently only supports diffs from within Git. To use it, open a
            terminal, <code>cd</code> to a Git repository, then type <code>git dt</code>{' '}
            and press Return.
          </p>
          <p className={styles.message}>
            To see the last committed changes, type <code>git dt HEAD</code> and press
            Return.
          </p>
        </>
      )}

      {(alias === 'missing' || alias === 'other') && (
        <>
          <SquareTerminal className={styles.icon} size={22} aria-hidden="true" />
          <h1 className={styles.title}>
            {alias === 'other' ? 'Update' : 'Install'} the <code>git dt</code> command
          </h1>
          <p className={styles.message}>
            Diff Trek shows the changes in a Git repository, and opens from Git itself.
            {alias === 'other' ? (
              <>
                {' '}
                Your <code>git dt</code> command does not open this copy of Diff Trek.
                Update it, then run <code>git dt</code> in any repository.
              </>
            ) : (
              <>
                {' '}
                Install the <code>git dt</code> command, then run it in any repository
                to see its changes here.
              </>
            )}
          </p>
          <button type="button" className={styles.button} onClick={openDialog}>
            {alias === 'other' ? 'Update' : 'Install'} <code>git dt</code> Command…
          </button>
        </>
      )}

      <GitAliasDialog ref={dialog} onStatusChange={handleStatusChange} />
    </div>
  );
}
