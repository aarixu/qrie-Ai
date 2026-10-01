import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hedged } from '../src/lib/hedge';

/** A call that settles when the test says so. */
function controllable<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a hedged call', () => {
  it('makes one call when the first answers in time', async () => {
    const first = controllable<string>();
    const call = vi.fn(() => first.promise);
    const result = hedged(call, 5000);
    first.resolve('right');
    await expect(result).resolves.toBe('right');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('asks a second time when the first is slow, and takes whichever answers first', async () => {
    const first = controllable<string>();
    const second = controllable<string>();
    const call = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const result = hedged(call, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(call).toHaveBeenCalledTimes(2);
    second.resolve('from the second');
    await expect(result).resolves.toBe('from the second');
    first.resolve('too late');
  });

  it('asks again at once when the first fails fast', async () => {
    const first = controllable<string>();
    const second = controllable<string>();
    const call = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const result = hedged(call, 5000);
    first.reject(new Error('busy'));
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toHaveBeenCalledTimes(2);
    second.resolve('second');
    await expect(result).resolves.toBe('second');
  });

  it('fails only when both calls fail, with the last failure', async () => {
    const first = controllable<string>();
    const second = controllable<string>();
    const call = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const result = hedged(call, 5000);
    const settled = expect(result).rejects.toThrow('second failed');
    await vi.advanceTimersByTimeAsync(5000);
    first.reject(new Error('first failed'));
    second.reject(new Error('second failed'));
    await settled;
  });
});
