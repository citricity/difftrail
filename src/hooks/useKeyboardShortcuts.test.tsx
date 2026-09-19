import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts.ts';
import type { Shortcuts } from './useKeyboardShortcuts.ts';

function Harness(props: Shortcuts & { dialog?: boolean; field?: boolean }) {
  useKeyboardShortcuts(props);
  // jsdom has no showModal, so the dialogs fall back to the open attribute —
  // which is what the hook looks for.
  if (props.dialog === true) return <dialog open />;
  return props.field === true ? <input aria-label="filter" autoFocus /> : null;
}

function keys(
  overrides: Partial<Shortcuts> & { dialog?: boolean; field?: boolean } = {},
) {
  const handlers = {
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onNextChange: vi.fn(),
    onPreviousChange: vi.fn(),
    onEscape: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
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

  it('scales the interface on the browser zoom keys', async () => {
    const handlers = keys();

    await userEvent.keyboard('{Meta>}={/Meta}');
    await userEvent.keyboard('{Control>}-{/Control}');
    await userEvent.keyboard('{Meta>}0{/Meta}');

    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomReset).toHaveBeenCalledTimes(1);
  });

  // ⌘+ is how the shortcut is written; ⌘= is how it is pressed. Both mean it.
  it('zooms in on the shifted key as well as the plain one', async () => {
    const handlers = keys();

    await userEvent.keyboard('{Meta>}{Shift>}+{/Shift}{/Meta}');

    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
  });

  // Zoom is the window's, not the document's, so unlike n and p it is not
  // withheld from someone with the cursor in the file filter.
  it('zooms while a text field has focus', async () => {
    const handlers = keys({ field: true });

    await userEvent.keyboard('{Meta>}-{/Meta}');
    await userEvent.keyboard('n');

    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onNext).not.toHaveBeenCalled();
  });

  it('leaves every other modified key alone', async () => {
    const handlers = keys();

    await userEvent.keyboard('{Meta>}n{/Meta}');
    await userEvent.keyboard('{Alt>}={/Alt}');

    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onZoomIn).not.toHaveBeenCalled();
  });
});
