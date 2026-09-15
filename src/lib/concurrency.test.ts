import { describe, expect, it } from 'vitest';
import { createLimiter } from './concurrency.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createLimiter', () => {
  it('never runs more than the limit at once', async () => {
    const limiter = createLimiter(2);
    let running = 0;
    let peak = 0;

    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
    };

    await Promise.all(Array.from({ length: 10 }, () => limiter.run(task)));

    expect(peak).toBeLessThanOrEqual(2);
  });

  it('queues the rest and starts them as slots free up', async () => {
    const limiter = createLimiter(1);
    const first = deferred<string>();
    const started: string[] = [];

    const a = limiter.run(async () => {
      started.push('a');
      return first.promise;
    });
    const b = limiter.run(() => {
      started.push('b');
      return Promise.resolve('b');
    });

    expect(started).toEqual(['a']);
    expect(limiter.pending).toBe(1);

    first.resolve('a');
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
    expect(started).toEqual(['a', 'b']);
  });

  it('frees the slot when a task rejects', async () => {
    const limiter = createLimiter(1);

    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limiter.run(() => Promise.resolve('fine'))).resolves.toBe('fine');
    expect(limiter.active).toBe(0);
  });

  it('frees the slot when a task throws synchronously', async () => {
    const limiter = createLimiter(1);

    await expect(
      limiter.run(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');

    await expect(limiter.run(() => Promise.resolve('fine'))).resolves.toBe('fine');
  });

  it('rejects a nonsensical limit', () => {
    expect(() => createLimiter(0)).toThrow(RangeError);
  });
});
