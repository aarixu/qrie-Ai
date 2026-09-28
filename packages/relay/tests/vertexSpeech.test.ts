import { describe, expect, it } from 'vitest';
import { TUTOR } from '@ai-tutor/persona';
import { handleRelay, type HandlerDeps } from '../src/handler';
import { createMemoryLedger, type Gate } from '../src/gate';
import { createMemoryUsage } from '../src/usage';
import type { RelayRequest, RelayResponse } from '../src/relays';
import {
  VERTEX_SPEECH_MODEL,
  VERTEX_SPEECH_VOICE,
  pcmToWav,
  speakOnVertex,
} from '../src/vertexSpeech';

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
    expect(sent.contents[0].parts[0].text).toBe('Now substitute y.');
    expect(sent.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(VERTEX_SPEECH_VOICE);

    expect(out.status).toBe(200);
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

describe('the speech relay falls back to Vertex', () => {
  it('hands the host a Vertex answer to use if OpenRouter fails', async () => {
    const { usage, deps: d } = deps({ vertex: vertexDeps() });
    const out = await handleRelay(req(), d);

    const from = streamOf(out);
    expect(from.url).toContain('openrouter.ai');
    expect(from.orElse).toBeTypeOf('function');

    const instead = await from.orElse!();
    expect(instead.status).toBe(200);
    expect(instead.headers['content-type']).toBe('audio/wav');
    expect([...bytesOf(instead).slice(44)]).toEqual([7, 7]);
    expect(usage.events).toContainEqual(
      expect.objectContaining({
        relay: 'speech',
        provider: 'vertex',
        model: VERTEX_SPEECH_MODEL,
        status: 200,
        promptTokens: 19,
        outputTokens: 169,
        sessionId: 'sess-3',
      }),
    );
  });

  it('books the OpenRouter line only once the vendor actually served it', async () => {
    // Booked at dispatch, a line OpenRouter refused and Vertex then spoke would
    // be written down twice — and the ceiling would read high on exactly the
    // day the fallback is doing its job.
    const { usage, deps: d } = deps({ vertex: vertexDeps() });
    const from = streamOf(await handleRelay(req(), d));
    expect(usage.events.filter((e) => e.provider === 'openrouter')).toHaveLength(0);

    from.onServed!();
    expect(usage.events).toContainEqual(
      expect.objectContaining({ relay: 'speech', provider: 'openrouter', characters: 11, sessionId: 'sess-3' }),
    );
  });

  it('speaks on Vertex straight away when there is no OpenRouter key at all', async () => {
    const { deps: d } = deps({ key: '', vertex: vertexDeps() });
    const out = await handleRelay(req(), d);
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toBe('audio/wav');
  });

  it('changes nothing for a host with no Vertex', async () => {
    const { deps: d } = deps();
    const from = streamOf(await handleRelay(req(), d));
    expect(from.orElse).toBeUndefined();
  });

  it('still refuses an empty line rather than paying Vertex to say nothing', async () => {
    const { deps: d } = deps({ vertex: vertexDeps() });
    const out = await handleRelay(req({ url: '/api/speech?text=%20' }), d);
    expect(out.status).toBe(400);
  });
});
