/**
 * The Settings dialog's dependent field: the wrap column only applies to
 * fixed-column wrapping, and says so by being disabled otherwise.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog.tsx';
import { DEFAULT_SETTINGS } from '../../types/index.ts';
import type { WrapMode } from '../../types/index.ts';

function renderWith(wrap: WrapMode) {
  const update = vi.fn();
  render(
    <SettingsDialog
      state={{
        settings: { ...DEFAULT_SETTINGS, wrap, wrapLength: 90 },
        error: null,
        update,
      }}
    />,
  );
  const column = screen.getByLabelText<HTMLInputElement>(/Fixed column/);
  const mode = screen.getByLabelText<HTMLSelectElement>(/Wrap long lines/);
  return { update, column, mode };
}

describe('SettingsDialog', () => {
  it('enables the column when wrapping at a fixed column', () => {
    expect(renderWith('column').column.disabled).toBe(false);
  });

  it.each<WrapMode>(['auto', 'off'])(
    'disables the column when wrapping is %s',
    (wrap) => {
      const { column } = renderWith(wrap);
      expect(column.disabled).toBe(true);
      // Still shown: the value is stored and comes back with fixed-column mode.
      expect(column.value).toBe('90');
    },
  );

  it('asks for the new mode when the dropdown changes', () => {
    const { mode, update } = renderWith('column');
    fireEvent.change(mode, { target: { value: 'auto' } });
    expect(update).toHaveBeenCalledWith({ wrap: 'auto' });
  });
});
