import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LogicalBadges } from './NoteMarkers.tsx';

function badges(props: Partial<Parameters<typeof LogicalBadges>[0]> = {}) {
  const onJump = vi.fn();

  render(
    <LogicalBadges
      starts={[]}
      ends={[]}
      labelOf={() => 'A'}
      describe={() => 'Reset the error count'}
      onOpen={vi.fn()}
      onJump={onJump}
      {...props}
    />,
  );

  return { onJump };
}

describe('a change that opens more than once', () => {
  it('offers the run below from the marker that ends one', async () => {
    const { onJump } = badges({ ends: ['0'], continuesBelow: ['0'] });

    const jump = screen.getByRole('button', { name: /next part of logical change A/ });
    await userEvent.click(jump);

    expect(onJump).toHaveBeenCalledWith('0', 'below');
  });

  it('offers the run above from the marker that starts one', async () => {
    const { onJump } = badges({ starts: ['0'], continuesAbove: ['0'] });

    const jump = screen.getByRole('button', {
      name: /previous part of logical change A/,
    });
    await userEvent.click(jump);

    expect(onJump).toHaveBeenCalledWith('0', 'above');
  });

  // The chevron follows the marker it sits on, so a start never offers to go
  // further down and an end never offers to go back up.
  it('does not point the way the marker cannot go', () => {
    badges({ starts: ['0'], continuesBelow: ['0'] });
    expect(screen.queryByRole('button', { name: /part of logical/ })).toBeNull();
  });

  it('says nothing on a change with a single run', () => {
    badges({ ends: ['0'] });
    expect(screen.queryByRole('button', { name: /part of logical/ })).toBeNull();
  });
});
