import { describe, expect, it, vi } from 'vitest';
import type { TtsAdapter } from '@ai-tutor/player';
import type { AudioPlayer } from '../src/audio';
import {
  DEFAULT_TTS_MODEL,
  DEFAULT_TUTOR_VOICE,
  createGeminiTts,
  type FetchLike,
  type HttpResponse,
} from '../src/geminiTts';
import { pcmDurationMs } from '../src/synthesis';
import type { Schedule } from '../src/utterance';

/** Enough base64 to be a real utterance: 4000 chars ≈ 1500 samples ≈ 62 ms. */
const BASE64 = 'A'.repeat(4000);
const PCM_MIME = 'audio/l16; rate=24000; channels=1';

function fakePlayer(): { player: AudioPlayer; chunks: string[]; stops: () => number } {
  const chunks: string[] = [];
  let stops = 0;
  return {
    chunks,
    stops: () => stops,
    player: {
      enqueue: (base64: string) => {
        chunks.push(base64);
      },
      stop: () => {
        stops += 1;
      },
      isPlaying: () => false,
      close: () => undefined,
    },
  };
}

/** Fires nothing until flush() — the test owns the clock, so there isn't one. */
function fakeSchedule(): { schedule: Schedule; flush: () => void; waits: number[] } {
  const pending: { fn: () => void; cancelled: boolean }[] = [];
  const waits: number[] = [];
  return {
    waits,
    schedule: (fn, ms) => {
      const timer = { fn, cancelled: false };
      pending.push(timer);
      waits.push(ms);
      return () => {
        timer.cancelled = true;
      };
    },
    flush: () => {
      for (const timer of pending.splice(0)) if (!timer.cancelled) timer.fn();
    },
  };
}

/** Runs every timer the moment it is set: for tests that only care about outcomes. */
const immediate: Schedule = (fn) => {
  fn();
  return () => undefined;
};

const audioReply = (base64 = BASE64, mimeType = PCM_MIME): HttpResponse => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: base64 } }] } }] }),
  text: () => Promise.resolve(''),
});

const textReply = (): HttpResponse => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: 'Warm and encouraging' }] } }] }),
  text: () => Promise.resolve(''),
});

const httpError = (status: number): HttpResponse => ({
  ok: false,
  status,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve('upstream said no'),
});

function recordingFallback(): { adapter: TtsAdapter; spoken: string[]; cancels: () => number } {
  const spoken: string[] = [];
  let cancels = 0;
  return {
    spoken,
    cancels: () => cancels,
    adapter: {
      speak: (text: string) => {
        spoken.push(text);
        return Promise.resolve();
      },
      cancel: () => {
        cancels += 1;
      },
    },
  };
}

