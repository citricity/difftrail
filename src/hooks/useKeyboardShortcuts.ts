/**
 * Keyboard access to global change navigation.
 *
 * Stepping through a review should not require the mouse, so the toolbar
 * buttons and these keys drive exactly the same actions.
 */

import { useEffect } from 'react';
import type { ZoomDirection } from '../types/index.ts';

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
  /**
   * Scaling the whole interface, on the keys every browser uses.
   *
   * On macOS the View menu's own accelerators take ⌘= and ⌘− before the
   * webview is offered them, so what actually arrives here is the shifted ⌘+,
   * and every press on the platforms that get no menu at all.
   *
   * Left undefined where the app cannot scale itself — running in a plain
   * browser, say — because the combination then has to reach the browser's
   * own zoom rather than being swallowed by a handler that does nothing.
   */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}

/**
 * Which way a key moves the zoom, if it moves it.
 *
 * Both the unshifted key and the character shifting it produces: ⌘+ is how the
 * shortcut is written and ⌘= is how it is pressed, and the numeric keypad
 * sends the signs directly.
 */
function zoomDirection(key: string): ZoomDirection | undefined {
  if (key === '=' || key === '+') return 'in';
  if (key === '-' || key === '_') return 'out';
  if (key === '0') return 'reset';
  return undefined;
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
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: Shortcuts): void {
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;

      // Zoom belongs to the window rather than to the document, so it is
      // answered ahead of the typing guard below: ⌘− while the file filter has
      // focus means what it means everywhere else. Nothing else in here is
      // modified, so the whole combination is spent either way.
      if (event.metaKey || event.ctrlKey) {
        if (event.altKey) return;

        const zoom = zoomDirection(event.key);
        const step =
          zoom === 'in'
            ? onZoomIn
            : zoom === 'out'
              ? onZoomOut
              : zoom === 'reset'
                ? onZoomReset
                : undefined;

        if (step === undefined) return;
        event.preventDefault();
        step();
        return;
      }

      if (isTypingTarget(event.target) || event.altKey) return;

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
  }, [
    onNext,
    onPrevious,
    onNextChange,
    onPreviousChange,
    onEscape,
    onZoomIn,
    onZoomOut,
    onZoomReset,
  ]);
}
