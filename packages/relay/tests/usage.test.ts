import { describe, expect, it } from 'vitest';
import { handleRelay, type HandlerDeps } from '../src/handler';
import { createMemoryLedger, type Gate } from '../src/gate';
import {
  createMemoryUsage,
  createSupabaseUsage,
  usageFromHear,
  usageFromSpeech,
  usageFromVertex,
} from '../src/usage';
import type { RelayRequest } from '../src/relays';

/**
 * WHAT A CALL COST IS WRITTEN DOWN, AND NEVER IN THE WAY.
 *
 * The meter says "may this student make another call". This says what the
 * last one cost, in the units the provider bills - and the plan's Phase 2 will
 * not price a credit until that number is measured rather than guessed. Every
 * quantity was already in hand on every call; the relay was forwarding the
 * token counts to the browser and forgetting them.
 */

const req = (over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url: '/api/llm',
  headers: { authorization: 'Bearer good' },
  body: new Uint8Array(),
  ...over,
});

const gate = (): Gate => ({
  verify: async (h) =>
    h === 'Bearer good'
      ? { ok: true, user: { userId: 'student-1' } }
      : { ok: false, status: 401, why: 'no' },
  ledger: createMemoryLedger(),
});

const vertexReply = (usage: Record<string, number>, images = 0) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { text: 'ok' },
              ...Array.from({ length: images }, () => ({
                inlineData: { mimeType: 'image/png', data: 'AAAA' },
              })),
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: usage,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const json = (status: number, value: unknown) => ({
  status,
  headers: {},
  body: { kind: 'json' as const, value },
});

const deps = (usage = createMemoryUsage(), over: Partial<HandlerDeps> = {}) => ({
  usage,
  deps: {
    key: 'sk-test',
    gate: gate(),
    transcribe: async () => json(200, { text: 'hi' }),
    keep: async () => json(201, {}),
    usage,
    ...over,
  } satisfies HandlerDeps,
});

describe('deriving usage', () => {
  it('reads what Vertex measured, and counts pictures apart from tokens', () => {
    const e = usageFromVertex({ userId: 'u', sessionId: 's' }, 'gemini-3.7-flash', 200, {
      model: 'gemini-3.7-flash',
      choices: [
        {
          message: { role: 'assistant', content: '', images: [{ image_url: { url: 'x' } }] },
          finish_reason: 'stop',
        },
      ],
      usage: { promptTokenCount: 1200, candidatesTokenCount: 340, thoughtsTokenCount: 88, totalTokenCount: 1628 },
    });
    expect(e).toMatchObject({
      relay: 'llm',
      provider: 'vertex',
      promptTokens: 1200,
      outputTokens: 340,
      thoughtTokens: 88,
      images: 1,
    });
  });

  it('counts characters the way the voice is billed, not UTF-16 code units', () => {
    // A Hindi line with combining marks and an emoji; .length overcounts both.
    const text = 'नमस्ते 👋';
    const e = usageFromSpeech({ userId: 'u', sessionId: null }, 'deepgram/aura-2', text);
    expect(e.characters).toBe([...text].length);
    expect(e.characters).toBeLessThan(text.length);
  });

  it('records the audio it was handed, in bytes', () => {
    const e = usageFromHear({ userId: 'u', sessionId: null }, 'deepgram/nova-3', 200, new Uint8Array(64_000));
    expect(e.audioBytes).toBe(64_000);
  });
});

describe('the handler records every admitted call', () => {
  it('a Vertex completion, with its tokens and the session it belonged to', async () => {
    const { usage, deps: d } = deps(createMemoryUsage(), {
      vertex: {
        tokens: { token: async () => 't', projectId: 'p' },
        fetch: async () => vertexReply({ promptTokenCount: 10, candidatesTokenCount: 5 }),
      },
    });
    const body = new TextEncoder().encode(JSON.stringify({ model: 'gemini-3.7-flash', messages: [] }));
    const out = await handleRelay(
      req({ body, headers: { authorization: 'Bearer good', 'x-session-id': 'sess-9' } }),
      d,
    );
    expect(out.status).toBe(200);
    expect(usage.events).toHaveLength(1);
    expect(usage.events[0]).toMatchObject({
      userId: 'student-1',
      sessionId: 'sess-9',
      relay: 'llm',
      provider: 'vertex',
      model: 'gemini-3.7-flash',
      status: 200,
      promptTokens: 10,
      outputTokens: 5,
    });
  });

  it('a spoken line, with the session carried as a query parameter', async () => {
    // An <audio src> cannot send a header, so the session rides beside the ticket.
    const { usage, deps: d } = deps();
    const out = await handleRelay(
      req({ method: 'GET', url: '/api/speech?text=hello%20there&session=sess-3' }),
      d,
    );
    expect(out.status).toBe(200);
    expect(usage.events[0]).toMatchObject({ relay: 'speech', sessionId: 'sess-3', characters: 11 });
  });

  it('a transcription, with the bytes it was handed', async () => {
    const { usage, deps: d } = deps();
    await handleRelay(
      req({
        url: '/api/hear',
        body: new Uint8Array(3200),
        headers: { authorization: 'Bearer good', 'content-type': 'audio/wav' },
      }),
      d,
    );
    expect(usage.events[0]).toMatchObject({ relay: 'hear', audioBytes: 3200, status: 200, sessionId: null });
  });

  it('nothing at all when the call was refused before it cost anything', async () => {
    const { usage, deps: d } = deps();
    const out = await handleRelay(req({ headers: {} }), d);
    expect(out.status).toBe(401);
    expect(usage.events).toHaveLength(0);
  });

  it('works without a sink, which is what a host that has not wired one gets', async () => {
    const { deps: d } = deps();
    delete (d as Partial<HandlerDeps>).usage;
    const out = await handleRelay(req({ method: 'GET', url: '/api/speech?text=hi' }), d);
    expect(out.status).toBe(200);
  });
});

describe('a sink that fails', () => {
  it('never fails the call it describes', async () => {
    const broken = {
      record: async () => {
        throw new Error('accounting is down');
      },
    };
    const { deps: d } = deps(broken as unknown as ReturnType<typeof createMemoryUsage>);
    const out = await handleRelay(req({ method: 'GET', url: '/api/speech?text=hi' }), d);
    expect(out.status).toBe(200);
  });

  it('swallows a dead network in the Supabase sink', async () => {
    const sink = createSupabaseUsage('https://x', 'key', async () => {
      throw new Error('offline');
    });
    await expect(
      sink.record({ userId: 'u', sessionId: null, relay: 'llm', provider: 'vertex', model: 'm', status: 200 }),
    ).resolves.toBeUndefined();
  });

  it('posts to record_usage with the service role, nulls for what it does not know', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const sink = createSupabaseUsage('https://x', 'service-key', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response('null', { status: 200 });
    });
    await sink.record({
      userId: 'u',
      sessionId: 's',
      relay: 'speech',
      provider: 'openrouter',
      model: 'aura',
      status: 0,
      characters: 40,
    });
    expect(calls[0].url).toBe('https://x/rest/v1/rpc/record_usage');
    expect(calls[0].body).toMatchObject({
      p_user: 'u',
      p_session: 's',
      p_relay: 'speech',
      p_characters: 40,
      p_prompt_tokens: null,
      p_audio_bytes: null,
    });
  });
});
