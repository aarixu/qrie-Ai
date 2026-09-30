import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRelay, relayFor, type HandlerDeps } from '../src/handler';
import { UNITS, UNITS_PER_DAY, UNITS_PER_DAY_PROJECT, createMemoryLedger, type Gate, type Ledger } from '../src/gate';
import type { RelayRequest, RelayResponse } from '../src/relays';
import type { Verifier } from '../src/auth';
import {
  LIVE_CONSTRAINED_URL,
  LIVE_TOKEN_ENDPOINT,
  LIVE_TOKEN_MODELS,
  LIVE_TOKEN_NEW_SESSION_MS,
  LIVE_TOKEN_TTL_MS,
  LIVE_TOKEN_USES,
  MAX_LIVE_TOKEN_REQUEST_BYTES,
  mintLiveToken,
  type LiveTokenReply,
} from '../src/liveToken';

/**
 * LIVE VOICE WITHOUT THE KEY IN THE PAGE.
 *
 * The browser opens a Gemini Live socket with a token this relay mints; the
 * Gemini key stays on the server. Two properties matter most and both are
 * about money: nothing reaches Google before the caller is verified and their
 * claim for a whole class is allowed, and nothing Google says — or the key —
 * travels back to the browser in an error.
 *
 * No test here calls Google. Every fetch is a stub.
 */

const KEY = 'AIza-test-key-that-must-never-leak';
const USER = '11111111-2222-3333-4444-555555555555';
const NOW = Date.UTC(2026, 8, 30, 10, 0, 0);

interface Seen {
  url: string;
  init: RequestInit;
}

/** A fetch that records every call and answers with `answer`. */
function stubFetch(answer: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return { fn, seen };
}

const tokenReply = (name = 'auth_tokens/abc123') =>
  new Response(JSON.stringify({ name }), { status: 200, headers: { 'content-type': 'application/json' } });

const bodyOf = (out: RelayResponse): Record<string, unknown> =>
  out.body.kind === 'json' ? (out.body.value as Record<string, unknown>) : {};

const wire = (out: RelayResponse): string => JSON.stringify(out);

// ------------------------------------------------------------ the mint ---

