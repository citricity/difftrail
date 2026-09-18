import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NoteDialogs } from './NoteDialogs.tsx';
import type { AiChangelogView } from '../../hooks/useAiChangelog.ts';
import type { AiChangelog, ResolvedHunk } from '../../types/index.ts';

function resolved(overrides: Partial<ResolvedHunk> = {}): ResolvedHunk {
  return {
    hunkId: 'src/one.ts:hunk:0',
    reasons: ['Counts are read from the database, not accumulated in memory.'],
    logicalChangeIds: ['0'],
    ambiguous: false,
    partial: false,
    ...overrides,
  };
}

function view(hunk: ResolvedHunk): AiChangelogView {
  const changelog: AiChangelog = {
    nonce: 'AB99X7',
    author: 'claude',
    issueTracker: 'https://example.com/issues',
    commithash: null,
    logicalChanges: [
      { id: '0', description: 'Reset the error count', associatedIssues: ['9'] },
      { id: '1', description: 'Warm the dark colours', associatedIssues: [] },
    ],
    hunks: { [hunk.hunkId]: hunk },
    summary: { matched: 1, total: 1, unexplained: 0, partial: 0, staleNotes: 0 },
  };

  return {
    changelog,
    hunk: (id) => changelog.hunks[id] ?? null,
    state: () => 'explained',
    logicalChange: (id) =>
      changelog.logicalChanges.find((change) => change.id === id) ?? null,
    labelOf: (id) => (id === '0' ? 'A' : 'B'),
    describe: (id) =>
      changelog.logicalChanges.find((change) => change.id === id)?.description ??
      '',
  };
}

function open(hunk: ResolvedHunk) {
  const notes = view(hunk);
  const onGoToHunk = vi.fn();

  render(
    <NoteDialogs
      open={{ kind: 'hunk', hunkId: hunk.hunkId }}
      notes={notes}
      order={[hunk.hunkId]}
      onClose={vi.fn()}
      onGoToHunk={onGoToHunk}
      onOpenChange={vi.fn()}
    />,
  );

  return { onGoToHunk };
}

describe('the hunk dialog', () => {
  it('shows the reason, and the change it belongs to', () => {
    open(resolved());

    expect(screen.getByText(/read from the database/)).toBeInTheDocument();
    expect(screen.getByText('Reset the error count')).toBeInTheDocument();
  });

  it('opens a lone logical change, because there is nothing to choose between', () => {
    open(resolved());
    expect(screen.getByRole('button', { name: /Reset the error count/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('leaves several changes closed until the reader picks one', async () => {
    open(resolved({ logicalChangeIds: ['0', '1'] }));

    for (const name of [/Reset the error count/, /Warm the dark colours/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }

    await userEvent.click(screen.getByRole('button', { name: /Warm the dark/ }));
    expect(screen.getByRole('button', { name: /Warm the dark/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('says so when the hunk has grown around the note', () => {
    open(resolved({ partial: true }));
    expect(screen.getByText(/changed around the note since/)).toBeInTheDocument();
  });

  it('says so when identical hunks were given different reasons', () => {
    open(resolved({ ambiguous: true, reasons: ['The header copy', 'The footer copy'] }));

    expect(screen.getByText(/different reasons/)).toBeInTheDocument();
    expect(screen.getByText('The header copy')).toBeInTheDocument();
    expect(screen.getByText('The footer copy')).toBeInTheDocument();
  });

  it('names an unexplained hunk as one, rather than showing nothing', () => {
    open(resolved({ reasons: [], logicalChangeIds: [] }));
    expect(screen.getByText(/No reason was recorded/)).toBeInTheDocument();
  });
});

describe('the logical change dialog', () => {
  it('lists the hunks it covers, and jumps to one', async () => {
    const hunk = resolved();
    const notes = view(hunk);
    const onGoToHunk = vi.fn();

    render(
      <NoteDialogs
        open={{ kind: 'change', changeId: '0' }}
        notes={notes}
        order={[hunk.hunkId]}
        onClose={vi.fn()}
        onGoToHunk={onGoToHunk}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('1 hunk')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#9' })).toHaveAttribute(
      'href',
      'https://example.com/issues/9',
    );

    await userEvent.click(screen.getByRole('button', { name: /src\/one\.ts/ }));
    expect(onGoToHunk).toHaveBeenCalledWith('src/one.ts', 'src/one.ts:hunk:0');
  });
});

describe('the logical change dialog, given a thin payload', () => {
  it('opens even when an empty issue list was left out of it altogether', () => {
    const hunk = resolved();
    const notes = view(hunk);

    // What a backend that skips empty collections sends: no `associatedIssues`
    // key at all, where the dialog expects an array it can measure.
    const change = notes.changelog?.logicalChanges[0] as {
      associatedIssues?: string[];
    };
    delete change.associatedIssues;

    render(
      <NoteDialogs
        open={{ kind: 'change', changeId: '0' }}
        notes={notes}
        order={[hunk.hunkId]}
        onClose={vi.fn()}
        onGoToHunk={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Reset the error count')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('the contents dialog', () => {
  it('lists the changes with a hunk on screen, and how much each covers', async () => {
    const hunk = resolved();
    const notes = view(hunk);
    const onOpenChange = vi.fn();

    render(
      <NoteDialogs
        open={{ kind: 'contents' }}
        notes={notes}
        order={[hunk.hunkId]}
        currentChange="0"
        onClose={vi.fn()}
        onGoToHunk={vi.fn()}
        onOpenChange={onOpenChange}
      />,
    );

    // Change B covers nothing here, so it is not in the document's contents.
    expect(screen.queryByText('Warm the dark colours')).not.toBeInTheDocument();
    expect(screen.getByText('1 hunk')).toBeInTheDocument();

    const entry = screen.getByRole('button', { name: /Reset the error count/ });
    expect(entry).toHaveAttribute('aria-current', 'true');

    await userEvent.click(entry);
    expect(onOpenChange).toHaveBeenCalledWith('0');
  });

  it('says when hunks belong to no change at all', () => {
    const hunk = resolved({ logicalChangeIds: [], reasons: [] });
    render(
      <NoteDialogs
        open={{ kind: 'contents' }}
        notes={view(hunk)}
        order={[hunk.hunkId]}
        onClose={vi.fn()}
        onGoToHunk={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/belongs to no logical change/)).toBeInTheDocument();
  });
});
