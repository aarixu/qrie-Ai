import { describe, expect, it } from 'vitest';
import { TUTOR } from '@ai-tutor/persona';
import { handleRelay, type HandlerDeps } from '../src/handler';
import { MAX_SPEECH_CHARS } from '../src/speechInput';
import { createMemoryLedger, type Gate } from '../src/gate';
import { createMemoryUsage } from '../src/usage';
import type { RelayRequest, RelayResponse } from '../src/relays';
import {
  PCM_CONTENT_TYPE,
  VERTEX_SPEECH_FALLBACK_MODEL,
  VERTEX_SPEECH_MODEL,
  VERTEX_SPEECH_VOICE,
  pcmToWav,
  speakOnVertex,
  speechPrompt,
  sseToPcm,
  speechRequestBody,
  maxSpeechBytes,
  MAX_LINE_SECONDS,
} from '../src/vertexSpeech';
import { SPEECH_PREAMBLE, TRANSCRIPT_LABEL } from '@ai-tutor/voice';

/**
 * HER VOICE DOES NOT DIE WITH ONE VENDOR.
 *
 * Speech goes to Deepgram through OpenRouter, which is prepaid: the day its
 * credits run out, or it is down, every spoken line of every class fails and
 * the room falls to the browser's robot voice. Vertex is already paid for and
 * already trusted with the models, and Gemini speaks — so when the vendor
 * fails, the relay asks Vertex instead. Aarav, 2026-09-28.
 */

const tokens = { token: async () => 'tok', projectId: 'proj-1' };

/** The shape Vertex streams: SSE events, CRLF-separated, base64 PCM parts. */
const sse = (events: unknown[], sep = '\r\n\r\n') =>
  events.map((e) => `data: ${JSON.stringify(e)}`).join(sep) + sep;

const audioEvent = (pcm: Uint8Array) => ({
  candidates: [
    {
      content: {
        role: 'model',
        parts: [
          { inlineData: { mimeType: 'audio/l16; rate=24000; channels=1', data: Buffer.from(pcm).toString('base64') } },
        ],
      },
    },
  ],
});

const usageEvent = { usageMetadata: { promptTokenCount: 19, candidatesTokenCount: 169 } };

const vertexStream = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });

const bytesOf = (out: RelayResponse): Uint8Array => {
  if (out.body.kind !== 'bytes') throw new Error(`expected bytes, got ${out.body.kind}`);
  return out.body.value;
};

