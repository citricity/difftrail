import { describe, expect, it } from 'vitest';
import { addRange, rangeLength, splitGap } from './ranges.ts';

const r = (start: number, end: number) => ({ start, end });

describe('addRange', () => {
  it('keeps ranges sorted', () => {
    expect(addRange([r(30, 40)], r(10, 20))).toEqual([r(10, 20), r(30, 40)]);
  });

  it('merges overlapping ranges', () => {
    expect(addRange([r(10, 20)], r(15, 25))).toEqual([r(10, 25)]);
  });

  it('merges ranges that merely touch', () => {
    // 10-19 then 20-29 is one block of context, not two with an empty
    // expander wedged between them.
    expect(addRange([r(10, 19)], r(20, 29))).toEqual([r(10, 29)]);
  });

  it('closes a gap it bridges', () => {
    expect(addRange([r(1, 10), r(21, 30)], r(11, 20))).toEqual([r(1, 30)]);
  });

  it('ignores an empty range', () => {
    const existing = [r(1, 10)];
    expect(addRange(existing, r(5, 4))).toBe(existing);
  });
});

describe('splitGap', () => {
  it('reports a wholly hidden gap as one run', () => {
    expect(splitGap(r(1, 100), [])).toEqual([{ kind: 'hidden', range: r(1, 100) }]);
  });

  it('reports a wholly revealed gap as one run', () => {
    expect(splitGap(r(10, 20), [r(1, 100)])).toEqual([
      { kind: 'shown', range: r(10, 20) },
    ]);
  });

  it('leaves an expander above context revealed from the bottom', () => {
    expect(splitGap(r(1, 100), [r(81, 100)])).toEqual([
      { kind: 'hidden', range: r(1, 80) },
      { kind: 'shown', range: r(81, 100) },
    ]);
  });

  it('leaves an expander below context revealed from the top', () => {
    expect(splitGap(r(1, 100), [r(1, 20)])).toEqual([
      { kind: 'shown', range: r(1, 20) },
      { kind: 'hidden', range: r(21, 100) },
    ]);
  });

  it('leaves an expander on both sides of context revealed in the middle', () => {
    expect(splitGap(r(1, 100), [r(41, 60)])).toEqual([
      { kind: 'hidden', range: r(1, 40) },
      { kind: 'shown', range: r(41, 60) },
      { kind: 'hidden', range: r(61, 100) },
    ]);
  });

  it('expands from both ends independently', () => {
    expect(splitGap(r(1, 100), [r(1, 20), r(81, 100)])).toEqual([
      { kind: 'shown', range: r(1, 20) },
      { kind: 'hidden', range: r(21, 80) },
      { kind: 'shown', range: r(81, 100) },
    ]);
  });

  it('clips revealed ranges belonging to other gaps', () => {
    // The revealed set is per file, so it holds ranges from every gap.
    expect(splitGap(r(50, 60), [r(1, 20), r(55, 200)])).toEqual([
      { kind: 'hidden', range: r(50, 54) },
      { kind: 'shown', range: r(55, 60) },
    ]);
  });

  it('has nothing to say about an empty gap', () => {
    expect(splitGap(r(10, 9), [])).toEqual([]);
    expect(rangeLength(r(10, 9))).toBe(0);
  });
});
