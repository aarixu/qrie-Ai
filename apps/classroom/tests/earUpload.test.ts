import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WHAT THE EAR UPLOADS (2026-09-30: "relay ka 0.7 sec bhi fix karo"). A 3-4 s
 * answer is 105-136 KB as WAV and 10-13 KB as Opus; the upload was measured
 * at about 0.12 s on a good line with spikes to 3 s. So the ear sends the
 * compressed recording where the browser makes one, falls back to the WAV on
 * a relay that refuses it, and trims the WAV's trailing quiet either way.
 */

const state = vi.hoisted(() => ({
  recording: null as { blob: Blob; type: string } | null,
  posts: [] as { type: string; bytes: number }[],
  refuseCompressed: false,
}));

const CHUNK = 1600; // 100 ms at 16 kHz
const quiet = () => new Int16Array(CHUNK);
const speech = () => new Int16Array(CHUNK).fill(3000);

vi.mock('@ai-tutor/voice', async (real) => ({
  ...(await real<typeof import('@ai-tutor/voice')>()),
  createMicCapture: (onChunk: (pcm: Int16Array) => void) => ({
    start: async () => {
      setTimeout(() => {
        for (let i = 0; i < 5; i++) onChunk(quiet());
        for (let i = 0; i < 10; i++) onChunk(speech());
        for (let i = 0; i < 12; i++) onChunk(quiet());
      }, 0);
    },
    stop: () => undefined,
    recording: async () => state.recording,
  }),
}));

vi.mock('../src/lib/relay', () => ({
  relayFetch: async (_path: string, init: RequestInit) => {
    const type = String((init.headers as Record<string, string>)['content-type']);
    const body = init.body as Blob | ArrayBuffer;
    const bytes = body instanceof Blob ? body.size : body.byteLength;
    state.posts.push({ type, bytes });
    if (state.refuseCompressed && type !== 'audio/wav') return new Response('{}', { status: 415 });
    return new Response(JSON.stringify({ text: 'mujhe lagta hai' }), { status: 200 });
  },
}));

const { listenOnce } = await import('../src/lib/ear');

beforeEach(() => {
  state.recording = null;
  state.posts = [];
  state.refuseCompressed = false;
});

describe('the ear upload', () => {
  it('sends the compressed recording when the browser made one', async () => {
    state.recording = { blob: new Blob([new Uint8Array(12_000)], { type: 'audio/webm' }), type: 'audio/webm' };
    const heard = await listenOnce();
    expect(heard.text).toBe('mujhe lagta hai');
    expect(state.posts).toEqual([{ type: 'audio/webm', bytes: 12_000 }]);
    expect(typeof heard.speechEndedAt).toBe('number');
  });

  it('asks again with the WAV when the relay does not take compressed audio', async () => {
    state.recording = { blob: new Blob([new Uint8Array(12_000)], { type: 'audio/webm' }), type: 'audio/webm' };
    state.refuseCompressed = true;
    const heard = await listenOnce();
    expect(heard.text).toBe('mujhe lagta hai');
    expect(state.posts.map((p) => p.type)).toEqual(['audio/webm', 'audio/wav']);
  });

  it('sends a WAV without the trailing quiet when there is no recording', async () => {
    const heard = await listenOnce();
    expect(heard.reason).toBe('heard');
    // 3 chunks of lead-in, 10 of speech, 2 of the 9 quiet ones that ended it.
    expect(state.posts).toEqual([{ type: 'audio/wav', bytes: 44 + (3 + 10 + 2) * CHUNK * 2 }]);
  });
});
