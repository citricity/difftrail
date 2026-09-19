import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts.ts';
import type { Shortcuts } from './useKeyboardShortcuts.ts';

function Harness(props: Shortcuts & { dialog?: boolean }) {
  useKeyboardShortcuts(props);
  // jsdom has no showModal, so the dialogs fall back to the open attribute —
  // which is what the hook looks for.
  return props.dialog === true ? <dialog open /> : null;
}

function keys(overrides: Partial<Shortcuts> & { dialog?: boolean } = {}) {
  const handlers = {
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onNextChange: vi.fn(),
    onPreviousChange: vi.fn(),
    onEscape: vi.fn(),
    ...overrides,
  };

  render(<Harness {...handlers} />);
  return handlers;
}

describe('the shortcuts', () => {
  it('steps hunks on n and p', async () => {
    const handlers = keys();

    await userEvent.keyboard('n');
    await userEvent.keyboard('p');

    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onPrevious).toHaveBeenCalledTimes(1);
  });

  it('steps logical changes on the shifted pair', async () => {
    const handlers = keys();

    await userEvent.keyboard('{Shift>}n{/Shift}');

    expect(handlers.onNextChange).toHaveBeenCalledTimes(1);
    expect(handlers.onNext).not.toHaveBeenCalled();
  });

  // Caps Lock sends `N` without shift. Someone with it on has not asked for
  // the bigger jump, and reading the key alone would give it to them.
  it('treats an upper-case key without shift as an ordinary step', async () => {
    const handlers = keys();

    await userEvent.keyboard('N');

    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onNextChange).not.toHaveBeenCalled();
  });

  it('leaves Escape to whatever dialog is on top', async () => {
    const handlers = keys({ dialog: true });

    await userEvent.keyboard('{Escape}');

    expect(handlers.onEscape).not.toHaveBeenCalled();
  });

  it('clears the focus on Escape when nothing is open over it', async () => {
    const handlers = keys();

    await userEvent.keyboard('{Escape}');

    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });
});
