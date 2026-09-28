import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { toResponse } from '../src/web';
import { sendRelayResponse } from '../src/node';
import type { RelayResponse, UpstreamCall } from '../src/relays';

/**
 * A STREAMED CALL THAT FAILS CAN STILL BE ANSWERED.
 *
 * The relay never sees a streamed upstream's status — the host makes that
 * fetch — so the host is the only place that can notice OpenRouter said 402
 * (credits gone) or 503 (down) and use the answer the relay prepared for that
 * case instead. Both hosts, because `npm run dev` and the Edge Function must
 * behave the same or the thing tested every day is not the thing students hit.
 */

const wav: RelayResponse = {
  status: 200,
  headers: { 'content-type': 'audio/wav' },
  body: { kind: 'bytes', value: new Uint8Array([82, 73, 70, 70]) },
};

const streamed = (over: Partial<UpstreamCall> = {}): RelayResponse => ({
  status: 200,
  headers: {},
  body: {
    kind: 'stream',
    from: {
      url: 'https://openrouter.ai/api/v1/audio/speech',
      method: 'POST',
      headers: {},
      body: '{}',
      fallbackContentType: 'audio/mpeg',
      ...over,
    },
  },
});

const upstreamSays = (status: number, body = 'x') =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'audio/mpeg' } })));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the web host (the Edge Function)', () => {
  it('answers with the fallback when the upstream refuses — credits gone', async () => {
    upstreamSays(402, '{"error":"insufficient credits"}');
    const orElse = vi.fn(async () => wav);
    const res = await toResponse(streamed({ orElse }));

    expect(orElse).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([82, 73, 70, 70]);
  });

  it('answers with the fallback when the upstream cannot be reached at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const orElse = vi.fn(async () => wav);
    const res = await toResponse(streamed({ orElse }));
    expect(orElse).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it('streams the upstream and says it was served when it answers', async () => {
    upstreamSays(200, 'mp3-bytes');
    const orElse = vi.fn(async () => wav);
    const onServed = vi.fn();
    const res = await toResponse(streamed({ orElse, onServed }));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('mp3-bytes');
    expect(onServed).toHaveBeenCalledOnce();
    expect(orElse).not.toHaveBeenCalled();
  });

  it('keeps the old error when there is no fallback', async () => {
    upstreamSays(402, 'no credits');
    const res = await toResponse(streamed());
    expect(res.status).toBe(402);
  });

  it('does not say a failed upstream was served', async () => {
    upstreamSays(503);
    const onServed = vi.fn();
    await toResponse(streamed({ onServed, orElse: async () => wav }));
    expect(onServed).not.toHaveBeenCalled();
  });
});

const stub = () => {
  const headers: Record<string, string> = {};
  const sent: { statusCode: number; body?: unknown } = { statusCode: 0 };
  const res = {
    set statusCode(v: number) {
      sent.statusCode = v;
    },
    get statusCode() {
      return sent.statusCode;
    },
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    end(body?: unknown) {
      sent.body = body;
    },
  };
  return { res: res as unknown as ServerResponse, headers, sent };
};

describe('the node host (npm run dev)', () => {
  it('answers with the fallback when the upstream refuses', async () => {
    upstreamSays(402);
    const { res, headers, sent } = stub();
    await sendRelayResponse(res, streamed({ orElse: async () => wav }));

    expect(sent.statusCode).toBe(200);
    expect(headers['content-type']).toBe('audio/wav');
    expect([...(sent.body as Buffer)]).toEqual([82, 73, 70, 70]);
  });

  it('answers with the fallback when the upstream cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const { res, sent } = stub();
    await sendRelayResponse(res, streamed({ orElse: async () => wav }));
    expect(sent.statusCode).toBe(200);
  });
});

describe('a transformed stream (Vertex SSE in, PCM out)', () => {
  const upper = () =>
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        c.enqueue(new TextEncoder().encode(new TextDecoder().decode(chunk).toUpperCase()));
      },
    });

  it('the web host pipes the upstream through it and names the content type', async () => {
    upstreamSays(200, 'data: abc');
    const res = await toResponse(streamed({ transform: upper, contentType: 'audio/L16;rate=24000;channels=1' }));
    expect(res.headers.get('content-type')).toBe('audio/L16;rate=24000;channels=1');
    expect(await res.text()).toBe('DATA: ABC');
  });

  it('the node host does the same', async () => {
    upstreamSays(200, 'data: abc');
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    const res = new PassThrough() as unknown as ServerResponse & { statusCode: number };
    (res as unknown as { setHeader: (k: string, v: string) => void }).setHeader = (k, v) => {
      headers[k] = v;
    };
    const done = new Promise<void>((r) => (res as unknown as PassThrough).on('finish', () => r()));
    (res as unknown as PassThrough).on('data', (c: Buffer) => chunks.push(c));
    await sendRelayResponse(res, streamed({ transform: upper, contentType: 'audio/L16;rate=24000;channels=1' }));
    await done;
    expect(headers['content-type']).toBe('audio/L16;rate=24000;channels=1');
    expect(Buffer.concat(chunks).toString()).toBe('DATA: ABC');
  });
});
