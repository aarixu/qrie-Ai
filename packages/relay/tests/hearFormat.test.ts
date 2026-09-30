import { describe, expect, it } from 'vitest';
import { handleRelay, type HandlerDeps } from '../src/handler';
import { UNITS, createMemoryLedger, unitsFor, type Gate, type Ledger } from '../src/gate';
import { COMPRESSED_HEAR_SECONDS, MAX_COMPRESSED_HEAR_BYTES, hearFormat, heardSeconds } from '../src/hearFormat';
import { hearRelay, type RelayRequest } from '../src/relays';

/**
 * COMPRESSED ANSWERS (2026-09-30): a 3-4 s answer is 105-136 KB as WAV and
 * 10-13 KB as Opus, and Vertex hears both alike. Taken only where Vertex is
 * the ear, charged at the door as the longest answer the ear sends, and
 * topped up from Vertex's own count.
 */

const tokens = { token: async () => 'tok', projectId: 'proj-1' };
const reply = (text: string, promptTokenCount: number) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount, candidatesTokenCount: 9 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const req = (over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url: '/api/hear',
  headers: { authorization: 'Bearer good', 'content-type': 'audio/webm;codecs=opus', 'x-session-id': 's-1' },
  body: new Uint8Array(12_000),
  ...over,
});

function spyLedger(): Ledger & { claims: { relay: string; units: number }[] } {
  const inner = createMemoryLedger();
  const claims: { relay: string; units: number }[] = [];
  return {
    claims,
    claim: async (userId, relay, units) => {
      claims.push({ relay, units });
      return inner.claim(userId, relay, units);
    },
  };
}

const depsWith = (ledger: Ledger, promptTokens: number): HandlerDeps => ({
  key: '',
  gate: {
    verify: async (h) => (h === 'Bearer good' ? { ok: true, user: { userId: 'student-1' } } : { ok: false, status: 401, why: 'no' }),
    ledger,
  } satisfies Gate,
  transcribe: async () => ({ status: 500, headers: {}, body: { kind: 'json' as const, value: {} } }),
  keep: async () => ({ status: 201, headers: {}, body: { kind: 'json' as const, value: {} } }),
  vertex: { tokens, fetch: (async () => reply('haan', promptTokens)) as unknown as typeof fetch },
});

describe('hearFormat', () => {
  it('knows raw PCM from compressed, and refuses anything else', () => {
    expect(hearFormat('audio/wav')).toBe('pcm');
    expect(hearFormat('audio/x-wav')).toBe('pcm');
    expect(hearFormat(undefined)).toBe('pcm');
    expect(hearFormat('audio/webm;codecs=opus')).toBe('compressed');
    expect(hearFormat('audio/ogg')).toBe('compressed');
    expect(hearFormat('audio/mp4')).toBe('compressed');
    expect(hearFormat('audio/flac')).toBeNull();
    expect(hearFormat('text/plain')).toBeNull();
  });

  it('reads the seconds Vertex heard from its prompt tokens (measured: 247 tokens for 3.28 s)', () => {
    expect(heardSeconds(247)).toBeCloseTo(3.28, 1);
    expect(heardSeconds(100)).toBe(0);
  });
});

describe('the hear guard', () => {
  it('takes compressed audio only where Vertex is the ear', () => {
    expect(hearRelay(req(), '', false).ok).toBe(true);
    const openRouter = hearRelay(req(), 'sk', true);
    expect(openRouter.ok).toBe(false);
    if (!openRouter.ok) expect(openRouter.response.status).toBe(415);
  });

  it('caps a compressed body far below the WAV cap', () => {
    const big = hearRelay(req({ body: new Uint8Array(MAX_COMPRESSED_HEAR_BYTES + 1) }), '', false);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.response.status).toBe(413);
  });
});

describe('the meter on a compressed answer', () => {
  it('charges at the door as the longest answer, whatever its size', () => {
    const door = Math.ceil(COMPRESSED_HEAR_SECONDS * UNITS.hear.units);
    expect(unitsFor('hear', req({ body: new Uint8Array(2_000) }))).toBe(door);
    expect(unitsFor('hear', req({ body: new Uint8Array(300_000) }))).toBe(door);
  });

  it('still charges raw PCM by its bytes', () => {
    expect(unitsFor('hear', req({ headers: { 'content-type': 'audio/wav' }, body: new Uint8Array(320_000) }))).toBe(Math.ceil(10 * UNITS.hear.units));
  });

  it('claims nothing more when Vertex heard less than the door charged', async () => {
    const ledger = spyLedger();
    const out = await handleRelay(req(), depsWith(ledger, 247));
    expect(out.status).toBe(200);
    expect(ledger.claims).toHaveLength(1);
  });

  it('tops up from what Vertex heard when it was longer', async () => {
    const ledger = spyLedger();
    // 20 s of audio: 165 + 20 x 25 prompt tokens.
    await handleRelay(req(), depsWith(ledger, 165 + 20 * 25));
    await new Promise((r) => setTimeout(r, 0));
    expect(ledger.claims).toEqual([
      { relay: 'hear', units: Math.ceil(COMPRESSED_HEAR_SECONDS * UNITS.hear.units) },
      { relay: 'hear', units: Math.ceil((20 - COMPRESSED_HEAR_SECONDS) * UNITS.hear.units) },
    ]);
  });

  it('sends Vertex the body in its own media type', async () => {
    const seen: string[] = [];
    const deps = depsWith(spyLedger(), 247);
    deps.vertex = {
      tokens,
      fetch: (async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(String(init.body)).contents[0].parts[0].inlineData.mimeType);
        return reply('haan', 247);
      }) as unknown as typeof fetch,
    };
    await handleRelay(req({ headers: { authorization: 'Bearer good', 'content-type': 'audio/mp4' } }), deps);
    expect(seen).toEqual(['audio/mp4']);
  });
});