describe('mintLiveToken', () => {
  it('asks Google with the key in a header, never in the URL', async () => {
    const google = stubFetch(() => tokenReply());
    await mintLiveToken(KEY, { now: () => NOW, fetch: google.fn });

    expect(google.seen).toHaveLength(1);
    const [call] = google.seen;
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
    expect(call.url).toBe(LIVE_TOKEN_ENDPOINT);
    expect(call.url).not.toContain(KEY);
    expect(call.url).not.toContain('key=');
    expect(call.init.method).toBe('POST');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(KEY);
    expect(headers['content-type']).toBe('application/json');
  });

  it('asks for one session, a half-hour token, two minutes to start, pinned to one model', async () => {
    const google = stubFetch(() => tokenReply());
    await mintLiveToken(KEY, { now: () => NOW, fetch: google.fn });

    const body = JSON.parse(String(google.seen[0].init.body));
    expect(body).toEqual({
      uses: 1,
      expireTime: '2026-09-30T10:30:00.000Z',
      newSessionExpireTime: '2026-09-30T10:02:00.000Z',
      bidiGenerateContentSetup: { model: 'models/gemini-3.8-live' },
      // Without the mask Google takes the WHOLE setup from the token and
      // ignores the browser's — its system instruction and its tools.
      fieldMask: 'model',
    });
    expect(LIVE_TOKEN_USES).toBe(1);
    expect(LIVE_TOKEN_TTL_MS).toBe(30 * 60_000);
    expect(LIVE_TOKEN_NEW_SESSION_MS).toBe(2 * 60_000);
  });

  it('hands the browser the token, its deadlines, the model and a URL with no token in it', async () => {
    const google = stubFetch(() => tokenReply('auth_tokens/xyz'));
    const out = await mintLiveToken(KEY, { now: () => NOW, fetch: google.fn });

    expect(out.status).toBe(200);
    expect(out.headers['cache-control']).toBe('no-store');
    const reply = bodyOf(out) as unknown as LiveTokenReply;
    expect(reply).toEqual({
      token: 'auth_tokens/xyz',
      expiresAt: NOW + 30 * 60_000,
      newSessionExpiresAt: NOW + 2 * 60_000,
      model: 'gemini-3.8-live',
      url: LIVE_CONSTRAINED_URL,
    });
    expect(reply.url).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained',
    );
    expect(reply.url).not.toContain('access_token');
    expect(wire(out)).not.toContain(KEY);
  });

  it('pins the other allowed model when asked for it', async () => {
    const google = stubFetch(() => tokenReply());
    const out = await mintLiveToken(KEY, { model: 'gemini-3.1-flash-live-preview', now: () => NOW, fetch: google.fn });

    expect(JSON.parse(String(google.seen[0].init.body)).bidiGenerateContentSetup).toEqual({
      model: 'models/gemini-3.1-flash-live-preview',
    });
    expect(bodyOf(out).model).toBe('gemini-3.1-flash-live-preview');
  });

  it('refuses a model off the list without calling Google', async () => {
    const google = stubFetch(() => tokenReply());
    for (const model of ['gemini-3.1-pro-preview', 'models/gemini-3.8-live', '']) {
      const out = await mintLiveToken(KEY, { model, fetch: google.fn });
      expect(out.status).toBe(400);
    }
    expect(google.seen).toHaveLength(0);
  });

  it('never asks for an unlimited token, and never sends nonsense deadlines', async () => {
    // uses: 0 is Google's "no limit".
    const google = stubFetch(() => tokenReply());
    for (const bad of [
      { uses: 0 },
      { uses: 1.5 },
      { ttlMs: 0 },
      { ttlMs: 21 * 60 * 60_000 },
      { newSessionMs: 0 },
      { ttlMs: 60_000, newSessionMs: 120_000 },
    ]) {
      const out = await mintLiveToken(KEY, { ...bad, fetch: google.fn });
      expect(out.status).toBe(500);
    }
    expect(google.seen).toHaveLength(0);
  });

  it('says unconfigured, without calling anyone, when there is no key', async () => {
    const google = stubFetch(() => tokenReply());
    const out = await mintLiveToken('', { fetch: google.fn });

    expect(out.status).toBe(503);
    expect((bodyOf(out).error as { reason: string }).reason).toBe('unconfigured');
    expect(google.seen).toHaveLength(0);
  });

  it('turns a Google refusal into a 502 that carries neither the key nor what Google said', async () => {
    const google = stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 400, message: `API key not valid: ${KEY}`, status: 'INVALID_ARGUMENT' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
    );
    const out = await mintLiveToken(KEY, { fetch: google.fn });

    expect(out.status).toBe(502);
    expect(wire(out)).not.toContain(KEY);
    expect(wire(out)).not.toContain('INVALID_ARGUMENT');
    expect(wire(out)).not.toContain('not valid');
    expect((bodyOf(out).error as { message: string }).message).toContain('400');
  });

  it('turns a network failure into a 502 that does not repeat the thrown message', async () => {
    const google = stubFetch(() => {
      throw new Error(`connect ECONNREFUSED while sending ${KEY}`);
    });
    const out = await mintLiveToken(KEY, { fetch: google.fn });

    expect(out.status).toBe(502);
    expect(wire(out)).not.toContain(KEY);
    expect(wire(out)).not.toContain('ECONNREFUSED');
  });

  it('refuses a 200 that holds no token rather than handing the browser an empty one', async () => {
    for (const answer of [
      () => new Response(JSON.stringify({}), { status: 200 }),
      () => new Response(JSON.stringify({ name: '' }), { status: 200 }),
      () => new Response(JSON.stringify({ name: 42 }), { status: 200 }),
      () => new Response('not json', { status: 200 }),
    ]) {
      const out = await mintLiveToken(KEY, { fetch: stubFetch(answer).fn });
      expect(out.status).toBe(502);
    }
  });
});

// ---------------------------------------------------------- the route ----

const USER_TOKEN = 'Bearer good-token';

const yes: Verifier = async (header) =>
  header === USER_TOKEN ? { ok: true, user: { userId: USER } } : { ok: false, status: 401, why: 'that sign-in is not valid' };

const req = (over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url: '/api/live-token',
  headers: { authorization: USER_TOKEN, 'content-type': 'application/json' },
  body: new Uint8Array(),
  ...over,
});

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** Records every claim, allowing all of them unless told otherwise. */
function recordingLedger(answer: Awaited<ReturnType<Ledger['claim']>> = { allowed: true }) {
  const claims: { userId: string; relay: string; units: number }[] = [];
  const ledger: Ledger = {
    async claim(userId, relay, units) {
      claims.push({ userId, relay, units });
      return answer;
    },
  };
  return { ledger, claims };
}