describe('createGeminiTts', () => {
  it('synthesises once and plays the audio exactly once', async () => {
    const { player, chunks } = fakePlayer();
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(audioReply()));

    const tts = createGeminiTts({
      apiKey: 'k',
      fetch,
      createPlayer: () => player,
      schedule: immediate,
    });
    await tts.speak('Blood is a tissue.');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([BASE64]);
  });

  it('sends the model, the voice and the narration Google needs', async () => {
    const { player } = fakePlayer();
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(audioReply()));

    const tts = createGeminiTts({ apiKey: 'secret', fetch, createPlayer: () => player, schedule: immediate });
    await tts.speak('Plasma is mostly water.');

    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain(`${DEFAULT_TTS_MODEL}:generateContent`);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret');

    const body = JSON.parse(String(init.body)) as {
      contents: { parts: { text: string }[] }[];
      generationConfig: {
        responseModalities: string[];
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } };
      };
    };
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      DEFAULT_TUTOR_VOICE,
    );
    expect(body.contents[0].parts[0].text).toContain('Plasma is mostly water.');
  });

  it('holds the beat for at least as long as the audio runs', async () => {
    const { player } = fakePlayer();
    const clock = fakeSchedule();
    const tts = createGeminiTts({
      apiKey: 'k',
      fetch: () => Promise.resolve(audioReply()),
      createPlayer: () => player,
      schedule: clock.schedule,
    });

    let resolved = false;
    const speaking = tts.speak('One sentence.').then(() => {
      resolved = true;
    });

    await vi.waitFor(() => expect(clock.waits.length).toBe(1));
    expect(resolved).toBe(false); // the class must not advance over the tutor
    expect(clock.waits[0]).toBeGreaterThanOrEqual(pcmDurationMs(BASE64, 24_000));

    clock.flush();
    await speaking;
    expect(resolved).toBe(true);
  });

  it('retries a 500 once and succeeds', async () => {
    const { player, chunks } = fakePlayer();
    const onRetry = vi.fn();
    const replies = [httpError(500), audioReply()];
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(replies.shift() ?? audioReply()));

    const tts = createGeminiTts({
      apiKey: 'k',
      fetch,
      createPlayer: () => player,
      schedule: immediate,
      onRetry,
    });
    await tts.speak('Retry me.');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([BASE64]);
  });

  it('retries the documented text-instead-of-audio reply', async () => {
    const { player, chunks } = fakePlayer();
    const replies = [textReply(), audioReply()];
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(replies.shift() ?? audioReply()));

    const tts = createGeminiTts({ apiKey: 'k', fetch, createPlayer: () => player, schedule: immediate });
    await tts.speak('Say this properly.');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual([BASE64]);
  });

  it('gives up after a bounded number of attempts and still resolves speak()', async () => {
    const { player, chunks } = fakePlayer();
    const onError = vi.fn();
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(httpError(500)));

    const tts = createGeminiTts({
      apiKey: 'k',
      fetch,
      createPlayer: () => player,
      schedule: immediate,
      onError,
    });

    await expect(tts.speak('The class must go on.')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(chunks).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not retry a request the API rejected outright', async () => {
    const { player } = fakePlayer();
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(httpError(400)));

    const tts = createGeminiTts({ apiKey: 'k', fetch, createPlayer: () => player, schedule: immediate });
    await expect(tts.speak('Bad request.')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('speaks a permanently failed line through the fallback adapter', async () => {
    const { player } = fakePlayer();
    const fallback = recordingFallback();

    const tts = createGeminiTts({
      apiKey: 'k',
      fetch: () => Promise.reject(new Error('offline')),
      createPlayer: () => player,
      schedule: immediate,
      fallback: fallback.adapter,
    });
    await tts.speak('Say it somehow.');

    expect(fallback.spoken).toEqual(['Say it somehow.']);
  });

  it('refuses audio at a rate the player cannot render, rather than a chipmunk', async () => {
    const { player, chunks } = fakePlayer();
    const fallback = recordingFallback();

    const tts = createGeminiTts({
      apiKey: 'k',
      fetch: () => Promise.resolve(audioReply(BASE64, 'audio/l16; rate=16000; channels=1')),
      createPlayer: () => player,
      schedule: immediate,
      fallback: fallback.adapter,
    });
    await tts.speak('Wrong rate.');

    expect(chunks).toEqual([]);
    expect(fallback.spoken).toEqual(['Wrong rate.']);
  });

  it('resolves a pending speak() when cancelled', async () => {
    const { player } = fakePlayer();
    const tts = createGeminiTts({
      apiKey: 'k',
      fetch: () => new Promise<HttpResponse>(() => undefined), // never answers
      createPlayer: () => player,
      schedule: immediate,
    });

    const speaking = tts.speak('Hold on.');
    tts.cancel();
    await expect(speaking).resolves.toBeUndefined();
  });

  it('does not play audio that arrives after the cancel', async () => {
    const { player, chunks } = fakePlayer();
    let deliver: (reply: HttpResponse) => void = () => undefined;
    const tts = createGeminiTts({
      apiKey: 'k',
      fetch: () =>
        new Promise<HttpResponse>((resolve) => {
          deliver = resolve;
        }),
      createPlayer: () => player,
      schedule: immediate,
    });

    const speaking = tts.speak('A hand went up.');
    tts.cancel();
    await speaking;

    deliver(audioReply());
    await vi.waitFor(() => expect(chunks).toEqual([]));
  });

  it('cancels the fallback too, so nothing keeps talking after a raised hand', async () => {
    const { player } = fakePlayer();
    const fallback = recordingFallback();
    const tts = createGeminiTts({
      apiKey: 'k',
      fetch: () => Promise.resolve(audioReply()),
      createPlayer: () => player,
      schedule: immediate,
      fallback: fallback.adapter,
    });

    tts.cancel();
    expect(fallback.cancels()).toBe(1);
  });

  it('stops the audio the moment a hand goes up', async () => {
    const { player, stops } = fakePlayer();
    const tts = createGeminiTts({
      apiKey: 'k',
      fetch: () => Promise.resolve(audioReply()),
      createPlayer: () => player,
      schedule: immediate,
    });

    await tts.speak('Mid sentence.');
    tts.cancel();
    expect(stops()).toBe(1);
  });

  it('says nothing, and calls nothing, for an empty line', async () => {
    const { player, chunks } = fakePlayer();
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(audioReply()));

    const tts = createGeminiTts({ apiKey: 'k', fetch, createPlayer: () => player, schedule: immediate });
    await tts.speak('   ');

    expect(fetch).not.toHaveBeenCalled();
    expect(chunks).toEqual([]);
  });

  it('settles an earlier speak() when a new one starts', async () => {
    const { player } = fakePlayer();
    const tts = createGeminiTts({
      apiKey: 'k',
      fetch: () => new Promise<HttpResponse>(() => undefined),
      createPlayer: () => player,
      schedule: immediate,
    });

    const first = tts.speak('Beat one.');
    void tts.speak('Beat two.');
    await expect(first).resolves.toBeUndefined();
  });
});
