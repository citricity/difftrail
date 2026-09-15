import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Settings2, X } from 'lucide-react';
import { onSettingsRequested } from '../../services/backend.ts';
import type { SettingsState } from '../../hooks/useSettings.ts';
import { MAX_WRAP_LENGTH, MIN_WRAP_LENGTH } from '../../types/index.ts';
import styles from './SettingsDialog.module.css';

interface Props {
  /** The whole of `useSettings`: the values, the last save error, the setter. */
  state: SettingsState;
}

/**
 * Settings.
 *
 * Named as macOS 13 and later name it — the menu item, this dialog, the Rust
 * module and `settings.json` all agree on the word.
 *
 * A native `<dialog>` rather than a framework one: `showModal` already gives
 * the focus trap, the backdrop, the inert background and Escape to close, and
 * `CLAUDE.md` asks for native elements wherever they are practical. It also
 * keeps the interface deliberately small — complex preference screens are
 * listed there as out of scope.
 */
export function SettingsDialog({ state }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const wrapId = useId();
  const lengthId = useId();

  const { settings, error, update } = state;

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;

    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // The same dialog is opened from the application menu (⌘, on macOS), which
  // is where a desktop user will look for it first.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void onSettingsRequested(() => setOpen(true)).then((off) => {
      // The effect can be torn down before the subscription resolves, in which
      // case there is nothing to keep and it has to be undone immediately.
      if (cancelled) off();
      else unlisten = off;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Escape and the backdrop close the dialog without going through the button,
  // so the element is the source of truth for whether it is open.
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  /**
   * The wrap length is edited as text rather than bound straight to a number.
   *
   * Typing "80" over "120" passes through the empty string, and a controlled
   * number input would either reject the keystroke or snap to a clamped value
   * mid-edit. So the field holds whatever is typed and only commits when it
   * parses.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const length = draft ?? String(settings.wrapLength);

  const commitLength = useCallback(
    (value: string) => {
      const parsed = Number.parseInt(value, 10);
      setDraft(null);

      if (Number.isFinite(parsed) && parsed !== settings.wrapLength) {
        update({ wrapLength: parsed });
      }
    },
    [settings.wrapLength, update],
  );

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-label="Settings"
        title="Settings"
      >
        <Settings2 size={15} aria-hidden="true" />
      </button>

      <dialog ref={dialog} className={styles.dialog} onClose={handleClose}>
        <header className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button
            type="button"
            className={styles.close}
            onClick={handleClose}
            aria-label="Close settings"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.field}>
            <input
              id={wrapId}
              type="checkbox"
              checked={settings.wrap}
              onChange={(event) => update({ wrap: event.target.checked })}
            />
            <label htmlFor={wrapId} className={styles.label}>
              Wrap long lines
              <span className={styles.hint}>
                Otherwise they scroll horizontally, with the line numbers pinned.
              </span>
            </label>
          </div>

          <div className={styles.field}>
            <label htmlFor={lengthId} className={styles.label}>
              Wrap at column
              <span className={styles.hint}>
                Kept whether or not wrapping is on, between {MIN_WRAP_LENGTH} and{' '}
                {MAX_WRAP_LENGTH}.
              </span>
            </label>
            <input
              id={lengthId}
              type="number"
              className={styles.number}
              min={MIN_WRAP_LENGTH}
              max={MAX_WRAP_LENGTH}
              value={length}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={(event) => commitLength(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitLength(event.currentTarget.value);
              }}
            />
          </div>

          {error !== null && <p className={styles.error}>{error}</p>}
        </div>
      </dialog>
    </>
  );
}