const deps = (over: Partial<HandlerDeps> = {}, gate: Partial<Gate> = {}): HandlerDeps => ({
  key: '',
  geminiApiKey: KEY,
  gate: { verify: yes, ledger: recordingLedger().ledger, ...gate },
  transcribe: async () => {
    throw new Error('the live-token route must not transcribe');
  },
  now: () => NOW,
  ...over,
});

describe('POST /api/live-token', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mints for a verified caller after claiming one whole class under "live"', async () => {
    const google = stubFetch(() => tokenReply('auth_tokens/route'));
    vi.stubGlobal('fetch', google.fn);
    const { ledger, claims } = recordingLedger();

    const out = await handleRelay(req(), deps({}, { ledger }));

    expect(out.status).toBe(200);
    expect(bodyOf(out)).toMatchObject({ token: 'auth_tokens/route', model: 'gemini-3.8-live', expiresAt: NOW + 30 * 60_000 });
    expect(claims).toEqual([{ userId: USER, relay: 'live', units: UNITS.live.units }]);
    expect(google.seen).toHaveLength(1);
    expect(wire(out)).not.toContain(KEY);
  });

  it('serves the production path too, matched on its last segment', async () => {
    vi.stubGlobal('fetch', stubFetch(() => tokenReply()).fn);
    const out = await handleRelay(req({ url: '/functions/v1/relay/live-token' }), deps());
    expect(out.status).toBe(200);
    // It is its own route, not a relay: nothing streams through it.
    expect(relayFor('/api/live-token')).toBeNull();
  });

  it('never calls Google, or the meter, for a caller who is not signed in', async () => {
    const google = stubFetch(() => tokenReply());
    vi.stubGlobal('fetch', google.fn);
    const { ledger, claims } = recordingLedger();

    for (const headers of [{}, { authorization: 'Bearer forged' }]) {
      const out = await handleRelay(req({ headers }), deps({}, { ledger }));
      expect(out.status).toBe(401);
    }
    expect(claims).toHaveLength(0);
    expect(google.seen).toHaveLength(0);
  });

  it('never calls Google when the meter says no', async () => {
    const google = stubFetch(() => tokenReply());
    vi.stubGlobal('fetch', google.fn);

    for (const refusal of [
      { allowed: false as const, reason: 'budget' as const, retryAfterSeconds: 3600 },
      { allowed: false as const, reason: 'capped' as const, retryAfterSeconds: 3600 },
      { allowed: false as const, reason: 'rate' as const, retryAfterSeconds: 30 },
      { allowed: false as const, reason: 'unavailable' as const, retryAfterSeconds: 5 },
    ]) {
      const out = await handleRelay(req(), deps({}, { ledger: recordingLedger(refusal).ledger }));
      expect(out.status).toBeGreaterThanOrEqual(429);
      expect((bodyOf(out).error as { reason: string }).reason).toBe(refusal.reason);
    }
    expect(google.seen).toHaveLength(0);
  });

  it('is POST only, and a GET costs nothing', async () => {
    const google = stubFetch(() => tokenReply());
    vi.stubGlobal('fetch', google.fn);
    const { ledger, claims } = recordingLedger();

    const out = await handleRelay(req({ method: 'GET' }), deps({}, { ledger }));

    expect(out.status).toBe(405);
    expect(claims).toHaveLength(0);
    expect(google.seen).toHaveLength(0);
  });

  it('says unconfigured on a host with no Gemini key, before verifying or metering anyone', async () => {
    const google = stubFetch(() => tokenReply());
    vi.stubGlobal('fetch', google.fn);
    const explodes: Gate = {
      verify: () => {
        throw new Error('no identity check on a host that cannot mint');
      },
      ledger: {
        claim: () => {
          throw new Error('no claim on a host that cannot mint');
        },
      },
    };

    for (const geminiApiKey of [undefined, '']) {
      const out = await handleRelay(req(), { ...deps({ geminiApiKey }), gate: explodes });
      expect(out.status).toBe(503);
      expect((bodyOf(out).error as { reason: string }).reason).toBe('unconfigured');
    }
    expect(google.seen).toHaveLength(0);
  });

  it('refuses a model the app does not use before the meter, so it costs nothing', async () => {
    const google = stubFetch(() => tokenReply());
    vi.stubGlobal('fetch', google.fn);
    const { ledger, claims } = recordingLedger();

    for (const body of [
      json({ model: 'gemini-3.1-pro-preview' }),
      json({ model: 42 }),
      json(['gemini-3.8-live']),
      new TextEncoder().encode('{not json'),
    ]) {
      const out = await handleRelay(req({ body }), deps({}, { ledger }));
      expect(out.status).toBe(400);
    }
    const huge = await handleRelay(
      req({ body: new Uint8Array(MAX_LIVE_TOKEN_REQUEST_BYTES + 1) }),
      deps({}, { ledger }),
    );
    expect(huge.status).toBe(413);
    expect(claims).toHaveLength(0);
    expect(google.seen).toHaveLength(0);
  });

  it('takes either allowed model from the body, and the first when none is named', async () => {
    const google = stubFetch(() => tokenReply());
    vi.stubGlobal('fetch', google.fn);

    const named = await handleRelay(req({ body: json({ model: 'gemini-3.1-flash-live-preview' }) }), deps());
    const unnamed = await handleRelay(req({ body: json({}) }), deps());
    const empty = await handleRelay(req(), deps());

    expect(bodyOf(named).model).toBe('gemini-3.1-flash-live-preview');
    expect(bodyOf(unnamed).model).toBe(LIVE_TOKEN_MODELS[0]);
    expect(bodyOf(empty).model).toBe('gemini-3.8-live');
    expect(google.seen.map((s) => JSON.parse(String(s.init.body)).bidiGenerateContentSetup.model)).toEqual([
      'models/gemini-3.1-flash-live-preview',
      'models/gemini-3.8-live',
      'models/gemini-3.8-live',
    ]);
  });

  it('passes a Google failure on as a 502 without the key, after the claim was taken', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(() => new Response(JSON.stringify({ error: { message: KEY } }), { status: 403 })).fn,
    );
    const { ledger, claims } = recordingLedger();

    const out = await handleRelay(req(), deps({}, { ledger }));

    expect(out.status).toBe(502);
    expect(wire(out)).not.toContain(KEY);
    // Said in gate.ts: the claim comes first and is not refunded.
    expect(claims).toHaveLength(1);
  });
});

