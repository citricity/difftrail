import { describe, expect, it } from 'vitest';
import {
  IDLE_MASCOTS,
  MASCOTS,
  SESSION_IDLE_MASCOT,
  SESSION_MASCOT,
  pickMascot,
} from './mascots.ts';

describe('mascots', () => {
  it('has eight for the end of the document and five for an idle tree, all distinct', () => {
    expect(MASCOTS).toHaveLength(8);
    expect(IDLE_MASCOTS).toHaveLength(5);
    expect(new Set([...MASCOTS, ...IDLE_MASCOTS]).size).toBe(13);
  });

  it('can pick every mascot in a set, including at both ends of the range', () => {
    const picked = IDLE_MASCOTS.map((_, index) =>
      pickMascot(IDLE_MASCOTS, () => index / IDLE_MASCOTS.length),
    );
    expect(picked).toEqual([...IDLE_MASCOTS]);
    expect(pickMascot(MASCOTS, () => 0.999999)).toBe(MASCOTS[MASCOTS.length - 1]);
  });

  it('chooses each session mascot once, from its own set', () => {
    expect(MASCOTS).toContain(SESSION_MASCOT);
    expect(IDLE_MASCOTS).toContain(SESSION_IDLE_MASCOT);
  });
});
