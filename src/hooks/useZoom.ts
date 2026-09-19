/**
 * Scaling the whole interface.
 *
 * The level is an ordinary preference, and storing it is what applies it: the
 * backend hands it to the webview's page zoom (see `commands::set_settings`),
 * which scales the CSS pixel itself. So everything scales together — the code,
 * the chrome, the icons and the borders — and the row model, which is
 * arithmetic over CSS pixels, does not have to know that any of it happened.
 *
 * Both ways in end up here: the View menu, which sends a direction, and the
 * keys, which the webview sees itself on the platforms that have no menu.
 */

import { useCallback, useEffect, useRef } from 'react';
import { onZoomRequested } from '../services/backend.ts';
import { stepZoom } from '../lib/zoom.ts';
import type { ZoomDirection } from '../types/index.ts';
import type { SettingsState } from './useSettings.ts';

export interface ZoomControls {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export function useZoom({ settings, update }: SettingsState): ZoomControls {
  /**
   * The current level, kept in a ref so that stepping does not tear down and
   * remake the menu subscription each time — `listen` resolves asynchronously,
   * and a subscription that churns can miss the next press.
   */
  const level = useRef(settings.zoom);

  useEffect(() => {
    level.current = settings.zoom;
  }, [settings.zoom]);

  const step = useCallback(
    (direction: ZoomDirection): void => {
      const next = stepZoom(level.current, direction);
      // Already at the end of the ladder, or already at the natural size:
      // storing it again would be a write nobody asked for.
      if (next !== level.current) update({ zoom: next });
    },
    [update],
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    onZoomRequested(step).then(
      (off) => {
        // The effect can be torn down before the subscription resolves, in
        // which case there is nothing to keep and it has to be undone at once.
        if (cancelled) off();
        else unlisten = off;
      },
      (thrown: unknown) => {
        // Rejected when the webview lacks the event permission (see
        // src-tauri/capabilities). The menu items then do nothing, though the
        // keys still work, so at least say why.
        console.error('[difftrek] could not subscribe to the View menu', thrown);
      },
    );

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [step]);

  return {
    zoomIn: useCallback(() => step('in'), [step]),
    zoomOut: useCallback(() => step('out'), [step]),
    resetZoom: useCallback(() => step('reset'), [step]),
  };
}