describe('the kill switch, for live tokens', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses before anything is verified, metered or minted', async () => {
    const google = stubFetch(() => tokenReply());
    vi.stubGlobal('fetch', google.fn);
    const explodes: Gate = {
      verify: () => {
        throw new Error('the gate must not be reached when the relay is off');
      },
      ledger: {
        claim: () => {
          throw new Error('the meter must not be reached when the relay is off');
        },
      },
    };

    const out = await handleRelay(req(), { ...deps({ disabled: true }), gate: explodes });

    expect(out.status).toBe(503);
    expect((bodyOf(out).error as { reason: string }).reason).toBe('disabled');
    expect(google.seen).toHaveLength(0);
  });
});

// ---------------------------------------------------------- the price ----

describe('what a live class is claimed at', () => {
  it('is the arithmetic in gate.ts, rounded up to the next hundred', () => {
    // Published rates, per token: audio in $3/M, audio out $12/M, text in
    // $0.75/M; 25 audio tokens a second; Rs 95.6 to the dollar.
    const mic = 600 * 25 * 3e-6;
    const voice = 300 * 25 * 12e-6;
    const instruction = 20 * 3_000 * 0.75e-6;
    const history = 20 * ((600 * 25 + 300 * 25) / 2) * 3e-6;
    const paise = (mic + voice + instruction + history) * 95.6 * 100;

    expect(Math.round(paise)).toBe(8_174);
    expect(UNITS.live).toEqual({ per: 'call', units: Math.ceil(paise / 100) * 100 });
  });

  it('fits one live class in a student day, and six in the project day', () => {
    // The consequence gate.ts says out loud, held here so a re-price that
    // changes it has to change this line too.
    expect(Math.floor(UNITS_PER_DAY / UNITS.live.units)).toBe(1);
    expect(Math.floor(UNITS_PER_DAY_PROJECT / UNITS.live.units)).toBe(6);
  });

  it('is refused by the real in-memory ledger on a second mint the same day', async () => {
    const ledger = createMemoryLedger(() => NOW);
    expect((await ledger.claim(USER, 'live', UNITS.live.units)).allowed).toBe(true);
    expect((await ledger.claim(USER, 'live', UNITS.live.units)).allowed).toBe(false);
  });
});
