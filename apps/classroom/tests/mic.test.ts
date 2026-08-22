import { afterEach, describe, expect, it, vi } from 'vitest';
import { micStatus, requestMic, resetMicStatusForTest } from '../src/lib/mic';

const setMediaDevices = (getUserMedia: unknown): void => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: getUserMedia ? { getUserMedia } : undefined,
    configurable: true,
  });
};

afterEach(() => {
  resetMicStatusForTest();
  vi.restoreAllMocks();
});

describe('requestMic', () => {
  it('reports unavailable when the browser has no mediaDevices', async () => {
    setMediaDevices(undefined);
    expect(await requestMic()).toBe('unavailable');
    expect(micStatus()).toBe('unavailable');
  });

  it('grants and releases the probe stream immediately', async () => {
    const stop = vi.fn();
    setMediaDevices(vi.fn().mockResolvedValue({ getTracks: () => [{ stop }, { stop }] }));
    expect(await requestMic()).toBe('granted');
    // Both tracks released — a held stream would leave the recording dot on.
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('reports denied without throwing when the user refuses', async () => {
    setMediaDevices(vi.fn().mockRejectedValue(new Error('NotAllowedError')));
    expect(await requestMic()).toBe('denied');
  });

  it('does not re-prompt once granted', async () => {
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
    setMediaDevices(getUserMedia);
    await requestMic();
    await requestMic();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('retries after a denial (the student may fix permissions and try again)', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValueOnce({ getTracks: () => [] });
    setMediaDevices(getUserMedia);
    expect(await requestMic()).toBe('denied');
    expect(await requestMic()).toBe('granted');
  });
});
