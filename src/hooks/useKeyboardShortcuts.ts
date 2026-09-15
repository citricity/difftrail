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
}

/** True when the event came from somewhere the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function useKeyboardShortcuts({ onNext, onPrevious }: Shortcuts): void {
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // `n`/`p` mirror `less` and `git log`; `j`/`k` mirror vim. Both are
      // muscle memory for the tools this sits alongside.
      const next = event.key === 'n' || event.key === 'j';
      const previous = event.key === 'p' || event.key === 'k';

      if (!next && !previous) return;

      event.preventDefault();
      if (next) onNext();
      else onPrevious();
    };

    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onNext, onPrevious]);
}
