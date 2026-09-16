/**
 * The file list: what it opens on, how it filters, and what the keys do.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileNavigator } from './FileNavigator.tsx';
import { loadedFile } from '../../test/factories.ts';

const FILES = [
  loadedFile('README.md', 1),
  loadedFile('src/features/diff/DiffDocument.tsx', 2),
  loadedFile('src/lib/rows.ts', 1),
  loadedFile('src/lib/throttle.ts', 1),
];

function open(currentFileId: string | null = 'src/lib/rows.ts') {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <FileNavigator
      files={FILES}
      currentFileId={currentFileId}
      anchor={{ top: 40, left: 20 }}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  const input = screen.getByRole('combobox', { name: 'Filter files' });
  const options = () => within(screen.getByRole('listbox')).getAllByRole('option');
  const highlighted = () =>
    options().find((option) => option.getAttribute('aria-selected') === 'true');
  return { onSelect, onClose, input, options, highlighted };
}

describe('FileNavigator', () => {
  it('lists every file in document order and opens on the current one', () => {
    const { options, highlighted } = open();

    expect(options()).toHaveLength(4);
    expect(highlighted()?.textContent).toContain('rows.ts');
    expect(highlighted()?.getAttribute('aria-current')).toBe('location');
  });

  it('starts at the top when there is no current file', () => {
    const { highlighted } = open(null);
    expect(highlighted()?.textContent).toContain('README.md');
  });

  it('filters as you type and highlights the best match', () => {
    const { input, options, highlighted } = open();

    // README.md can spell "dd" too, but DiffDocument has it as initials.
    fireEvent.change(input, { target: { value: 'dd' } });

    expect(options()).toHaveLength(2);
    expect(highlighted()?.textContent).toContain('DiffDocument.tsx');
  });

  it('says so when nothing matches', () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No files match')).toBeTruthy();
  });

  it('moves with the arrow keys, stopping at the ends, and goes with Enter', () => {
    const { input, highlighted, onSelect } = open();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(highlighted()?.textContent).toContain('throttle.ts');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(highlighted()?.textContent).toContain('throttle.ts');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('src/features/diff/DiffDocument.tsx');
  });

  it('goes to a file when it is clicked', () => {
    const { options, onSelect } = open();
    fireEvent.click(options()[0]);
    expect(onSelect).toHaveBeenCalledWith('README.md');
  });

  it('marks the characters the filter matched', () => {
    const { input, options } = open();
    fireEvent.change(input, { target: { value: 'rows' } });

    const marks = options()[0].querySelectorAll('mark');
    expect([...marks].map((mark) => mark.textContent).join('')).toBe('rows');
  });
});
