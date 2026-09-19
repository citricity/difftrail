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
 *
 * Where the write would never reach the shell — a plain browser, or
 * `--example`, where the fixtures answer it — the hook hands back nothing at
 * all, so the keys stay with whatever else would have had them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { canZoomWindow, onZoomRequested } from '../services/backend.ts';
import { stepZoom } from '../lib/zoom.ts';
import type { ZoomDirection } from '../types/index.ts';
import type { SettingsState } from './useSettings.ts';

export interface ZoomControls {
  /**
   * Undefined wherever a level would not reach a window to scale.
   * `useKeyboardShortcuts` claims a keystroke only when it has a handler for
   * it, so undefined is what leaves ⌘+ to the browser's own zoom under
   * `pnpm dev` instead of swallowing it.
   */
  zoomIn?: () => void;
  zoomOut?: () => void;
  resetZoom?: () => void;
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

  /**
   * Whether there is a window on the other side that will actually scale.
   *
   * Answered asynchronously — the launch options are a command — and false
   * until it lands, which costs nothing: the keys are unclaimed for a moment
   * at startup, which is where they would have gone anyway.
   */
  const [scalable, setScalable] = useState(false);

  useEffect(() => {
    let alive = true;

    canZoomWindow().then(
      (answer) => {
        if (alive) setScalable(answer);
      },
      (thrown: unknown) => {
        console.error('[difftrek] could not tell whether the window scales', thrown);
      },
    );

    return () => {
      alive = false;
    };
  }, []);

  const step = useCallback(
    (direction: ZoomDirection): void => {
      const next = stepZoom(level.current, direction);
      // Already at the end of the ladder, or already at the natural size:
      // storing it again would be a write nobody asked for.
      if (next === level.current) return;

      // Advanced here rather than left to the effect above, which cannot run
      // until the stored level has been round the render: two presses in quick
      // succession would otherwise both step from where the first one started,
      // and the second would appear to do nothing. A level the backend narrows
      // still arrives through that effect and corrects this one.
      level.current = next;
      update({ zoom: next });
    },
    [update],
  );

  useEffect(() => {
    if (!scalable) return undefined;

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
  }, [scalable, step]);

  const zoomIn = useCallback(() => step('in'), [step]);
  const zoomOut = useCallback(() => step('out'), [step]);
  const resetZoom = useCallback(() => step('reset'), [step]);

  return scalable ? { zoomIn, zoomOut, resetZoom } : {};
}
