/**
 * The git dt dialog asks before it changes anything, and says what happened.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitAliasStatus } from '../../types/index.ts';
import { AppError } from '../../types/index.ts';

let requested: () => void = () => undefined;
const getGitAliasStatus = vi.fn<() => Promise<GitAliasStatus>>();
const installGitAlias = vi.fn<() => Promise<GitAliasStatus>>();

vi.mock('../../services/backend.ts', () => ({
  getGitAliasStatus,
  installGitAlias,
  // Keeps the handler, so a test can 'choose the menu item'.
  onGitAliasRequested: (handler: () => void) => {
    requested = handler;
    return Promise.resolve(() => undefined);
  },
}));

const { GitAliasDialog } = await import('./GitAliasDialog.tsx');

/** Renders the dialog and chooses Diff Trek > Install 'git dt' Command… */
async function openFromMenu() {
  render(<GitAliasDialog />);
  // The subscription resolves on a microtask.
  await act(async () => {
    await Promise.resolve();
  });
  act(() => requested());
}

const STATUS: GitAliasStatus = {
  binary: '/Applications/Diff Trek.app/Contents/MacOS/diff-trek',
  command: "git config --global alias.dt '!f() { … }; f'",
  existing: null,
  installed: false,
  warning: null,
};

describe('GitAliasDialog', () => {
  beforeEach(() => {
    getGitAliasStatus.mockReset().mockResolvedValue(STATUS);
    installGitAlias.mockReset().mockResolvedValue({ ...STATUS, installed: true });
  });

  it('stays closed until the menu item is chosen', async () => {
    render(<GitAliasDialog />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getGitAliasStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('shows the exact command and installs nothing until asked', async () => {
    await openFromMenu();

    expect(await screen.findByText(STATUS.command)).toBeTruthy();
    expect(installGitAlias).not.toHaveBeenCalled();
  });

  it('installs on confirmation and says how to use it', async () => {
    await openFromMenu();

    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));

    expect(await screen.findByText(/is installed/)).toBeTruthy();
    expect(screen.getByText(/In any Git repository, run/)).toBeTruthy();
    expect(installGitAlias).toHaveBeenCalledTimes(1);
  });

  it('does nothing when cancelled', async () => {
    await openFromMenu();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText(STATUS.command)).toBeNull());
    expect(installGitAlias).not.toHaveBeenCalled();
  });

  it('shows the alias it would replace, and any warning', async () => {
    getGitAliasStatus.mockResolvedValue({
      ...STATUS,
      existing: '!echo something else',
      warning: 'This is a development build.',
    });
    await openFromMenu();

    expect(await screen.findByText('!echo something else')).toBeTruthy();
    expect(screen.getByText('This is a development build.')).toBeTruthy();
  });

  it('says so without offering to install when it is already set up', async () => {
    getGitAliasStatus.mockResolvedValue({ ...STATUS, installed: true });
    await openFromMenu();

    expect(await screen.findByText(/already set up/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('stays closed when a read it was waiting for arrives after Escape', async () => {
    let answer: (status: GitAliasStatus) => void = () => undefined;
    getGitAliasStatus.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { container } = render(<GitAliasDialog />);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => requested());

    const dialog = container.querySelector('dialog');
    if (dialog === null) throw new Error('no dialog');
    // Escape on a modal dialog fires `close`.
    fireEvent(dialog, new Event('close'));

    await act(async () => {
      answer(STATUS);
      await Promise.resolve();
    });

    expect(dialog.hasAttribute('open')).toBe(false);
    expect(screen.queryByText(STATUS.command)).toBeNull();
  });

  it('ignores an earlier read that answers after a later one', async () => {
    let answerFirst: (status: GitAliasStatus) => void = () => undefined;
    getGitAliasStatus
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
      )
      .mockResolvedValue({ ...STATUS, installed: true });
    await openFromMenu();

    // Chosen again before the first read answers.
    act(() => requested());
    expect(await screen.findByText(/already set up/)).toBeTruthy();

    await act(async () => {
      answerFirst(STATUS);
      await Promise.resolve();
    });

    expect(screen.getByText(/already set up/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('reports a failure with the backend message and can try again', async () => {
    installGitAlias.mockRejectedValue(
      new AppError({
        kind: 'gitCommandFailed',
        message: 'Git would not save the git dt command.',
        detail: null,
      }),
    );
    await openFromMenu();

    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Git would not save the git dt command.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(STATUS.command)).toBeTruthy();
  });
});