describe('pcmToWav', () => {
  it('wraps raw PCM in a header an <audio> element can play', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const wav = pcmToWav(pcm, { sampleRate: 24_000, channels: 1, bitsPerSample: 16 });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const text = (at: number) => new TextDecoder().decode(wav.slice(at, at + 4));

    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    expect(text(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength);
    expect(text(8)).toBe('WAVE');
    expect(text(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // channels
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(28, true)).toBe(48_000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
    expect([...wav.slice(44)]).toEqual([...pcm]);
  });
});

describe('speakOnVertex', () => {
  it('asks Vertex for the tutor voice, streamed, and answers one playable WAV', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const out = await speakOnVertex('Now substitute y.', {
      tokens,
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return vertexStream(sse([audioEvent(new Uint8Array([1, 2])), audioEvent(new Uint8Array([3, 4])), usageEvent]));
      }) as typeof fetch,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global' +
        `/publishers/google/models/${VERTEX_SPEECH_MODEL}:streamGenerateContent?alt=sse`,
    );
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const sent = JSON.parse(String(seen[0].init.body));
    // 3.8 takes the transcript as the text and nothing else: a director's note in
    // the text would be read aloud. The delivery rides in `speech_metadata`.
    expect(sent.contents[0].parts[0].text).toBe('Now substitute y.');
    expect(sent.contents[0].parts[0].speech_metadata.style).toContain('Meera');
    expect(sent.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(sent.generationConfig.speechConfig.voiceConfig.voice).toBe(VERTEX_SPEECH_VOICE);
    expect(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig).toBeUndefined();

    expect(out.status).toBe(200);
    expect(out.model).toBe(VERTEX_SPEECH_MODEL);
    expect(out.response.headers['content-type']).toBe('audio/wav');
    const wav = bytesOf(out.response);
    expect([...wav.slice(44)]).toEqual([1, 2, 3, 4]);
    expect(out.promptTokens).toBe(19);
    expect(out.outputTokens).toBe(169);
  });

  it('reads events separated by plain LF as well as CRLF', async () => {
    const out = await speakOnVertex('hi', {
      tokens,
      fetch: (async () => vertexStream(sse([audioEvent(new Uint8Array([9, 9]))], '\n\n'))) as unknown as typeof fetch,
    });
    expect([...bytesOf(out.response).slice(44)]).toEqual([9, 9]);
  });

  it('passes a Vertex refusal through as an error the browser already reads', async () => {
    const out = await speakOnVertex('hi', {
      tokens,
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })) as unknown as typeof fetch,
    });
    expect(out.status).toBe(429);
    expect(out.response.status).toBe(429);
    expect(out.response.body.kind).toBe('json');
  });

  it('calls a 200 with no audio in it a failure, not silence', async () => {
    // Google documents the TTS model sometimes answering with text instead of
    // audio. An empty WAV would play as nothing and look like success.
    const out = await speakOnVertex('hi', {
      tokens,
      fetch: (async () => vertexStream(sse([usageEvent]))) as unknown as typeof fetch,
    });
    expect(out.status).toBe(502);
    expect(out.response.body.kind).toBe('json');
  });

  it('answers 502 when the Google credential cannot be minted', async () => {
    const out = await speakOnVertex('hi', {
      tokens: { token: async () => Promise.reject(new Error('bad key')), projectId: 'p' },
    });
    expect(out.status).toBe(502);
  });

  it('answers 502 when the network itself fails', async () => {
    const out = await speakOnVertex('hi', {
      tokens,
      fetch: (async () => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
    });
    expect(out.status).toBe(502);
  });

  it('speaks in the persona voice, so a fallback line is still Meera', () => {
    expect(VERTEX_SPEECH_VOICE).toBe(TUTOR.speechVoiceName);
  });
});

/**
 * THE VOICE MOVED TO GEMINI 3.8 FLASH-LITE (Aarav, 2026-10-07), WITH 3.1 UNDERNEATH.
 *
 * Measured the same day on 21 tutor lines per model: 3.1 Flash TTS Rs 2.83 a
 * minute of speech, 3.8 Flash Rs 1.20, 3.8 Flash-Lite Rs 0.81 (25 audio tokens a
 * second on all three), and 3.8 Flash-Lite streams the same bare 24 kHz PCM, the
 * first chunk landing about 1.1 s after the request. 3.8 is a PREVIEW model, so a
 * line it cannot speak is spoken by 3.1 rather than falling to the browser's
 * robot voice, and the booking names the model that really spoke it.
 */
