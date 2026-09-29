import { describe, expect, it } from 'vitest';
import { handleRelay, type HandlerDeps } from '../src/handler';
import { createMemoryLedger, type Gate } from '../src/gate';
import { createMemoryUsage } from '../src/usage';
import type { RelayRequest } from '../src/relays';
import { VERTEX_HEAR_MODEL, hearOnVertex } from '../src/vertexHear';

/**
 * HER EAR ON VERTEX (Aarav, 2026-09-28: no OpenRouter/Deepgram).
 *
 * Measured 2026-09-29 on three TTS-made answers: gemini-3.1-flash-lite gave
 * back the Hinglish exactly, in Roman script, in 1.7-2.4 s — faster than
 * 3.7-flash (2.3-4.6 s). Roman script matters beyond reading: the distress
 * screen's word lists are Latin-script, and a Devanagari transcript would
 * slip past them.
 */

const tokens = { token: async () => 'tok', projectId: 'proj-1' };

const reply = (text: string, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 259, candidatesTokenCount: 19 } }
        : { error: { message: 'quota' } },
    ),
    { status, headers: { 'content-type': 'application/json' } },
  );

describe('hearOnVertex', () => {
  it('sends the audio to the fast model with an exact-transcript instruction', async () => {
    const seen: { url: string; body: string }[] = [];
    const out = await hearOnVertex(new Uint8Array([1, 2, 3]), 'audio/wav', {
      tokens,
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, body: String(init.body) });
        return reply('Mujhe lagta hai ki kidney blood filter karti hai.');
      }) as typeof fetch,
    });
    expect(seen[0].url).toContain(`/models/${VERTEX_HEAR_MODEL}:generateContent`);
    const body = JSON.parse(seen[0].body);
    const parts = body.contents[0].parts;
    expect(parts[0].text).toMatch(/Roman script/);
    expect(parts[0].text).toMatch(/never in Devanagari/);
    expect(parts[1].inlineData).toEqual({ mimeType: 'audio/wav', data: 'AQID' });
    expect(out.status).toBe(200);
    expect(out.response.body).toEqual({ kind: 'json', value: { text: 'Mujhe lagta hai ki kidney blood filter karti hai.' } });
    expect(out.promptTokens).toBe(259);
    expect(out.outputTokens).toBe(19);
  });

  it('strips quotes a model wraps a transcript in', async () => {
    const out = await hearOnVertex(new Uint8Array([1]), 'audio/wav', {
      tokens,
      fetch: (async () => reply('"haan, samajh gaya"')) as unknown as typeof fetch,
    });
    expect(out.response.body).toEqual({ kind: 'json', value: { text: 'haan, samajh gaya' } });
  });

  it('passes a refusal through with its status, never a made-up transcript', async () => {
    const out = await hearOnVertex(new Uint8Array([1]), 'audio/wav', {
      tokens,
      fetch: (async () => reply('', 429)) as unknown as typeof fetch,
    });
    expect(out.status).toBe(429);
  });

  it('answers 502 when the credential cannot be minted', async () => {
    const out = await hearOnVertex(new Uint8Array([1]), 'audio/wav', {
      tokens: { token: async () => Promise.reject(new Error('bad')), projectId: 'p' },
    });
    expect(out.status).toBe(502);
  });
});

const gate = (): Gate => ({
  verify: async (h) =>
    h === 'Bearer good' ? { ok: true, user: { userId: 'student-1' } } : { ok: false, status: 401, why: 'no' },
  ledger: createMemoryLedger(),
});

const req = (over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url: '/api/hear',
  headers: { authorization: 'Bearer good', 'content-type': 'audio/wav', 'x-session-id': 'sess-5' },
  body: new Uint8Array(3200),
  ...over,
});

const deps = (over: Partial<HandlerDeps> = {}) => {
  const usage = createMemoryUsage();
  const openRouterCalls: number[] = [];
  return {
    usage,
    openRouterCalls,
    deps: {
      key: 'sk-test',
      gate: gate(),
      transcribe: async () => {
        openRouterCalls.push(1);
        return { status: 200, headers: {}, body: { kind: 'json' as const, value: { text: 'from openrouter' } } };
      },
      keep: async () => ({ status: 201, headers: {}, body: { kind: 'json' as const, value: {} } }),
      usage,
      ...over,
    } satisfies HandlerDeps,
  };
};

describe('the hear relay with Vertex configured', () => {
  it('transcribes on Vertex and never calls OpenRouter', async () => {
    const d = deps({ vertex: { tokens, fetch: (async () => reply('haan')) as unknown as typeof fetch } });
    const out = await handleRelay(req(), d.deps);
    expect(out.body).toEqual({ kind: 'json', value: { text: 'haan' } });
    expect(d.openRouterCalls).toHaveLength(0);
    // Priced by its tokens; bytes on the row would read as unpriced (#36).
    expect(d.usage.events.find((e) => e.relay === 'hear')?.audioBytes).toBeUndefined();
    expect(d.usage.events).toContainEqual(
      expect.objectContaining({ relay: 'hear', provider: 'vertex', model: VERTEX_HEAR_MODEL, status: 200, sessionId: 'sess-5' }),
    );
  });

  it('works with no OpenRouter key at all', async () => {
    const d = deps({ key: '', vertex: { tokens, fetch: (async () => reply('haan')) as unknown as typeof fetch } });
    const out = await handleRelay(req(), d.deps);
    expect(out.status).toBe(200);
  });

  it('keeps every guard the old ear had: POST only, wav only, not empty', async () => {
    const d = deps({ vertex: { tokens, fetch: (async () => reply('x')) as unknown as typeof fetch } });
    expect((await handleRelay(req({ body: new Uint8Array() }), d.deps)).status).toBe(400);
    expect((await handleRelay(req({ headers: { authorization: 'Bearer good', 'content-type': 'audio/ogg' } }), d.deps)).status).toBe(415);
  });

  it('still uses OpenRouter on a laptop with no service account', async () => {
    const d = deps();
    const out = await handleRelay(req(), d.deps);
    expect(out.body).toEqual({ kind: 'json', value: { text: 'from openrouter' } });
  });
});
