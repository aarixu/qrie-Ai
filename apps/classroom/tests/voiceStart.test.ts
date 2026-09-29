import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TtsAdapter } from '@ai-tutor/player';
import { createPcmStreamTts, type PcmOutput } from '@ai-tutor/voice';
import { announceStart, onLineStart, sayRevealing, withStartOnSpeak } from '../src/lib/voiceStart';

/**
 * WHEN HER VOICE STARTS, THE INK APPEARS (T2.4).
 *
 * The board reveals a step's ink as its sentence starts. "Starts" means the
 * student can HEAR it: the streamed voice fires `onStart` when the line's first
 * sample reaches the speaker, which on Vertex is 1.2-2.1 s after the request.
 * Ink revealed at the request would sit on the board in silence for that long.
 * Every other voice (the browser's, the silent one) cannot say when its sound
 * starts, so it says so when it is asked to speak — reveal-on-speak.
 */

afterEach(() => vi.useRealTimers());

describe('sayRevealing', () => {
  it('reveals when her voice announces the line, not before', async () => {
    let release: () => void = () => undefined;
    const say = (text: string) =>
      new Promise<{ halted: boolean }>((resolve) => {
        release = () => {
          announceStart(text);
          resolve({ halted: false });
        };
      });
    const onStart = vi.fn();
    const done = sayRevealing(say, 'Seven times three.', onStart, () => false);
    await Promise.resolve();
    expect(onStart).not.toHaveBeenCalled();
    release();
    await done;
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('matches the line by its words: another line starting does not reveal this one', async () => {
    const onStart = vi.fn();
    const say = async (text: string) => {
      announceStart('Some other sentence.');
      expect(onStart).not.toHaveBeenCalled();
      announceStart(`  ${text}  `);
      return { halted: false };
    };
    await sayRevealing(say, 'This one.', onStart, () => false);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('reveals once the line has been said even when no voice announced it — the ink is never lost to a mute voice', async () => {
    const onStart = vi.fn();
    await sayRevealing(async () => ({ halted: false }), 'Nobody announced me.', onStart, () => false);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('never reveals on a halted line: the support line replaced it', async () => {
    const onStart = vi.fn();
    await sayRevealing(async () => ({ halted: true }), 'Replaced.', onStart, () => true);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('never reveals after the class halted mid-line, even if the voice still announces it', async () => {
    let halted = false;
    const onStart = vi.fn();
    const say = async (text: string) => {
      halted = true;
      announceStart(text);
      return { halted: true };
    };
    await sayRevealing(say, 'Cut short.', onStart, () => halted);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('stops listening once the line is over, so a later line with the same words does not reveal it twice', async () => {
    const onStart = vi.fn();
    await sayRevealing(async (t) => (announceStart(t), { halted: false }), 'Same words.', onStart, () => false);
    announceStart('Same words.');
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('with nothing to reveal, it is just the line', async () => {
    const result = await sayRevealing(async () => ({ halted: false, said: 'x' }), 'x', undefined, () => false);
    expect(result).toEqual({ halted: false, said: 'x' });
  });
});

describe('withStartOnSpeak', () => {
  it('announces a line the moment it is asked to speak it — a voice that cannot report its sound', async () => {
    const heard: string[] = [];
    const off = onLineStart((t) => heard.push(t));
    const inner: TtsAdapter = { speak: () => new Promise(() => undefined), cancel: () => undefined };
    void withStartOnSpeak(inner).speak('Hello there.');
    expect(heard).toEqual(['Hello there.']);
    off();
  });

  it('passes cancel, prime and drop through', () => {
    const inner = { speak: async () => undefined, cancel: vi.fn(), prime: vi.fn(), drop: vi.fn() };
    const wrapped = withStartOnSpeak(inner);
    wrapped.cancel();
    wrapped.prime?.('next');
    wrapped.drop?.();
    expect(inner.cancel).toHaveBeenCalled();
    expect(inner.prime).toHaveBeenCalledWith('next');
    expect(inner.drop).toHaveBeenCalled();
  });
});

/**
 * THE STREAMED VOICE, THREADED THROUGH: `onStart` fires when the first chunk
 * is scheduled to play, which is what `announceStart` is wired to in
 * lib/lessonVoice.ts. A fake clock stands in for Web Audio.
 */
describe('the streamed voice announces the line when its first sound plays', () => {
  it('reveals on the first sample, not on the request', async () => {
    vi.useFakeTimers();
    const bytes = new Uint8Array([0, 1, 0, 1]);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    });
    let fetched = false;
    const output: PcmOutput = { now: () => 0, play: () => ({ stop: () => undefined }) };
    const tts = createPcmStreamTts({
      endpoint: '/api/speech',
      output: () => output,
      onStart: announceStart,
      fetch: async () => {
        fetched = true;
        return new Response(body, { headers: { 'content-type': 'audio/L16' } });
      },
      // No `sleep` override: the line waits out its audio on the (fake)
      // timer clock, as it does in a browser, so it is still "playing" when
      // the start is announced.
    });
    const onStart = vi.fn();
    const done = sayRevealing(async (t) => (await tts.speak(t), { halted: false }), 'Look here.', onStart, () => false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetched).toBe(true);
    // The first chunk is scheduled 50 ms ahead (LEAD_SEC); the voice reports
    // the start when it plays, and not a moment before.
    await vi.advanceTimersByTimeAsync(10);
    expect(onStart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(onStart).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await done;
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
