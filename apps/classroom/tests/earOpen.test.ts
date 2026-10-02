import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE EAR THAT STAYS OPEN (Aarav, 2026-10-02: "STT kaam nahi kar raha, tutor
 * interrupt nahi ho rahi").
 *
 * The mic used to open only once she had finished asking, so anything a
 * student said while she was talking — an answer begun early, an interruption
 * — was never heard. The open ear is started once, on a tap, and stays open
 * for the class: it tells the room when the student starts talking over her,
 * and a listen on it keeps the speech that was already under way.
 */

const mic = vi.hoisted(() => ({
  onChunk: null as ((pcm: Int16Array) => void) | null,
  started: 0,
  stopped: 0,
}));
const posts = vi.hoisted(() => [] as { type: string; bytes: number }[]);

const CHUNK = 1600; // 100 ms at 16 kHz
const quiet = () => new Int16Array(CHUNK);
const loud = () => new Int16Array(CHUNK).fill(3000);

vi.mock('@ai-tutor/voice', async (real) => ({
  ...(await real<typeof import('@ai-tutor/voice')>()),
  createMicCapture: (onChunk: (pcm: Int16Array) => void) => ({
    start: async () => {
      mic.started += 1;
      mic.onChunk = onChunk;
    },
    stop: () => {
      mic.stopped += 1;
      mic.onChunk = null;
    },
    recording: async () => null,
  }),
}));

vi.mock('../src/lib/relay', () => ({
  relayFetch: async (_path: string, init: RequestInit) => {
    const body = init.body as ArrayBuffer;
    posts.push({ type: String((init.headers as Record<string, string>)['content-type']), bytes: body.byteLength });
    return new Response(JSON.stringify({ text: 'lactic acid' }), { status: 200 });
  },
}));

const { openEar, closeEar, isEarOpen, onStudentSpeech, listenOnce } = await import('../src/lib/ear');

const push = (make: () => Int16Array, n: number): void => {
  for (let i = 0; i < n; i += 1) mic.onChunk?.(make());
};
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mic.started = 0;
  mic.stopped = 0;
  posts.length = 0;
});
afterEach(() => closeEar());

describe('the open ear', () => {
  it('opens one mic and keeps it until it is closed', async () => {
    expect(await openEar()).toBe(true);
    expect(await openEar()).toBe(true);
    expect(isEarOpen()).toBe(true);
    expect(mic.started).toBe(1);
    closeEar();
    expect(isEarOpen()).toBe(false);
    expect(mic.stopped).toBe(1);
  });

  it('says when the student starts talking, once per stretch of speech', async () => {
    await openEar();
    const heard = vi.fn();
    const off = onStudentSpeech(heard);
    push(quiet, 5);
    push(loud, 3);
    expect(heard).not.toHaveBeenCalled(); // 300 ms is a cough, not a sentence
    push(loud, 6);
    expect(heard).toHaveBeenCalledTimes(1);
    push(quiet, 5); // a real pause...
    push(loud, 5); // ...and they speak again
    expect(heard).toHaveBeenCalledTimes(2);
    off();
  });

  it('keeps the speech already under way when a listen starts', async () => {
    await openEar();
    push(quiet, 5);
    push(loud, 6); // they started answering while she was finishing
    const listening = listenOnce();
    await tick();
    push(loud, 4);
    push(quiet, 12);
    const heard = await listening;
    expect(heard).toMatchObject({ text: 'lactic acid', reason: 'heard' });
    expect(mic.started).toBe(1); // the open ear's mic, not a second one
    // The 10 loud chunks are all in it, from before the listen and after.
    expect(posts).toHaveLength(1);
    expect(posts[0].type).toBe('audio/wav');
    expect(posts[0].bytes).toBeGreaterThanOrEqual(44 + 10 * CHUNK * 2);
  });

  it('waits for an answer like the old ear when nobody was talking', async () => {
    await openEar();
    push(quiet, 20);
    const listening = listenOnce();
    await tick();
    push(quiet, 5);
    push(loud, 8);
    push(quiet, 12);
    const heard = await listening;
    expect(heard.reason).toBe('heard');
    // 3 chunks of lead-in, the 8 of speech, 2 of the quiet that ended it.
    expect(posts[0].bytes).toBe(44 + (3 + 8 + 2) * CHUNK * 2);
  });

  it('does not report the student talking while a listen is taking it down', async () => {
    await openEar();
    const heard = vi.fn();
    const off = onStudentSpeech(heard);
    const listening = listenOnce();
    await tick();
    push(loud, 8);
    push(quiet, 12);
    await listening;
    expect(heard).not.toHaveBeenCalled();
    off();
  });

  it('never hands the same answer to the next listen', async () => {
    await openEar();
    const first = listenOnce();
    await tick();
    push(loud, 8);
    push(quiet, 12);
    await first;
    const second = listenOnce({ graceMs: 1_000 });
    await tick();
    push(quiet, 12);
    expect((await second).reason).toBe('silence');
    expect(posts).toHaveLength(1);
  });
});