describe('the voice model: 3.8 Flash-Lite, with 3.1 underneath', () => {
  const stream3 = (pcm = new Uint8Array([5, 5])) => vertexStream(sse([audioEvent(pcm), usageEvent]));
  const refuses = (status: number) => new Response(JSON.stringify({ error: { message: 'model unavailable' } }), { status });
  const modelOf = (url: string) => (url.includes(VERTEX_SPEECH_FALLBACK_MODEL) ? 'fallback' : url.includes(VERTEX_SPEECH_MODEL) ? 'primary' : '?');

  it('names the models', () => {
    expect(VERTEX_SPEECH_MODEL).toBe('gemini-3.8-flash-lite-tts');
    expect(VERTEX_SPEECH_FALLBACK_MODEL).toBe('gemini-3.1-flash-tts-preview');
  });

  it('puts the delivery in speech_metadata, the same words Aarav heard when he chose this model', () => {
    const hi = JSON.parse(speechRequestBody('Chalo, heart ko dekhte hain.', 'hi-en')).contents[0].parts[0];
    expect(hi.text).toBe('Chalo, heart ko dekhte hain.');
    expect(hi.speech_metadata.style).toMatch(/normal conversational pace/i);
    expect(hi.speech_metadata.style).toContain('Hinglish');
    expect(hi.speech_metadata.style).toContain('Delhi schoolteacher English');
    // One style for both languages: it is exactly what tools/voice-probe/tts-compare-samples.mjs
    // rendered for the clips he listened to, and no other wording has been heard.
    const en = JSON.parse(speechRequestBody('Let us look at the heart.', 'en')).contents[0].parts[0];
    expect(en.speech_metadata.style).toBe(hi.speech_metadata.style);
    // Never a director's note inside the transcript, which 3.8 would read aloud.
    expect(en.text).toBe('Let us look at the heart.');
    expect(en.text).not.toContain(SPEECH_PREAMBLE);
  });

  it('still builds the 3.1 request for the fallback: its prompt in the text, its voice field', () => {
    const sent = JSON.parse(speechRequestBody('Hi.', 'en', VERTEX_SPEECH_FALLBACK_MODEL));
    expect(sent.contents[0].parts[0].text.startsWith(SPEECH_PREAMBLE)).toBe(true);
    expect(sent.contents[0].parts[0].speech_metadata).toBeUndefined();
    expect(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(VERTEX_SPEECH_VOICE);
    expect(sent.generationConfig.maxOutputTokens).toBeUndefined();
  });

  it('speaks on 3.8 and calls nothing else when 3.8 answers', async () => {
    const urls: string[] = [];
    const out = await speakOnVertex('hi', {
      tokens,
      fetch: (async (url: string) => (urls.push(url), stream3())) as unknown as typeof fetch,
    });
    expect(urls.map(modelOf)).toEqual(['primary']);
    expect(out.status).toBe(200);
    expect(out.model).toBe(VERTEX_SPEECH_MODEL);
  });

  it.each([404, 429, 500, 503])('speaks the line on 3.1 when 3.8 answers %i, so the room never falls silent', async (status) => {
    const calls: { which: string; body: string }[] = [];
    const out = await speakOnVertex('Now substitute y.', {
      tokens,
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ which: modelOf(url), body: String(init.body) });
        return modelOf(url) === 'primary' ? refuses(status) : stream3(new Uint8Array([8, 8]));
      }) as unknown as typeof fetch,
    });
    expect(calls.map((c) => c.which)).toEqual(['primary', 'fallback']);
    // The second request is the 3.1 shape, not the 3.8 one it would misread.
    const sent = JSON.parse(calls[1].body);
    expect(sent.contents[0].parts[0].text.startsWith(SPEECH_PREAMBLE)).toBe(true);
    expect(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(VERTEX_SPEECH_VOICE);
    expect(out.status).toBe(200);
    expect(out.model).toBe(VERTEX_SPEECH_FALLBACK_MODEL);
    expect([...bytesOf(out.response).slice(44)]).toEqual([8, 8]);
  });

  it('speaks on 3.1 too when 3.8 answers 200 with no audio in it', async () => {
    const calls: string[] = [];
    const out = await speakOnVertex('hi', {
      tokens,
      fetch: (async (url: string) => (calls.push(modelOf(url)), modelOf(url) === 'primary' ? vertexStream(sse([{ candidates: [] }])) : stream3())) as unknown as typeof fetch,
    });
    expect(calls).toEqual(['primary', 'fallback']);
    expect(out.status).toBe(200);
    expect(out.model).toBe(VERTEX_SPEECH_FALLBACK_MODEL);
  });

  it('does not fall back after 3.8 already billed audio, which would book the line twice', async () => {
    let pulls = 0;
    const calls: string[] = [];
    const out = await speakOnVertex(
      'Hello there, class.',
      {
        tokens,
        fetch: (async (url: string) => {
          calls.push(modelOf(url));
          pulls = 0;
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(c) {
                pulls += 1;
                if (pulls === 1) c.enqueue(new TextEncoder().encode(sse([audioEvent(new Uint8Array(48_000).fill(1))])));
                else c.error(new DOMException('timed out', 'TimeoutError'));
              },
            }),
            { status: 200 },
          );
        }) as unknown as typeof fetch,
      },
      { format: 'pcm' },
    );
    expect(calls).toEqual(['primary']);
    expect(out.status).toBe(502);
    expect(out.model).toBe(VERTEX_SPEECH_MODEL);
  });

  it('answers with the last refusal when both models refuse', async () => {
    const calls: string[] = [];
    const out = await speakOnVertex('hi', {
      tokens,
      fetch: (async (url: string) => (calls.push(modelOf(url)), refuses(modelOf(url) === 'primary' ? 404 : 503))) as unknown as typeof fetch,
    });
    expect(calls).toEqual(['primary', 'fallback']);
    expect(out.status).toBe(503);
    expect(out.model).toBe(VERTEX_SPEECH_FALLBACK_MODEL);
  });

  it('does not retry when the Google credential itself cannot be minted', async () => {
    const out = await speakOnVertex('hi', { tokens: { token: async () => Promise.reject(new Error('bad key')), projectId: 'p' } });
    expect(out.status).toBe(502);
  });

  it('lets a caller force one model, with no fallback (the listening tools)', async () => {
    const calls: string[] = [];
    const out = await speakOnVertex(
      'hi',
      { tokens, fetch: (async (url: string) => (calls.push(modelOf(url)), refuses(503))) as unknown as typeof fetch },
      { model: VERTEX_SPEECH_FALLBACK_MODEL },
    );
    expect(calls).toEqual(['fallback']);
    expect(out.model).toBe(VERTEX_SPEECH_FALLBACK_MODEL);
  });

  it('books a collected line under the model that really spoke it', async () => {
    const usage = createMemoryUsage();
    const { deps: d } = deps({
      usage,
      vertex: {
        tokens,
        fetch: (async (url: string) => (modelOf(url) === 'primary' ? refuses(503) : stream3())) as unknown as typeof fetch,
      },
    });
    const out = await handleRelay(req(), d);
    expect(out.status).toBe(200);
    expect(usage.events).toContainEqual(expect.objectContaining({ relay: 'speech', provider: 'vertex', model: VERTEX_SPEECH_FALLBACK_MODEL, status: 200 }));
    expect(usage.events.filter((e) => e.model === VERTEX_SPEECH_MODEL && e.status === 200)).toHaveLength(0);
  });
});

