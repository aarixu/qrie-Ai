import { describe, expect, it, vi } from 'vitest';
import { createOnDeviceTts, type Synthesiser } from '../src/onDeviceTts';
import { encodeWav } from '../src/wav';
import type { SpeechElement } from '../src/streamingTts';

/**
 * The voice that costs nothing and works on a train.
 *
 * Almost everything here is about the SECOND measurement rather than the
 * first: synthesis runs at 0.7x realtime on a 4 GB phone, so a line made when
 * it is reached puts a five-second silence in front of every sentence. `prime`
 * is what moves that work into the gap where the previous line is playing, and
 * these tests are mostly about that gap being used exactly once.
 */

const made = (seconds = 1) => ({
  samples: new Float32Array(24000 * seconds),
  sampleRate: 24000,
});

/** An element that finishes when told, so a test never waits on real audio. */
const fakeAudio = () => {
  const built: (SpeechElement & { url: string })[] = [];
  const factory = (src: string): SpeechElement => {
    const el = {
      url: src,
      src,
      play: () => Promise.resolve(),
      pause: vi.fn(),
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    built.push(el);
    return el;
  };
  return { built, factory };
};

const finishLast = (built: { onended: (() => void) | null }[]) => {
  built[built.length - 1]?.onended?.();
};

/**
 * Drain the microtask queue.
 *
 * Two `await Promise.resolve()` is not enough and looked like a broken
 * adapter: making a line is synth.speak, then the WAV encode, then the catch,
 * so the audio element does not exist until several ticks in.
 */
const settle = () => new Promise((go) => setTimeout(go, 0));

// URL.createObjectURL does not exist in jsdom's Node side of the fence.
let handed = 0;
const revoked: string[] = [];
vi.stubGlobal('URL', {
  createObjectURL: () => `blob:line-${(handed += 1)}`,
  revokeObjectURL: (url: string) => revoked.push(url),
});

describe('making a line once', () => {
  it('does not synthesise again for a line it already primed', async () => {
    // The player primes N+1 and then speaks it. At 0.7x realtime, doing the
    // work twice is the difference between seamless and unusable.
    const synth: Synthesiser = { speak: vi.fn(async () => made()) };
    const { built, factory } = fakeAudio();
    const tts = createOnDeviceTts({ synth, audio: factory });

    tts.prime!('Look at the cortex.');
    const speaking = tts.speak('Look at the cortex.');
    await settle();
    finishLast(built);
    await speaking;

    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('plays what it made', async () => {
    const synth: Synthesiser = { speak: async () => made() };
    const { built, factory } = fakeAudio();
    const tts = createOnDeviceTts({ synth, audio: factory });

    const speaking = tts.speak('Namaste.');
    await settle();
    expect(built[0].url).toMatch(/^blob:/);
    finishLast(built);
    await speaking;
  });

  it('releases the blobs it stops holding', async () => {
    // A class is fifty lines. Held blobs are a leak that grows with the class.
    const synth: Synthesiser = { speak: async () => made() };
    const tts = createOnDeviceTts({ synth, audio: fakeAudio().factory, keep: 2 });

    revoked.length = 0;
    for (const line of ['one', 'two', 'three', 'four']) tts.prime!(line);
    await new Promise((go) => setTimeout(go, 0));

    expect(revoked.length).toBeGreaterThan(0);
  });
});

describe('when it cannot say the line', () => {
  it('hands over to the fallback rather than going quiet', async () => {
    // The model is still arriving — a 263 MB download happens once, and a
    // student should not sit in silence through it.
    const fallback = { speak: vi.fn(async () => undefined), cancel: vi.fn() };
    const tts = createOnDeviceTts({ synth: { speak: async () => null }, fallback });

    await tts.speak('Namaste.');
    expect(fallback.speak).toHaveBeenCalledWith('Namaste.');
  });

  it('falls back when the synthesiser throws, not just when it returns null', async () => {
    const fallback = { speak: vi.fn(async () => undefined), cancel: vi.fn() };
    const tts = createOnDeviceTts({
      synth: {
        speak: async () => {
          throw new Error('out of memory');
        },
      },
      fallback,
    });

    await tts.speak('Namaste.');
    expect(fallback.speak).toHaveBeenCalled();
  });

  it('finishes the line rather than hanging when the audio will not decode', async () => {
    // A promise nobody resolves stops the class on that beat for good.
    const { built, factory } = fakeAudio();
    const tts = createOnDeviceTts({ synth: { speak: async () => made() }, audio: factory });

    const speaking = tts.speak('Namaste.');
    await settle();
    built[built.length - 1].onerror?.();
    await expect(speaking).resolves.toBeUndefined();
  });
});

describe('cancelling', () => {
  it('stops the sound and the fallback with it', async () => {
    const fallback = { speak: vi.fn(async () => undefined), cancel: vi.fn() };
    const { built, factory } = fakeAudio();
    const tts = createOnDeviceTts({ synth: { speak: async () => made() }, audio: factory, fallback });

    const speaking = tts.speak('Namaste.');
    await settle();
    tts.cancel();

    expect(built[0].pause).toHaveBeenCalled();
    expect(fallback.cancel).toHaveBeenCalled();
    finishLast(built);
    await speaking;
  });

  it('does not start a line that was cancelled while it was being made', async () => {
    let release: (v: unknown) => void = () => {};
    const synth: Synthesiser = {
      speak: async () => {
        await new Promise((go) => (release = go));
        return made();
      },
    };
    const { built, factory } = fakeAudio();
    const tts = createOnDeviceTts({ synth, audio: factory });

    const speaking = tts.speak('Namaste.');
    tts.cancel();
    release(null);
    await speaking;

    expect(built).toHaveLength(0);
  });
});

// ------------------------------------------------------------------- WAV --

describe('the WAV it hands the audio element', () => {
  it('writes a header a player will accept', () => {
    const bytes = encodeWav(new Float32Array(100), 24000);
    const text = new TextDecoder().decode(bytes.slice(0, 4));
    expect(text).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
    expect(bytes.length).toBe(44 + 200);

    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint16(34, true)).toBe(16); // 16-bit
  });

  it('does not invert a full-scale sample into a click', () => {
    /**
     * +1.0 times 32768 overflows to -32768, and one inverted sample at the
     * loudest moment of a line is audible. Synthesis output does reach 1.0.
     */
    const bytes = encodeWav(new Float32Array([1, -1, 0]), 24000);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(0);
  });

  it('clamps anything that came back out of range', () => {
    const view = new DataView(encodeWav(new Float32Array([2.5, -2.5]), 24000).buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});
