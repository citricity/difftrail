/**
 * Opening Diff Trek outside a repository guides rather than alarms: it offers
 * to install git dt when that is missing, and explains how to use it when not.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitAliasStatus } from '../../types/index.ts';

const getGitAliasStatus = vi.fn<() => Promise<GitAliasStatus>>();
const installGitAlias = vi.fn<() => Promise<GitAliasStatus>>();

let requested: () => void = () => undefined;

vi.mock('../../services/backend.ts', () => ({
  getGitAliasStatus,
  installGitAlias,
  onGitAliasRequested: (handler: () => void) => {
    requested = handler;
    return Promise.resolve(() => undefined);
  },
}));

const { NotARepository } = await import('./NotARepository.tsx');

const STATUS: GitAliasStatus = {
  binary: '/Applications/Diff Trek.app/Contents/MacOS/diff-trek',
  command: "git config --global alias.dt '!f() { … }; f'",
  existing: null,
  installed: false,
  warning: null,
};

describe('NotARepository', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getGitAliasStatus.mockReset().mockResolvedValue(STATUS);
    installGitAlias.mockReset().mockResolvedValue({ ...STATUS, installed: true });
  });

  it("never shows Git's error", async () => {
    render(<NotARepository />);

    await screen.findByRole('heading');
    expect(screen.queryByText(/not a git repository/i)).toBeNull();
    expect(screen.queryByText(/fatal/)).toBeNull();
  });

  it('makes installing git dt the call to action when it is missing', async () => {
    render(<NotARepository />);

    expect(
      await screen.findByRole('heading', { name: /Install the git dt command/ }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Install git dt Command/ }));

    // The dialog opens and shows what it will run, without running it.
    expect(await screen.findByText(STATUS.command)).toBeTruthy();
    expect(installGitAlias).not.toHaveBeenCalled();
  });

  it('explains how to open a diff once git dt is installed', async () => {
    getGitAliasStatus.mockResolvedValue({ ...STATUS, installed: true });
    render(<NotARepository />);

    expect(await screen.findByText(/only supports diffs from within Git/)).toBeTruthy();
    expect(screen.getByText('git dt HEAD')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Install/ })).toBeNull();
  });

  it('offers an update when git dt opens something else', async () => {
    getGitAliasStatus.mockResolvedValue({ ...STATUS, existing: '!echo elsewhere' });
    render(<NotARepository />);

    expect(
      await screen.findByRole('button', { name: /Update git dt Command/ }),
    ).toBeTruthy();
  });

  it('switches to the usage guidance after installing from the screen', async () => {
    render(<NotARepository />);

    fireEvent.click(
      await screen.findByRole('button', { name: /Install git dt Command/ }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));

    expect(await screen.findByText(/only supports diffs from within Git/)).toBeTruthy();
    expect(installGitAlias).toHaveBeenCalledTimes(1);
  });

  it('says it is checking while the alias is read', () => {
    getGitAliasStatus.mockReturnValue(new Promise(() => undefined));
    render(<NotARepository />);

    expect(screen.getByRole('status').textContent).toMatch(
      /Checking for the git dt command/,
    );
  });

  it('keeps a newer answer from the dialog over a slow first read', async () => {
    let answerFirstRead: (status: GitAliasStatus) => void = () => undefined;
    getGitAliasStatus
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerFirstRead = resolve;
        }),
      )
      .mockResolvedValue(STATUS);

    const { container } = render(<NotARepository />);
    // Installed from the menu while the screen's own read is still out.
    await act(async () => {
      await Promise.resolve();
    });
    act(() => requested());
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
    expect(await screen.findByText(/only supports diffs from within Git/)).toBeTruthy();

    await act(async () => {
      answerFirstRead(STATUS);
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/only supports diffs from within Git/);
    expect(screen.queryByRole('button', { name: /Install git dt Command/ })).toBeNull();
  });

  it('still offers the install when the alias cannot be read', async () => {
    getGitAliasStatus.mockRejectedValue(new Error('git missing'));
    render(<NotARepository />);

    expect(
      await screen.findByRole('button', { name: /Install git dt Command/ }),
    ).toBeTruthy();
  });
});