// ------------------------------------------------------ in the handler ----

const req = (over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'GET',
  url: '/api/speech?text=hello%20there&session=sess-3',
  headers: { authorization: 'Bearer good' },
  body: new Uint8Array(),
  ...over,
});

const gate = (): Gate => ({
  verify: async (h) =>
    h === 'Bearer good' ? { ok: true, user: { userId: 'student-1' } } : { ok: false, status: 401, why: 'no' },
  ledger: createMemoryLedger(),
});

const json = (status: number, value: unknown) => ({ status, headers: {}, body: { kind: 'json' as const, value } });

const vertexDeps = () => ({
  tokens,
  fetch: (async () => vertexStream(sse([audioEvent(new Uint8Array([7, 7])), usageEvent]))) as unknown as typeof fetch,
});

const deps = (over: Partial<HandlerDeps> = {}) => {
  const usage = createMemoryUsage();
  return {
    usage,
    deps: {
      key: 'sk-test',
      gate: gate(),
      transcribe: async () => json(200, { text: 'hi' }),
      keep: async () => json(201, {}),
      usage,
      ...over,
    } satisfies HandlerDeps,
  };
};

const streamOf = (out: RelayResponse) => {
  if (out.body.kind !== 'stream') throw new Error(`expected a stream, got ${out.body.kind}`);
  return out.body.from;
};

