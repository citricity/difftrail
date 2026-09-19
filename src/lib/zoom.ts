/**
 * The levels the interface is scaled through.
 *
 * Page zoom takes any factor at all, so the ladder is a choice rather than a
 * constraint: a fixed percentage step gives either a first step too small to
 * see or a last one that leaps, which is why browsers use a ladder that opens
 * out as it climbs. These are those levels, so the keys behave where they were
 * borrowed from.
 */

import { DEFAULT_SETTINGS, MAX_ZOOM, MIN_ZOOM } from '../types/index.ts';
import type { ZoomDirection } from '../types/index.ts';

export const ZOOM_LEVELS = [
  50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300,
] as const;

/**
 * The level one step in `direction` from `current`.
 *
 * Found by value rather than by index: the stored level may be a rung that no
 * longer exists, or one a hand-edited settings file invented, and from between
 * two rungs a press should still move exactly one. Stepping past either end
 * stays on it, which is also what the backend would clamp it to.
 */
export function stepZoom(current: number, direction: ZoomDirection): number {
  if (direction === 'reset') return DEFAULT_SETTINGS.zoom;

  if (direction === 'in') {
    return ZOOM_LEVELS.find((level) => level > current) ?? MAX_ZOOM;
  }

  return [...ZOOM_LEVELS].reverse().find((level) => level < current) ?? MIN_ZOOM;
}
