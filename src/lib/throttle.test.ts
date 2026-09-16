import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from './throttle.ts';

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the first call immediately', () => {
    const callback = vi.fn();
    throttle(callback, 100)(1);
    expect(callback).toHaveBeenCalledWith(1);
  });

  it('collapses a burst into one trailing call with the latest arguments', () => {
    const callback = vi.fn();
    const throttled = throttle(callback, 100);

    throttled(1);
    throttled(2);
    throttled(3);
    throttled(4);
    expect(callback.mock.calls).toEqual([[1]]);

    vi.advanceTimersByTime(100);
    expect(callback.mock.calls).toEqual([[1], [4]]);
  });

  it('never runs more than once per interval during a long burst', () => {
    // A resize drag: a new width every frame for a second.
    const callback = vi.fn();
    const throttled = throttle(callback, 100);

    for (let frame = 0; frame < 60; frame += 1) {
      throttled(frame);
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(100);

    expect(callback.mock.calls.length).toBeLessThanOrEqual(11);
    // The size the drag ended on is the one that sticks.
    expect(callback.mock.calls.at(-1)).toEqual([59]);
  });

  it('runs immediately again once the interval has passed quietly', () => {
    const callback = vi.fn();
    const throttled = throttle(callback, 100);

    throttled(1);
    vi.advanceTimersByTime(250);
    throttled(2);

    expect(callback.mock.calls).toEqual([[1], [2]]);
  });

  it('drops the trailing call when cancelled', () => {
    const callback = vi.fn();
    const throttled = throttle(callback, 100);

    throttled(1);
    throttled(2);
    throttled.cancel();
    vi.advanceTimersByTime(200);

    expect(callback.mock.calls).toEqual([[1]]);
  });
});
