import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NoteStatus } from './NoteStatus.tsx';
import type { MatchSummary } from '../../types/index.ts';

function summary(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    matched: 5,
    total: 5,
    unexplained: 0,
    partial: 0,
    staleNotes: 0,
    ...overrides,
  };
}

describe('the drift chip', () => {
  it('says nothing when the changelog accounts for the whole diff', () => {
    const { container } = render(<NoteStatus summary={summary()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts hunks that changed since the notes were written', () => {
    render(<NoteStatus summary={summary({ matched: 3 })} />);
    expect(screen.getByText('3 / 5')).toBeInTheDocument();
  });

  // Matched but unexplained is not "described": the changelog saw the hunk and
  // said nothing about it, which is the state worth knowing about.
  it('counts a matched hunk with no reason against the changelog', () => {
    render(<NoteStatus summary={summary({ unexplained: 2 })} />);

    const chip = screen.getByText('3 / 5');
    expect(chip).toBeInTheDocument();
    expect(chip.closest('span')).toHaveAttribute(
      'title',
      expect.stringContaining('no reason recorded'),
    );
  });
});
