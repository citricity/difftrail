/**
 * A bounded task queue.
 *
 * Diff loading is parallel but not unbounded: firing three hundred `git diff`
 * processes at once is slower than a handful, and starves the file the user is
 * actually looking at. A small limit keeps the pipe full without that.
 */

export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Tasks currently executing. */
  readonly active: number;
  /** Tasks waiting for a slot. */
  readonly pending: number;
}

export function createLimiter(maxConcurrent: number): Limiter {
  if (maxConcurrent < 1) {
    throw new RangeError('maxConcurrent must be at least 1');
  }

  const queue: Array<() => void> = [];
  let active = 0;

  const release = (): void => {
    active -= 1;
    const next = queue.shift();
    if (next !== undefined) next();
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = (): void => {
          active += 1;
          // `task()` may throw synchronously; treat that as a rejection so a
          // slot is never leaked.
          void (async () => {
            try {
              resolve(await task());
            } catch (error) {
              // Forwarded exactly as thrown. The limiter is transparent: a
              // caller's `catch` must see the backend's own AppError, not a
              // wrapper this queue invented.
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
              reject(error);
            } finally {
              release();
            }
          })();
        };

        if (active < maxConcurrent) {
          start();
        } else {
          queue.push(start);
        }
      });
    },

    get active() {
      return active;
    },

    get pending() {
      return queue.length;
    },
  };
}
