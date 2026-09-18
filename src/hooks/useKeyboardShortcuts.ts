/**
 * Keyboard access to global change navigation.
 *
 * Stepping through a review should not require the mouse, so the toolbar
 * buttons and these keys drive exactly the same actions.
 */

import { useEffect } from 'react';

export interface Shortcuts {
  onNext: () => void;
  onPrevious: () => void;
  /**
   * The same step, one level up: through the logical changes rather than the
   * hunks. Shifted, so a bigger jump is a bigger key press and there is
   * nothing new to learn.
   */
  onNextChange?: () => void;
  onPreviousChange?: () => void;
  /**
   * Escape, when there is something to escape from — today, a focused logical
   * change. Left undefined otherwise, so Escape keeps meaning whatever the
   * browser and any open dialog make of it.
   */
  onEscape?: () => void;
}

/**
 * True while a dialog is open over the document.
 *
 * jsdom has no `showModal`, so the dialogs fall back to the `open` attribute
 * there; this asks the question the same way in both.
 */
function hasOpenDialog(): boolean {
  return document.querySelector('dialog[open]') !== null;
}

/** True when the event came from somewhere the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function useKeyboardShortcuts({
  onNext,
  onPrevious,
  onNextChange,
  onPreviousChange,
  onEscape,
}: Shortcuts): void {
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') {
        // The listener is on the window, so it sees Escape raised inside an
        // open dialog too — and calling preventDefault there would cancel the
        // dialog's own close. Whatever is on top gets the key.
        if (onEscape === undefined || hasOpenDialog()) return;
        event.preventDefault();
        onEscape();
        return;
      }

      // `n`/`p` mirror `less` and `git log`; `j`/`k` mirror vim. Both are
      // muscle memory for the tools this sits alongside. Compared in lower
      // case and paired with `shiftKey`, because Caps Lock also sends `N` —
      // and someone with Caps Lock on has not asked for a bigger jump.
      const key = event.key.toLowerCase();
      const next = key === 'n' || key === 'j';
      const previous = key === 'p' || key === 'k';

      if (!next && !previous) return;

      // Shifted: the same movement over logical changes.
      if (event.shiftKey) {
        const step = next ? onNextChange : onPreviousChange;
        if (step === undefined) return;
        event.preventDefault();
        step();
        return;
      }

      event.preventDefault();
      if (next) onNext();
      else onPrevious();
    };

    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onNext, onPrevious, onNextChange, onPreviousChange, onEscape]);
}
