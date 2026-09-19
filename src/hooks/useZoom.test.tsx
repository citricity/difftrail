/**
 * Zoom is inert where it would not reach a window, and steps one rung per
 * press however fast the presses come.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../types/index.ts';
import type { Settings, ZoomDirection } from '../types/index.ts';
import type { SettingsState } from './useSettings.ts';

const canZoomWindow = vi.fn<() => Promise<boolean>>();
let requested: (direction: ZoomDirection) => void = () => undefined;

vi.mock('../services/backend.ts', () => ({
  canZoomWindow: () => canZoomWindow(),
  // Keeps the handler, so a test can 'choose the menu item'.
  onZoomRequested: (handler: (direction: ZoomDirection) => void) => {
    requested = handler;
    return Promise.resolve(() => undefined);
  },
}));

const { useZoom } = await import('./useZoom.ts');

/**
 * `useSettings` with the save taken out: `update` records what it was asked
 * for, and — like the real one — does not change `settings` until a render
 * later, which is the gap the rapid-step test is about.
 */
function settingsState(settings: Settings = DEFAULT_SETTINGS): SettingsState & {
  updates: Partial<Settings>[];
} {
  const updates: Partial<Settings>[] = [];
  return {
    settings,
    error: null,
    update: (change) => updates.push(change),
    updates,
  };
}

beforeEach(() => {
  canZoomWindow.mockResolvedValue(true);
});

describe('zoom', () => {
  it('steps a rung per press, however close together they are', async () => {
    const state = settingsState();
    const { result } = renderHook(() => useZoom(state));
    await waitFor(() => expect(result.current.zoomIn).toBeDefined());

    // Both presses in one go, so the stored level has had no chance to come
    // back round in between.
    act(() => {
      result.current.zoomIn?.();
      result.current.zoomIn?.();
    });

    expect(state.updates).toEqual([{ zoom: 110 }, { zoom: 125 }]);
  });

  it('does not write a level it is already on', async () => {
    const state = settingsState({ ...DEFAULT_SETTINGS, zoom: 300 });
    const { result } = renderHook(() => useZoom(state));
    await waitFor(() => expect(result.current.zoomIn).toBeDefined());

    act(() => result.current.zoomIn?.());

    expect(state.updates).toEqual([]);
  });

  it('answers the View menu with the same steps', async () => {
    const state = settingsState();
    renderHook(() => useZoom(state));
    await waitFor(() => expect(requested).toBeDefined());

    act(() => requested('out'));

    expect(state.updates).toEqual([{ zoom: 90 }]);
  });

  // Nothing on the other side to scale: handing back a control would only
  // swallow ⌘+ where the browser's own zoom should have had it.
  it('hands back nothing where the level would not reach a window', async () => {
    canZoomWindow.mockResolvedValue(false);
    const state = settingsState();
    const { result } = renderHook(() => useZoom(state));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.zoomIn).toBeUndefined();
    expect(result.current.zoomOut).toBeUndefined();
    expect(result.current.resetZoom).toBeUndefined();
  });
});
