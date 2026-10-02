import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * HER VOICE ON A PHONE (Aarav, 2026-10-02: "ise mobile use ke liye ready
 * karo"). Her voice plays through one AudioContext, made when she first
 * speaks — after the student's tap has passed. iPhone Safari keeps a context
 * made outside a tap suspended, and a suspended one plays nothing. So the
 * first tap anywhere in the app makes it (or wakes it) and plays one silent
 * sample, which is what unlocks audio on iOS.
 */
const made: { state: string; resumed: number; played: number }[] = [];
class FakeContext {
  state = 'suspended';
  resumed = 0;
  played = 0;
  destination = {};
  currentTime = 0;
  constructor() {
    made.push(this as never);
  }
  resume() {
    this.resumed += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  createAnalyser() {
    return { fftSize: 0, connect: () => undefined };
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return { buffer: null, connect: () => undefined, start: () => void (this.played += 1) };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  made.length = 0;
  vi.resetModules();
});

describe('unlocking her voice on the first tap', () => {
  it('makes her voice’s context in the tap, wakes it, and plays one silent sample', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const { unlockAudio } = await import('../src/avatar/avatarBus');
    unlockAudio();
    expect(made).toHaveLength(1);
    expect(made[0].resumed).toBe(1);
    expect(made[0].played).toBe(1);
  });

  it('is the same context her voice then plays through, and later taps cost nothing', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const { unlockAudio, avatarPcmOutput } = await import('../src/avatar/avatarBus');
    unlockAudio();
    unlockAudio();
    avatarPcmOutput();
    expect(made).toHaveLength(1);
    expect(made[0].played).toBe(1);
  });

  it('does nothing where there is no Web Audio', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const { unlockAudio } = await import('../src/avatar/avatarBus');
    expect(() => unlockAudio()).not.toThrow();
  });
});
