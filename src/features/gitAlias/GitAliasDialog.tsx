import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  getGitAliasStatus,
  installGitAlias,
  onGitAliasRequested,
} from '../../services/backend.ts';
import { AppError } from '../../types/index.ts';
import type { GitAliasStatus } from '../../types/index.ts';
import styles from './GitAliasDialog.module.css';

type Stage =
  | { name: 'closed' }
  | { name: 'loading' }
  /** Showing what will run, waiting for the user to agree. */
  | { name: 'confirm'; status: GitAliasStatus; installing: boolean }
  | { name: 'done'; status: GitAliasStatus; already: boolean }
  | { name: 'failed'; message: string };

/**
 * Installs the `git dt` alias, after asking.
 *
 * Changing someone's global Git configuration is not something to do on a
 * click alone, so the dialog first reads what would happen — the exact command,
 * the executable it points at, any `dt` alias it would replace, and any reason
 * this copy of Diff Trek is a poor thing to point at — and runs nothing until
 * the user presses Install.
 *
 * The status is read afresh on every opening, since the configuration can
 * change between them. A native `<dialog>`, like Settings.
 */
export function GitAliasDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [stage, setStage] = useState<Stage>({ name: 'closed' });
  const open = stage.name !== 'closed';

  const start = useCallback(() => {
    setStage({ name: 'loading' });
    getGitAliasStatus().then(
      (status) =>
        setStage(
          status.installed
            ? { name: 'done', status, already: true }
            : { name: 'confirm', status, installing: false },
        ),
      (thrown: unknown) =>
        setStage({ name: 'failed', message: AppError.from(thrown).message }),
    );
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    onGitAliasRequested(start).then(
      (off) => {
        if (cancelled) off();
        else unlisten = off;
      },
      (thrown: unknown) => {
        console.error('[difftrek] could not subscribe to the git dt menu item', thrown);
      },
    );

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [start]);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;

    // jsdom has neither `showModal` nor `close`; the attribute stands in.
    if (open && !element.open) {
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
    }
    if (!open && element.open) {
      if (typeof element.close === 'function') element.close();
      else element.removeAttribute('open');
    }
  }, [open]);

  const close = useCallback(() => setStage({ name: 'closed' }), []);

  const install = useCallback(() => {
    setStage((previous) =>
      previous.name === 'confirm' ? { ...previous, installing: true } : previous,
    );
    installGitAlias().then(
      (status) => setStage({ name: 'done', status, already: false }),
      (thrown: unknown) =>
        setStage({ name: 'failed', message: AppError.from(thrown).message }),
    );
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="git-alias-title"
      onClose={close}
    >
      <header className={styles.header}>
        <h2 id="git-alias-title" className={styles.title}>
          Install <code>git dt</code> command
        </h2>
        <button
          type="button"
          className={styles.close}
          onClick={close}
          aria-label="Close"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.body}>
        {stage.name === 'loading' && <p className={styles.muted}>Checking Git…</p>}

        {stage.name === 'confirm' && (
          <>
            <p>
              This adds a Git alias to your global Git configuration, so that running{' '}
              <code>git dt</code> in any repository opens its unstaged changes in Diff
              Trek, and <code>git dt main...HEAD</code> opens a commit or range.
            </p>

            <p className={styles.label}>Diff Trek will run:</p>
            <pre className={styles.code}>{stage.status.command}</pre>

            {stage.status.existing !== null && (
              <>
                <p className={styles.label}>
                  This replaces your current <code>git dt</code> alias:
                </p>
                <pre className={styles.code}>{stage.status.existing}</pre>
              </>
            )}

            {stage.status.warning !== null && (
              <p className={styles.warning} role="note">
                {stage.status.warning}
              </p>
            )}
          </>
        )}

        {stage.name === 'done' && (
          <>
            <p className={styles.success}>
              {stage.already ? (
                <>
                  <code>git dt</code> is already set up for this copy of Diff Trek.
                </>
              ) : (
                <>
                  Done. <code>git dt</code> is installed.
                </>
              )}
            </p>
            <p>
              In any Git repository, run <code>git dt</code> to see its unstaged changes
              in Diff Trek. Add a commit or range to see that instead, as in{' '}
              <code>git dt HEAD~1</code> or <code>git dt main...HEAD</code>.
            </p>
            {stage.status.warning !== null && (
              <p className={styles.warning} role="note">
                {stage.status.warning}
              </p>
            )}
          </>
        )}

        {stage.name === 'failed' && (
          <p className={styles.error} role="alert">
            {stage.message}
          </p>
        )}
      </div>

      <footer className={styles.footer}>
        {stage.name === 'confirm' ? (
          <>
            <button
              type="button"
              className={styles.button}
              onClick={close}
              disabled={stage.installing}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={install}
              disabled={stage.installing}
              autoFocus
            >
              {stage.installing ? 'Installing…' : 'Install'}
            </button>
          </>
        ) : stage.name === 'failed' ? (
          <>
            <button type="button" className={styles.button} onClick={close}>
              Close
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={start}
            >
              Try again
            </button>
          </>
        ) : (
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={close}
            disabled={stage.name === 'loading'}
          >
            Close
          </button>
        )}
      </footer>
    </dialog>
  );
}
