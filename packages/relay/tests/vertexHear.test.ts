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
    // The instruction is the system instruction, with worked Roman examples,
    // and thinking is off: measured 2026-09-30 as what took the ear from a
    // 2.25 s median with Devanagari answers to 1.36 s with none.
    expect(body.systemInstruction.parts[0].text).toMatch(/Latin alphabet/);
    expect(body.systemInstruction.parts[0].text).toMatch(/NEVER output Devanagari/);
    expect(body.systemInstruction.parts[0].text).toContain('"pata nahi"');
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(body.contents[0].parts).toEqual([{ inlineData: { mimeType: 'audio/wav', data: 'AQID' } }]);
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

  it('spells out any Devanagari that still comes back, so the screen can read it', async () => {
    const out = await hearOnVertex(new Uint8Array([1]), 'audio/wav', {
      tokens,
      fetch: (async () => reply('हां समझ आ गया')) as unknown as typeof fetch,
    });
    expect(out.response.body).toEqual({ kind: 'json', value: { text: 'haan samajh aa gaya' } });
  });

  it('sends a second call when the first is slow, and uses whichever answers first', async () => {
    let calls = 0;
    const aborted: boolean[] = [];
    const out = await hearOnVertex(new Uint8Array([1]), 'audio/wav', {
      tokens,
      hedgeAfterMs: 20,
      fetch: (async (_url: string, init: RequestInit) => {
        const n = ++calls;
        init.signal?.addEventListener('abort', () => aborted.push(n === 1));
        // The first hangs until aborted; the second answers.
        if (n === 1) return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
        return reply('second');
      }) as unknown as typeof fetch,
    });
    expect(calls).toBe(2);
    expect(out.response.body).toEqual({ kind: 'json', value: { text: 'second' } });
    // The slow one is let go rather than waited on.
    expect(aborted).toContain(true);
  });

  it('makes one call only when the first answers in time', async () => {
    let calls = 0;
    await hearOnVertex(new Uint8Array([1]), 'audio/wav', {
      tokens,
      hedgeAfterMs: 50,
      fetch: (async () => {
        calls++;
        return reply('first');
      }) as unknown as typeof fetch,
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(calls).toBe(1);
  });

  it('retries at once after a failure a retry can fix, but not after one it cannot', async () => {
    const statuses: number[][] = [];
    for (const first of [503, 400]) {
      const seen: number[] = [];
      const out = await hearOnVertex(new Uint8Array([1]), 'audio/wav', {
        tokens,
        hedgeAfterMs: 10_000,
        fetch: (async () => {
          seen.push(seen.length + 1);
          return seen.length === 1 ? reply('', first) : reply('again');
        }) as unknown as typeof fetch,
      });
      statuses.push([seen.length, out.status]);
    }
    expect(statuses).toEqual([
      [2, 200],
      [1, 400],
    ]);
  });

  it('answers the last failure when both calls fail', async () => {
    const out = await hearOnVertex(new Uint8Array([1]), 'audio/wav', {
      tokens,
      fetch: (async () => reply('', 503)) as unknown as typeof fetch,
    });
    expect(out.status).toBe(503);
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
