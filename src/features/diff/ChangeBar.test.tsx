import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChangeBar } from './ChangeBar.tsx';

function bar(overrides: Partial<Parameters<typeof ChangeBar>[0]> = {}) {
  const props = {
    label: 'A',
    description: 'Reset the error count',
    position: 1,
    total: 3,
    onHunk: true,
    focused: false,
    canGoNext: true,
    canGoPrevious: false,
    onOpenContents: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onToggleFocus: vi.fn(),
    ...overrides,
  };

  render(<ChangeBar {...props} />);
  return props;
}

describe('the change bar', () => {
  it('names the change the reader is in, and where it sits', () => {
    bar();

    expect(screen.getByText('Reset the error count')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('says a hunk belongs to no change, rather than showing an empty row', () => {
    bar({ label: null, description: null, position: null });
    expect(screen.getByText('Not part of a logical change')).toBeInTheDocument();
  });

  it('offers the shape of the diff before the reader has stepped anywhere', () => {
    bar({ label: null, description: null, position: null, onHunk: false });
    expect(screen.getByText('3 logical changes')).toBeInTheDocument();
  });

  it('cannot narrow to a change that is not there', () => {
    bar({ label: null, description: null, position: null, onHunk: false });
    expect(screen.getByRole('button', { name: /Focus this change/ })).toBeDisabled();
  });

  it('steps, and opens the contents', async () => {
    const props = bar();

    await userEvent.click(screen.getByRole('button', { name: 'Next logical change' }));
    expect(props.onNext).toHaveBeenCalled();

    expect(
      screen.getByRole('button', { name: 'Previous logical change' }),
    ).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'All logical changes' }));
    expect(props.onOpenContents).toHaveBeenCalled();
  });

  it('shows the narrowing as pressed, not just as a tint', () => {
    bar({ focused: true });
    expect(
      screen.getByRole('button', { name: /Stop focusing this change/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