describe('the speech relay speaks on Vertex (Aarav, 2026-09-28: no OpenRouter for speech)', () => {
  it('streams raw PCM from Vertex when the app asks for format=pcm', async () => {
    const { usage, deps: d } = deps({ vertex: vertexDeps() });
    const out = await handleRelay(req({ url: '/api/speech?text=hello%20there&session=sess-3&format=pcm&lang=hi-en' }), d);

    const from = streamOf(out);
    expect(from.url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global' +
        `/publishers/google/models/${VERTEX_SPEECH_MODEL}:streamGenerateContent?alt=sse`,
    );
    expect(from.url).not.toContain('openrouter');
    expect(from.headers.authorization).toBe('Bearer tok');
    expect(from.contentType).toBe(PCM_CONTENT_TYPE);
    const sent = JSON.parse(String(from.body));
    expect(sent.contents[0].parts[0].text).toBe('hello there');
    expect(sent.contents[0].parts[0].speech_metadata.style).toContain('Hinglish');

    // The host pipes Vertex's SSE through the transform; its flush books usage.
    const pcm = await pipe(sse([audioEvent(new Uint8Array([1, 2, 3, 4])), usageEvent]), from.transform!());
    expect([...pcm]).toEqual([1, 2, 3, 4]);
    expect(usage.events).toContainEqual(
      expect.objectContaining({ relay: 'speech', provider: 'vertex', model: VERTEX_SPEECH_MODEL, outputTokens: 169, sessionId: 'sess-3' }),
    );
    expect(usage.events.filter((e) => e.provider === 'openrouter')).toHaveLength(0);
  });

  it('retries once, collected, if the Vertex stream refuses to start', async () => {
    const { deps: d } = deps({ vertex: vertexDeps() });
    const from = streamOf(await handleRelay(req({ url: '/api/speech?text=hi&format=pcm' }), d));
    const instead = await from.orElse!();
    expect(instead.status).toBe(200);
    expect(instead.headers['content-type']).toBe(PCM_CONTENT_TYPE);
    expect([...bytesOf(instead)]).toEqual([7, 7]);
  });

  it('answers an old <audio> client with a whole WAV from Vertex, never OpenRouter', async () => {
    const { usage, deps: d } = deps({ vertex: vertexDeps() });
    const out = await handleRelay(req(), d);
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toBe('audio/wav');
    expect([...bytesOf(out).slice(44)]).toEqual([7, 7]);
    expect(usage.events).toContainEqual(expect.objectContaining({ provider: 'vertex', status: 200, sessionId: 'sess-3' }));
  });

  it('speaks on Vertex even when there is no OpenRouter key at all', async () => {
    const { deps: d } = deps({ key: '', vertex: vertexDeps() });
    const out = await handleRelay(req(), d);
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toBe('audio/wav');
  });

  it('keeps the OpenRouter voice only for a host with no Vertex (a laptop without the service account)', async () => {
    const { usage, deps: d } = deps();
    const from = streamOf(await handleRelay(req(), d));
    expect(from.url).toContain('openrouter.ai');
    from.onServed!();
    expect(usage.events).toContainEqual(expect.objectContaining({ provider: 'openrouter', characters: 11 }));
  });

  it('still refuses an empty line rather than paying Vertex to say nothing', async () => {
    const { deps: d } = deps({ vertex: vertexDeps() });
    const out = await handleRelay(req({ url: '/api/speech?text=%20&format=pcm' }), d);
    expect(out.status).toBe(400);
  });
});

// ------------------------------------------------ the stream transform ----

/** Feed text through a transform in awkward pieces, return every byte out. */
async function pipe(text: string, transform: TransformStream<Uint8Array, Uint8Array>, cut = 7): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += cut) c.enqueue(bytes.slice(i, i + cut));
      c.close();
    },
  });
  const out: number[] = [];
  const reader = source.pipeThrough(transform).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(...value);
  }
  return new Uint8Array(out);
}

