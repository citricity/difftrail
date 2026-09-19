import { describe, expect, it } from 'vitest';
import { ZOOM_LEVELS, stepZoom } from './zoom.ts';
import { DEFAULT_SETTINGS, MAX_ZOOM, MIN_ZOOM } from '../types/index.ts';

describe('the zoom ladder', () => {
  it('spans exactly what the backend will store', () => {
    // The ends are clamped in Rust; a ladder reaching past them would have
    // rungs that silently do nothing.
    expect(ZOOM_LEVELS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBe(MAX_ZOOM);
    expect(ZOOM_LEVELS).toContain(DEFAULT_SETTINGS.zoom);
  });

  it('climbs and descends one rung at a time', () => {
    expect(stepZoom(100, 'in')).toBe(110);
    expect(stepZoom(110, 'out')).toBe(100);
  });

  it('stays put at either end', () => {
    expect(stepZoom(MAX_ZOOM, 'in')).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, 'out')).toBe(MIN_ZOOM);
  });

  it('moves one rung from between two of them', () => {
    // A level from a hand-edited file, or from a ladder that has since
    // changed: the next press still has somewhere sensible to go.
    expect(stepZoom(105, 'in')).toBe(110);
    expect(stepZoom(105, 'out')).toBe(100);
  });

  it('returns to the natural size whatever it was on', () => {
    expect(stepZoom(300, 'reset')).toBe(DEFAULT_SETTINGS.zoom);
    expect(stepZoom(50, 'reset')).toBe(DEFAULT_SETTINGS.zoom);
  });
});
