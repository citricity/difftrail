/**
 * Rate-limiting a callback that can fire far faster than its work is worth.
 *
 * Built for window resizing, where the width feeds a rebuild of the whole row
 * model: a drag reports a new width every frame, and rebuilding that often is
 * wasted work the reader never sees. So the first call runs at once — the
 * window reacts the moment it starts to move — later calls within `wait` are
 * collapsed into one, and that one always runs with the **latest** arguments
 * when the interval ends. The final size of a drag is therefore never dropped,
 * which is the one thing a throttle for layout must not get wrong.
 */

export interface Throttled<Args extends unknown[]> {
  (...args: Args): void;
  /** Drops a pending trailing call, for unmounting. */
  cancel: () => void;
}

export function throttle<Args extends unknown[]>(
  callback: (...args: Args) => void,
  wait: number,
): Throttled<Args> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Args | null = null;

  const run = (args: Args): void => {
    last = Date.now();
    callback(...args);
  };

  const throttled = (...args: Args): void => {
    const remaining = wait - (Date.now() - last);

    if (remaining <= 0 && timer === null) {
      run(args);
      return;
    }

    pending = args;
    timer ??= setTimeout(
      () => {
        timer = null;
        const next = pending;
        pending = null;
        if (next !== null) run(next);
      },
      Math.max(0, remaining),
    );
  };

  throttled.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return throttled;
}