describe('sseToPcm', () => {
  it('turns Vertex SSE into raw PCM however the network cuts it', async () => {
    const pcm = new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256));
    const text = sse([audioEvent(pcm.slice(0, 101)), audioEvent(pcm.slice(101)), usageEvent]);
    for (const cut of [1, 3, 7, 64, 4096]) {
      const out = await pipe(text, sseToPcm(), cut);
      expect([...out]).toEqual([...pcm]);
    }
  });

  it('never emits half a sample, so the player never plays static', async () => {
    const reads: number[] = [];
    const t = sseToPcm();
    const text = sse([audioEvent(new Uint8Array([1, 2, 3])), audioEvent(new Uint8Array([4, 5, 6]))], String.fromCharCode(10, 10));
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    });
    const reader = source.pipeThrough(t).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      reads.push(value.byteLength);
    }
    expect(reads.every((n) => n % 2 === 0)).toBe(true);
    expect(reads.reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('reports what Vertex billed when the stream ends', async () => {
    let seen: { promptTokens?: number; outputTokens?: number; audioBytes: number } | null = null;
    await pipe(sse([audioEvent(new Uint8Array([1, 2])), usageEvent]), sseToPcm((u) => (seen = u)));
    expect(seen).toEqual({ promptTokens: 19, outputTokens: 169, audioBytes: 2 });
  });
});

describe('speechPrompt', () => {
  it('uses the shape the recorded class uses, so the live voice is the same teacher', () => {
    const p = speechPrompt('Chalo, heart ko dekhte hain.', 'hi-en');
    expect(p.startsWith(SPEECH_PREAMBLE)).toBe(true);
    expect(p).toContain(TRANSCRIPT_LABEL);
    expect(p.trimEnd().endsWith('Chalo, heart ko dekhte hain.')).toBe(true);
    expect(p).toContain('Hinglish');
  });

  it('asks for Indian English when the class is in English', () => {
    const p = speechPrompt('Let us look at the heart.', 'en');
    expect(p).toContain('Indian English');
    expect(p).not.toContain('Hinglish');
  });

  it('asks for a normal classroom pace, not a slow and soothing one (Aarav, 2026-10-02)', () => {
    // The old notes ("no hurry", "unhurried", "a vocal smile") made one English
    // line 10.7 s; these made it 8.5 s, about 150 words a minute.
    const p = speechPrompt('Let us look at the heart.', 'en');
    expect(p).toMatch(/normal conversational pace/i);
    expect(p).not.toMatch(/hurry|unhurried|vocal smile|warm/i);
  });
});

// ---------------------------------------- overnight review #1, #2, #4 ----

describe('speech a child never has to put in a URL (#2)', () => {
  const post = (body: unknown, headers: Record<string, string> = {}): RelayRequest => ({
    method: 'POST',
    url: '/api/speech',
    headers: { authorization: 'Bearer good', 'content-type': 'application/json', 'x-session-id': 'sess-9', ...headers },
    body: new TextEncoder().encode(JSON.stringify(body)),
  });

  it('takes the line, its language and the format from a POST body', async () => {
    const { usage, deps: d } = deps({ vertex: vertexDeps() });
    const from = streamOf(await handleRelay(post({ text: 'Hi Ishaan!', lang: 'hi-en', format: 'pcm' }), d));
    const sent = JSON.parse(String(from.body));
    expect(sent.contents[0].parts[0].text).toBe('Hi Ishaan!');
    expect(sent.contents[0].parts[0].speech_metadata.style).toContain('Hinglish');
    await pipe(sse([audioEvent(new Uint8Array([1, 2])), usageEvent]), from.transform!());
    // The session comes from the header, as on every other relay.
    expect(usage.events).toContainEqual(expect.objectContaining({ relay: 'speech', sessionId: 'sess-9' }));
  });

  it('refuses a line too long for one breath before the meter is touched', async () => {
    const charged: number[] = [];
    const { deps: d } = deps({
      vertex: vertexDeps(),
      gate: { ...gate(), ledger: { claim: async (_u, _r, units) => (charged.push(units), { allowed: true }) } },
    });
    const out = await handleRelay(post({ text: 'a'.repeat(MAX_SPEECH_CHARS + 1), format: 'pcm' }), d);
    expect(out.status).toBe(413);
    expect(charged).toEqual([]);
  });

  it('refuses a body that is not the line it claims to be', async () => {
    const { deps: d } = deps({ vertex: vertexDeps() });
    expect((await handleRelay(post('just a string'), d)).status).toBe(400);
    expect((await handleRelay({ ...post({}), body: new TextEncoder().encode('{nope') }, d)).status).toBe(400);
  });
});

