/**
 * User preferences.
 *
 * Loading never blocks the diff: the defaults render immediately and the stored
 * values replace them when they arrive, which is a change nobody sees unless
 * they had actually changed something.
 *
 * Saving is optimistic. The UI moves on the click, and the write happens
 * behind it — a preference that visibly lags the checkbox feels broken, and the
 * backend clamps rather than rejects, so the only surprise it can return is a
 * value slightly different from the one asked for.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSettings, setSettings } from '../services/backend.ts';
import { AppError, DEFAULT_SETTINGS } from '../types/index.ts';
import type { Settings } from '../types/index.ts';

export interface SettingsState {
  settings: Settings;
  /** Null unless the last save failed, in which case the dialog says so. */
  error: string | null;
  update: (change: Partial<Settings>) => void;
}

export function useSettings(): SettingsState {
  const [settings, setLocal] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await getSettings();
        if (alive.current) setLocal(stored);
      } catch (thrown) {
        // Defaults are already on screen; there is nothing to tell the user.
        console.error('[difftrek] reading preferences failed', thrown);
      }
    })();
  }, []);

  const update = useCallback((change: Partial<Settings>): void => {
    setLocal((previous) => {
      const next = { ...previous, ...change };

      void (async () => {
        try {
          const stored = await setSettings(next);
          if (!alive.current) return;

          setError(null);
          // What came back is what was stored, clamped; adopting it keeps the
          // dialog honest about a value the backend narrowed.
          setLocal(stored);
        } catch (thrown) {
          if (alive.current) setError(AppError.from(thrown).message);
        }
      })();

      return next;
    });
  }, []);

  return { settings, error, update };
}
