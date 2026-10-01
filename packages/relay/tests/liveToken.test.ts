import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRelay, relayFor, type HandlerDeps } from '../src/handler';
import { UNITS, UNITS_PER_DAY, UNITS_PER_DAY_PROJECT, createMemoryLedger, type Gate, type Ledger } from '../src/gate';
import type { RelayRequest, RelayResponse } from '../src/relays';
import type { Verifier } from '../src/auth';
import {
  LIVE_CONSTRAINED_URL,
  LIVE_SESSION_MS,
  LIVE_SESSION_TURNS,
  LIVE_TOKEN_ENDPOINT,
  LIVE_TOKEN_FIELD_MASK,
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
 * claim for one session is allowed, and nothing Google says — or the key —
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

/** The backoff between asks, skipped: these tests prove the asks, not the clock. */
const noWait = async (): Promise<void> => undefined;

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

  it('sends the body the Live spike measured working: one session, six minutes, two to start, model and voice pinned', async () => {
    const google = stubFetch(() => tokenReply());
    await mintLiveToken(KEY, { now: () => NOW, fetch: google.fn });

    const body = JSON.parse(String(google.seen[0].init.body));
    expect(body).toEqual({
      uses: 1,
      expireTime: '2026-09-30T10:06:00.000Z',
      newSessionExpireTime: '2026-09-30T10:02:00.000Z',
      bidiGenerateContentSetup: {
        model: 'models/gemini-3.8-live',
        generationConfig: { responseModalities: ['AUDIO'] },
      },
      // Measured (SPIKE.md §1): with NO mask the page's systemInstruction and
      // tools were dropped — she was "Gemini" and never called next_move;
      // with this mask she was Meera and called it. Which other page fields
      // survive a maskless token is UNVERIFIED.
      fieldMask: 'model,generationConfig.responseModalities',
    });
    expect(LIVE_TOKEN_FIELD_MASK).toBe('model,generationConfig.responseModalities');
    expect(LIVE_TOKEN_USES).toBe(1);
    expect(LIVE_TOKEN_TTL_MS).toBe(6 * 60_000);
    expect(LIVE_TOKEN_NEW_SESSION_MS).toBe(2 * 60_000);
  });

  it('lets the token live no longer than the session its claim paid for', async () => {
    // The claim prices one session of LIVE_SESSION_TURNS turns in
    // LIVE_SESSION_MS (gate.ts UNITS.live). The relay never sees a turn; the
    // token's life is the one bound it holds itself, and a longer one would
    // sell more Live than it charged for — and outlive the kill switch by
    // longer (the phase-1 security review's finding).
    expect(LIVE_SESSION_MS).toBe(6 * 60_000);
    expect(LIVE_TOKEN_TTL_MS).toBeLessThanOrEqual(LIVE_SESSION_MS);
    const google = stubFetch(() => tokenReply());
    const out = await mintLiveToken(KEY, { now: () => NOW, fetch: google.fn });

    const sent = JSON.parse(String(google.seen[0].init.body));
    expect(Date.parse(sent.expireTime) - NOW).toBeLessThanOrEqual(LIVE_SESSION_MS);
    expect((bodyOf(out) as unknown as LiveTokenReply).expiresAt - NOW).toBeLessThanOrEqual(LIVE_SESSION_MS);

    // Not even a caller of mintLiveToken itself may ask for more.
    const longer = await mintLiveToken(KEY, { ttlMs: LIVE_SESSION_MS + 1, now: () => NOW, fetch: google.fn });
    expect(longer.status).toBe(500);
    expect(google.seen).toHaveLength(1);
  });

  it('hands the browser the token, its deadlines, its turn budget, the model and a URL with no token in it', async () => {
    const google = stubFetch(() => tokenReply('auth_tokens/xyz'));
    const out = await mintLiveToken(KEY, { now: () => NOW, fetch: google.fn });

    expect(out.status).toBe(200);
    expect(out.headers['cache-control']).toBe('no-store');
    const reply = bodyOf(out) as unknown as LiveTokenReply;
    expect(reply).toEqual({
      token: 'auth_tokens/xyz',
      expiresAt: NOW + 6 * 60_000,
      newSessionExpiresAt: NOW + 2 * 60_000,
      model: 'gemini-3.8-live',
      url: LIVE_CONSTRAINED_URL,
      maxStudentTurns: 8,
    });
    expect(LIVE_SESSION_TURNS).toBe(8);
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
      generationConfig: { responseModalities: ['AUDIO'] },
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
    const out = await mintLiveToken(KEY, { fetch: google.fn, sleep: noWait });

    expect(out.status).toBe(502);
    expect(wire(out)).not.toContain(KEY);
    expect(wire(out)).not.toContain('ECONNREFUSED');
  });

  // The claim before a mint cannot be refunded (claim_relay refuses a
  // negative claim), so a student whose mint failed would pay a second
  // session's claim for the one they never had. Google's price list has no
  // charge for minting, so a busy moment is asked again inside the one claim.
  it('asks again when Google is busy or unreachable, and hands out the second answer', async () => {
    for (const first of [
      () => new Response('{}', { status: 503 }),
      () => new Response('{}', { status: 429 }),
      () => new Response('{}', { status: 500 }),
      () => new Response('{}', { status: 408 }),
      (): Response => {
        throw new Error('socket hang up');
      },
    ]) {
      let asked = 0;
      const google = stubFetch(() => (asked++ === 0 ? first() : tokenReply('auth_tokens/second')));
      const waits: number[] = [];
      const out = await mintLiveToken(KEY, {
        now: () => NOW,
        fetch: google.fn,
        sleep: async (ms) => {
          waits.push(ms);
        },
      });

      expect(out.status).toBe(200);
      expect(bodyOf(out).token).toBe('auth_tokens/second');
      expect(google.seen).toHaveLength(2);
      expect(waits).toEqual([500]);
    }
  });

  it('gives up after three asks, with a 502 that still carries nothing of Google’s', async () => {
    const google = stubFetch(
      () => new Response(JSON.stringify({ error: { message: `overloaded for ${KEY}` } }), { status: 503 }),
    );
    const waits: number[] = [];
    const out = await mintLiveToken(KEY, {
      fetch: google.fn,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(out.status).toBe(502);
    expect(google.seen).toHaveLength(3);
    expect(waits).toEqual([500, 1_500]);
    expect(wire(out)).not.toContain(KEY);
    expect(wire(out)).not.toContain('overloaded');
  });

  it('does not ask again when Google refuses the request itself', async () => {
    for (const status of [400, 401, 403, 404]) {
      const google = stubFetch(() => new Response('{}', { status }));
      const out = await mintLiveToken(KEY, {
        fetch: google.fn,
        sleep: () => {
          throw new Error('a refusal is not a busy moment: no wait, no second ask');
        },
      });

      expect(out.status).toBe(502);
      expect(google.seen).toHaveLength(1);
    }
  });

  it('gives each ask its own timeout', async () => {
    // One signal shared by every ask would hand the second ask only what the
    // first left of it. Each ask must carry a fresh one, still unspent.
    const fresh: boolean[] = [];
    let asked = 0;
    const google = stubFetch(() => (asked++ === 0 ? new Response('{}', { status: 503 }) : tokenReply()));
    const watching = (async (url: string | URL | Request, init?: RequestInit) => {
      fresh.push(init?.signal instanceof AbortSignal && !init.signal.aborted);
      return google.fn(url, init);
    }) as typeof fetch;

    const out = await mintLiveToken(KEY, { fetch: watching, sleep: noWait });

    expect(out.status).toBe(200);
    expect(fresh).toEqual([true, true]);
    expect(google.seen[1].init.signal).not.toBe(google.seen[0].init.signal);
  });

  it('counts a retried token’s deadlines from the ask that got it, and tells the browser those', async () => {
    let clock = NOW;
    let asked = 0;
    const google = stubFetch(() => (asked++ === 0 ? new Response('{}', { status: 503 }) : tokenReply()));
    const out = await mintLiveToken(KEY, {
      now: () => clock,
      fetch: google.fn,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    const second = JSON.parse(String(google.seen[1].init.body));
    expect(second.expireTime).toBe(new Date(NOW + 500 + LIVE_TOKEN_TTL_MS).toISOString());
    expect(second.newSessionExpireTime).toBe(new Date(NOW + 500 + LIVE_TOKEN_NEW_SESSION_MS).toISOString());
    expect(bodyOf(out)).toMatchObject({
      expiresAt: NOW + 500 + LIVE_TOKEN_TTL_MS,
      newSessionExpiresAt: NOW + 500 + LIVE_TOKEN_NEW_SESSION_MS,
    });
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

  it('mints for a verified caller after claiming one session under "live"', async () => {
    const google = stubFetch(() => tokenReply('auth_tokens/route'));
    vi.stubGlobal('fetch', google.fn);
    const { ledger, claims } = recordingLedger();

    const out = await handleRelay(req(), deps({}, { ledger }));

    expect(out.status).toBe(200);
    expect(bodyOf(out)).toMatchObject({
      token: 'auth_tokens/route',
      model: 'gemini-3.8-live',
      expiresAt: NOW + LIVE_TOKEN_TTL_MS,
      maxStudentTurns: LIVE_SESSION_TURNS,
    });
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

  it('passes a Google refusal on as a 502 without the key, after the claim was taken', async () => {
    const google = stubFetch(() => new Response(JSON.stringify({ error: { message: KEY } }), { status: 403 }));
    vi.stubGlobal('fetch', google.fn);
    const { ledger, claims } = recordingLedger();

    const out = await handleRelay(req(), deps({}, { ledger }));

    expect(out.status).toBe(502);
    expect(wire(out)).not.toContain(KEY);
    // Said in gate.ts: the claim comes first and is not refunded. A 403 is
    // our key, not a busy moment, so it is not asked again.
    expect(claims).toHaveLength(1);
    expect(google.seen).toHaveLength(1);
  });

  it('rides out a busy Google inside the one claim, so the student still gets the session', async () => {
    // The correctness review's case: before, a single 503 here cost the claim
    // AND the session, and the student's own retry claimed again for the same
    // session. This waits the first real backoff (500 ms).
    let asked = 0;
    const google = stubFetch(() =>
      asked++ === 0 ? new Response('{}', { status: 503 }) : tokenReply('auth_tokens/after-a-503'),
    );
    vi.stubGlobal('fetch', google.fn);
    const ledger = createMemoryLedger(() => NOW);
    const claims: number[] = [];
    const counted: Ledger = {
      async claim(userId, relay, units) {
        claims.push(units);
        return ledger.claim(userId, relay, units);
      },
    };

    const out = await handleRelay(req(), deps({}, { ledger: counted }));

    expect(out.status).toBe(200);
    expect(bodyOf(out).token).toBe('auth_tokens/after-a-503');
    expect(claims).toEqual([UNITS.live.units]);
    expect(google.seen).toHaveLength(2);
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

/**
 * THE PRICE, RECOMPUTED FROM WHAT THE LIVE SPIKE MEASURED — not from
 * gate.ts's own arithmetic, so a wrong price there cannot pass by being
 * re-typed here.
 *
 * The frames are SPIKE.md §4's usageMetadata, copied whole: gemini-3.8-live,
 * typed input, spoken replies, 2026-09-30. Rates are Google's published paid
 * tier for 3.8 / 3.1 Live (one row), per token. Prompt tokens in no modality
 * are priced as text in; response tokens in no modality, and thinking, as
 * text out (UNVERIFIED for Live, as SPIKE.md §5 says).
 */
const PER_TOKEN = { textIn: 0.75e-6, audioIn: 3e-6, textOut: 4.5e-6, audioOut: 12e-6 };
const RS_PER_USD = 95.6;

interface UsageFrame {
  prompt: number;
  /** The prompt's AUDIO modality count; the rest of `prompt` is text or unattributed. */
  audio: number;
  response: number;
  /** The response's AUDIO modality count, when the frame gave one. */
  audioOut?: number;
  thoughts: number;
}

const frameUsd = (f: UsageFrame): number => {
  const audioOut = f.audioOut ?? 0;
  return (
    (f.prompt - f.audio) * PER_TOKEN.textIn +
    f.audio * PER_TOKEN.audioIn +
    audioOut * PER_TOKEN.audioOut +
    (f.response - audioOut + f.thoughts) * PER_TOKEN.textOut
  );
};

interface SpikeRun {
  opener: UsageFrame;
  /** Every frame of student turn 1, and of student turn 2. */
  turn1: UsageFrame[];
  turn2: UsageFrame[];
}

/** Run 2 without `behavior`: the call pass and the reply pass each report their own frame. */
const RUN2: SpikeRun = {
  opener: { prompt: 1071, audio: 187, response: 120, audioOut: 120, thoughts: 90 },
  turn1: [
    { prompt: 1232, audio: 307, response: 43, thoughts: 114 },
    { prompt: 1319, audio: 307, response: 118, audioOut: 118, thoughts: 45 },
  ],
  turn2: [
    { prompt: 1475, audio: 425, response: 28, thoughts: 55 },
    { prompt: 1558, audio: 425, response: 123, audioOut: 123, thoughts: 78 },
  ],
};

/** With `behavior: 'BLOCKING'`, the mode SPIKE.md picks for driver A: one frame per student turn. */
const BLOCKING: SpikeRun = {
  opener: { prompt: 1071, audio: 187, response: 157, audioOut: 157, thoughts: 65 },
  turn1: [{ prompt: 2743, audio: 688, response: 139, audioOut: 96, thoughts: 135 }],
  turn2: [{ prompt: 3163, audio: 880, response: 129, audioOut: 101, thoughts: 137 }],
};

/**
 * Spoken input, NOT measured (every spike turn was typed): 5 s of the
 * student at the docs' 25 audio tokens a second, read by both passes of its
 * own turn and of every turn after it.
 */
const SPOKEN_USD_PER_TURN = 5 * 25 * PER_TOKEN.audioIn * 2;

/**
 * One Live session: the opener, then `turns` student turns, each costing the
 * measured growth more than the last — because every generation re-reads
 * the whole context (SPIKE.md §4), a session's cost grows with the square of
 * its turns, and a NEW session starts again from an empty context.
 */
function sessionUsd(run: SpikeRun, turns: number, spoken: boolean): number {
  const sum = (frames: UsageFrame[]) => frames.reduce((usd, f) => usd + frameUsd(f), 0);
  const first = sum(run.turn1);
  const growth = sum(run.turn2) - first;
  let usd = frameUsd(run.opener);
  for (let k = 1; k <= turns; k += 1) {
    usd += first + growth * (k - 1) + (spoken ? SPOKEN_USD_PER_TURN * k : 0);
  }
  return usd;
}

const paise = (usd: number): number => usd * RS_PER_USD * 100;

describe('what a live session is claimed at', () => {
  it('starts from the turns the spike measured', () => {
    // The rounded figures gate.ts writes its formula with.
    const sum = (frames: UsageFrame[]) => frames.reduce((usd, f) => usd + frameUsd(f), 0);
    expect(frameUsd(RUN2.opener)).toBeCloseTo(0.00307, 5);
    expect(sum(RUN2.turn1)).toBeCloseTo(0.00562, 5);
    expect(sum(RUN2.turn2)).toBeCloseTo(0.00639, 5);
    expect(sum(RUN2.turn2) - sum(RUN2.turn1)).toBeCloseTo(0.00077, 5);
    expect(SPOKEN_USD_PER_TURN).toBeCloseTo(0.00075, 8);
  });

  it('is a spoken session of LIVE_SESSION_TURNS student turns, rounded up to the next hundred paise', () => {
    const spoken = paise(sessionUsd(RUN2, LIVE_SESSION_TURNS, true));

    expect(Math.round(spoken)).toBe(923);
    expect(UNITS.live).toEqual({ per: 'call', units: Math.ceil(spoken / 100) * 100 });
    expect(UNITS.live.units).toBe(1_000);
  });

  it('covers the same session priced from the BLOCKING run, the mode SPIKE.md picks for driver A', () => {
    const blocking = paise(sessionUsd(BLOCKING, LIVE_SESSION_TURNS, true));
    expect(Math.round(blocking)).toBe(916);
    expect(blocking).toBeLessThanOrEqual(UNITS.live.units);
  });

  it('lets one tester run several classes a day, and the project fifty sessions', () => {
    // The consequence gate.ts says out loud, held here so a re-price that
    // changes it has to change these lines too.
    expect(Math.floor(UNITS_PER_DAY / UNITS.live.units)).toBe(12);
    expect(Math.floor(UNITS_PER_DAY_PROJECT / UNITS.live.units)).toBe(50);
    // A class of up to 32 student turns is four sessions; three such classes
    // fit in one student's day.
    const sessionsFor = (turns: number, perSession = LIVE_SESSION_TURNS) => Math.ceil(turns / perSession);
    expect(sessionsFor(32)).toBe(4);
    expect(3 * sessionsFor(32) * UNITS.live.units).toBeLessThanOrEqual(UNITS_PER_DAY);
    // The Respiration plan's 28 turns, in sessions that run out of time at
    // six turns: five sessions, and two such classes still fit.
    expect(sessionsFor(28, 6)).toBe(5);
    expect(Math.floor(UNITS_PER_DAY / (sessionsFor(28, 6) * UNITS.live.units))).toBe(2);
  });

  it('gives a session time for its eight turns at the plan’s own pace', () => {
    // content/plans/class10-respiration.json: `minutes: 20` for 28 student
    // turns, ~43 s a turn (liveToken.ts LIVE_SESSION_MS).
    const planSecondsPerTurn = (20 * 60) / 28;
    expect(LIVE_SESSION_TURNS * planSecondsPerTurn * 1000).toBeLessThanOrEqual(LIVE_SESSION_MS);
    expect(Math.round(LIVE_SESSION_TURNS * planSecondsPerTurn)).toBe(343);
  });

  it('says why a whole class is not one session', () => {
    // 28 spoken turns in ONE session, re-reading an ever longer context.
    const oneSession = paise(sessionUsd(RUN2, 28, true));
    expect(Math.round(oneSession)).toBe(7_220);
    // The same 28 turns as sessions of 8, 8, 8 and 4, each from an empty context.
    const inSessions = 3 * paise(sessionUsd(RUN2, 8, true)) + paise(sessionUsd(RUN2, 4, true));
    expect(Math.round(inSessions)).toBe(3_129);
    expect(inSessions).toBeLessThan(oneSession / 2);
    // Past 37 spoken turns a single session costs more than a student's whole
    // day, so no flat price could be claimed for it at all.
    expect(paise(sessionUsd(RUN2, 37, true))).toBeLessThanOrEqual(UNITS_PER_DAY);
    expect(paise(sessionUsd(RUN2, 38, true))).toBeGreaterThan(UNITS_PER_DAY);
  });

  it('says what a typed session would cost, for the lab that types', () => {
    expect(Math.round(paise(sessionUsd(RUN2, LIVE_SESSION_TURNS, false)))).toBe(665);
  });

  it('is refused by the real in-memory ledger on the thirteenth session of a day', async () => {
    const ledger = createMemoryLedger(() => NOW);
    for (let i = 0; i < 12; i += 1) {
      expect((await ledger.claim(USER, 'live', UNITS.live.units)).allowed).toBe(true);
    }
    expect((await ledger.claim(USER, 'live', UNITS.live.units)).allowed).toBe(false);
  });
});