describe('what one line may cost (#1)', () => {
  it('never sends maxOutputTokens, which the TTS model refuses with a 400', () => {
    const sent = JSON.parse(speechRequestBody('Hi.', 'en'));
    expect(sent.generationConfig.maxOutputTokens).toBeUndefined();
  });

  it('gives a line audio in proportion to its words, with a floor', () => {
    expect(maxSpeechBytes('Hi.')).toBe(4 * 48_000);
    expect(maxSpeechBytes('a'.repeat(600))).toBe(120 * 48_000);
  });

  it('never allows one line more than two minutes of audio (fifth review)', () => {
    expect(maxSpeechBytes('9'.repeat(2000))).toBe(MAX_LINE_SECONDS * 48_000);
  });

  it('books the audio a stream sent before it failed part-way, and answers 502 so the whole line is said', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls += 1;
        if (pulls === 1) c.enqueue(new TextEncoder().encode(sse([audioEvent(new Uint8Array(48_000).fill(1))])));
        else c.error(new DOMException('timed out', 'TimeoutError'));
      },
    });
    const out = await speakOnVertex(
      'Hello there, class.',
      { tokens, fetch: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch },
      { format: 'pcm' },
    );
    expect(out.status).toBe(502);
    // One second of audio at 25 audio tokens a second (measured 2026-10-07: 25.0 on 3.1, 24.2 on 3.8 Flash, 24.3 on 3.8 Flash-Lite).
    expect(out.outputTokens).toBe(25);
  });

  it('gives a digit the time its spoken words take (third review #11)', () => {
    // "So 15% of 240 is 36." needs about 4 s; it used to get 3.3 s.
    expect(maxSpeechBytes('So 15% of 240 is 36.')).toBeGreaterThanOrEqual(6 * 48_000);
  });

  it('caps the collected path too, and estimates the tokens a cut line never reported (#7)', async () => {
    const big = new Uint8Array(4 * 48_000 + 1000).fill(1);
    const out = await speakOnVertex(
      'Hi.',
      { tokens, fetch: (async () => vertexStream(sse([audioEvent(big)]))) as unknown as typeof fetch },
      { format: 'pcm' },
    );
    expect(out.status).toBe(200);
    expect(bytesOf(out.response).byteLength).toBe(4 * 48_000);
    expect(out.outputTokens).toBe(Math.round(((4 * 48_000 + 1000) / 48_000) * 25));
  });

  it('ends the stream, in whole samples, once a line has carried its budget, and books it once', async () => {
    const seen: { audioBytes: number }[] = [];
    const out = await pipe(
      sse([audioEvent(new Uint8Array([1, 2, 3, 4])), audioEvent(new Uint8Array([5, 6, 7, 8])), audioEvent(new Uint8Array([9, 9])), usageEvent]),
      sseToPcm((u) => seen.push(u), { maxAudioBytes: 7 }),
    );
    expect([...out]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen).toEqual([expect.objectContaining({ audioBytes: 6 })]);
  });
});

describe('a stream the browser walks away from is still booked (#4/#18/#37)', () => {
  it('books what was sent when the reader cancels, once', async () => {
    const seen: { audioBytes: number }[] = [];
    const t = sseToPcm((u) => seen.push(u));
    const writer = t.writable.getWriter();
    const reader = t.readable.getReader();
    void writer.write(new TextEncoder().encode(sse([audioEvent(new Uint8Array([1, 2, 3, 4]))])));
    await reader.read();
    await reader.cancel('the student moved on');
    await writer.close().catch(() => undefined);
    expect(seen).toEqual([expect.objectContaining({ audioBytes: 4 })]);
  });

  it('books once when the stream simply ends', async () => {
    const seen: unknown[] = [];
    await pipe(sse([audioEvent(new Uint8Array([1, 2])), usageEvent]), sseToPcm((u) => seen.push(u)));
    expect(seen).toHaveLength(1);
  });
});
