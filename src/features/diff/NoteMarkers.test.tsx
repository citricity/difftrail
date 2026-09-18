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

    expect(onJump).toHaveBeenCalledWith('0', 'nextRun');
  });

  it('offers the run above from the marker that starts one', async () => {
    const { onJump } = badges({ starts: ['0'], continuesAbove: ['0'] });

    const jump = screen.getByRole('button', {
      name: /previous part of logical change A/,
    });
    await userEvent.click(jump);

    expect(onJump).toHaveBeenCalledWith('0', 'previousRun');
  });

  // Each chevron means the next stop that way for this change, which is not
  // the same thing on a start marker as on an end one.
  it('offers this run\'s far end from the marker at its start', async () => {
    const { onJump } = badges({ starts: ['0'], runEndBelow: ['0'] });

    await userEvent.click(
      screen.getByRole('button', { name: /end of this part of logical change A/ }),
    );

    expect(onJump).toHaveBeenCalledWith('0', 'runEnd');
  });

  it('offers the way back from the marker at its end', async () => {
    const { onJump } = badges({ ends: ['0'], runStartAbove: ['0'] });

    await userEvent.click(
      screen.getByRole('button', { name: /start of this part of logical change A/ }),
    );

    expect(onJump).toHaveBeenCalledWith('0', 'runStart');
  });

  it('stacks both when a marker can go each way', () => {
    badges({ ends: ['0'], continuesBelow: ['0'], runStartAbove: ['0'] });

    expect(screen.getByRole('button', { name: /next part/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /start of this part/ }),
    ).toBeInTheDocument();
  });

  it('says nothing on a single-hunk run that stands alone', () => {
    badges({ ends: ['0'] });
    expect(screen.queryByRole('button', { name: /logical change A$/ })).toBeNull();
  });
});
