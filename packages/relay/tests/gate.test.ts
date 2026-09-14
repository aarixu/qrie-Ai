import { describe, expect, it } from 'vitest';
import {
  HEARD_BYTES_PER_SECOND,
  REQUESTS_PER_MINUTE,
  UNITS,
  UNITS_PER_DAY,
  admit,
  createMemoryLedger,
  createSupabaseLedger,
  unitsFor,
  type Gate,
  type Ledger,
  type RelayName,
} from '../src/gate';
import { handleRelay, handleTicket, relayFor } from '../src/handler';
import { mintTicket, readTicket, TICKET_TTL_MS } from '../src/ticket';
import {
  DEFAULT_HEAR_MODEL,
  HEAR_LANGUAGE,
  type HeardAudio,
  type RelayRequest,
  type RelayResponse,
} from '../src/relays';
import type { Verifier } from '../src/auth';

/**
 * THE LOCK AND THE METER.
 *
 * Behind every relay is somebody's money, and until this landed the URLs were
 * open: one of them in a browser's network tab was a free model endpoint for
 * whoever found it, spending until the balance ran out. Everything here is
 * about one property — nothing reaches OpenRouter before we know who is asking
 * and that they are within their limits.
 */

const SECRET = 'a-long-random-dev-secret';
const USER = '11111111-2222-3333-4444-555555555555';

const req = (over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url: '/api/llm',
  headers: { authorization: 'Bearer good-token' },
  body: new TextEncoder().encode('{"model":"m"}'),
  ...over,
});

const yes: Verifier = async (header) =>
  header === 'Bearer good-token'
    ? { ok: true, user: { userId: USER } }
    : { ok: false, status: 401, why: 'that sign-in is not valid' };

const openLedger: Ledger = { async claim() { return { allowed: true }; } };

const gate = (over: Partial<Gate> = {}): Gate => ({
  verify: yes,
  ledger: openLedger,
  ticketSecret: SECRET,
  ...over,
});

const bodyOf = (out: RelayResponse): Record<string, unknown> =>
  out.body.kind === 'json' ? (out.body.value as Record<string, unknown>) : {};

// --------------------------------------------------------------- tickets ---

describe('speech tickets', () => {
  it('reads back what it minted', async () => {
    const expiresAt = 1_000_000;
    const token = await mintTicket(USER, SECRET, expiresAt);

    expect(await readTicket(token, SECRET, expiresAt - 1)).toEqual({ userId: USER, expiresAt });
  });

  it('refuses one signed with a different secret', async () => {
    const token = await mintTicket(USER, SECRET, 1_000_000);

    expect(await readTicket(token, 'not-the-secret', 0)).toBeNull();
  });

  it('refuses one whose user id was edited', async () => {
    // The signature covers the payload, so swapping the id invalidates it —
    // which is the entire reason a ticket can be trusted in a query string.
    const token = await mintTicket(USER, SECRET, 1_000_000);
    const forged = token.replace(token.split('.')[0], btoa('somebody-else').replace(/=+$/, ''));

    expect(await readTicket(forged, SECRET, 0)).toBeNull();
  });

  it('refuses one whose expiry was pushed out', async () => {
    const token = await mintTicket(USER, SECRET, 1_000);
    const parts = token.split('.');

    expect(await readTicket(`${parts[0]}.99999999999.${parts[2]}`, SECRET, 2_000)).toBeNull();
  });

  it('refuses an expired one', async () => {
    const token = await mintTicket(USER, SECRET, 1_000);

    expect(await readTicket(token, SECRET, 1_000)).toBeNull();
    expect(await readTicket(token, SECRET, 1_001)).toBeNull();
  });

  it('refuses nonsense without throwing', async () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c.d', '...']) {
      expect(await readTicket(bad, SECRET, 0)).toBeNull();
    }
    expect(await readTicket(null, SECRET, 0)).toBeNull();
  });

  it('lasts ten minutes, which outlives a beat and not a session', () => {
    expect(TICKET_TTL_MS).toBe(10 * 60 * 1000);
  });
});

describe('handleTicket', () => {
  it('mints only for a caller who proved who they are', async () => {
    const out = await handleTicket(req({ headers: {} }), gate());

    expect(out.status).toBe(401);
  });

  it('mints a ticket naming the verified user', async () => {
    const out = await handleTicket(req(), gate({ now: () => 5_000 }));
    const body = bodyOf(out);

    expect(out.status).toBe(200);
    expect(body.expiresAt).toBe(5_000 + TICKET_TTL_MS);
    expect(await readTicket(String(body.ticket), SECRET, 5_000)).toEqual({
      userId: USER,
      expiresAt: 5_000 + TICKET_TTL_MS,
    });
  });

  it('refuses rather than minting an unsigned pass when no secret is set', async () => {
    const out = await handleTicket(req(), gate({ ticketSecret: undefined }));

    expect(out.status).toBe(503);
  });
});

// ----------------------------------------------------------------- admit ---

describe('admit', () => {
  it('turns away a caller with no token', async () => {
    const out = await admit(req({ headers: {} }), 'llm', gate());

    expect(out.ok).toBe(false);
    expect(!out.ok && out.response.status).toBe(401);
  });

  it('turns away a bad token', async () => {
    const out = await admit(req({ headers: { authorization: 'Bearer forged' } }), 'llm', gate());

    expect(!out.ok && out.response.status).toBe(401);
  });

  it('lets a verified caller through and names them', async () => {
    const out = await admit(req(), 'llm', gate());

    expect(out.ok && out.userId).toBe(USER);
  });

  it('accepts a signed ticket for speech, which cannot send a header', async () => {
    const ticket = await mintTicket(USER, SECRET, 10_000);
    const out = await admit(
      req({ method: 'GET', url: `/api/speech?text=hi&ticket=${ticket}`, headers: {} }),
      'speech',
      gate({ now: () => 1_000 }),
    );

    expect(out.ok && out.userId).toBe(USER);
  });

  it('refuses a forged ticket rather than falling back to letting it pass', async () => {
    const out = await admit(
      req({ method: 'GET', url: '/api/speech?text=hi&ticket=made.up.value', headers: {} }),
      'speech',
      gate(),
    );

    expect(!out.ok && out.response.status).toBe(401);
  });

  it('does not accept a ticket on any relay but speech', async () => {
    // A ticket is a speech pass. Honouring it on /api/llm would make a
    // ten-minute string in a URL a key to the expensive endpoint.
    const ticket = await mintTicket(USER, SECRET, 10_000);
    const out = await admit(
      req({ url: `/api/llm?ticket=${ticket}`, headers: {} }),
      'llm',
      gate({ now: () => 1_000 }),
    );

    expect(!out.ok && out.response.status).toBe(401);
  });

  it('refuses speech tickets entirely when no secret is configured', async () => {
    const ticket = await mintTicket(USER, SECRET, 10_000);
    const out = await admit(
      req({ method: 'GET', url: `/api/speech?ticket=${ticket}`, headers: {} }),
      'speech',
      gate({ ticketSecret: undefined, now: () => 1_000 }),
    );

    // A missing secret closes the door; it never opens it.
    expect(!out.ok && out.response.status).toBe(401);
  });

  it('charges the ledger what THIS call costs, not what its relay costs on average', async () => {
    // The old meter handed `UNITS[relay]` straight through, so one character
    // of speech and a paragraph of it were the same price. What goes to the
    // ledger now has to be the priced request.
    const charged: { relay: string; units: number }[] = [];
    const ledger: Ledger = {
      async claim(_user, relay, units) {
        charged.push({ relay, units });
        return { allowed: true };
      },
    };
    const long = 'क'.repeat(500);

    await admit(req(), 'llm', gate({ ledger }));
    await admit(req({ method: 'GET', url: '/api/speech?text=hi' }), 'speech', gate({ ledger }));
    await admit(
      req({ method: 'GET', url: `/api/speech?text=${encodeURIComponent(long)}` }),
      'speech',
      gate({ ledger }),
    );

    expect(charged).toEqual([
      { relay: 'llm', units: 85 },
      { relay: 'speech', units: 1 },
      { relay: 'speech', units: Math.ceil(500 * 0.29) },
    ]);
  });

  it('passes a refusal back as 429 with a Retry-After a client can honour', async () => {
    const ledger: Ledger = {
      async claim() {
        return { allowed: false, reason: 'budget', retryAfterSeconds: 3600 };
      },
    };
    const out = await admit(req(), 'llm', gate({ ledger }));

    expect(!out.ok && out.response.status).toBe(429);
    expect(!out.ok && out.response.headers['retry-after']).toBe('3600');
  });

  it('says 503, not 429, when the meter itself is down', async () => {
    // The difference matters to a client: 429 means slow down, 503 means the
    // fault is ours. Either way it is a refusal — a limit that vanishes during
    // an outage is not a limit.
    const ledger: Ledger = {
      async claim() {
        return { allowed: false, reason: 'unavailable', retryAfterSeconds: 5 };
      },
    };
    const out = await admit(req(), 'llm', gate({ ledger }));

    expect(!out.ok && out.response.status).toBe(503);
  });
});

// --------------------------------------------------------------- pricing ---

/**
 * WHAT THE VENDORS ACTUALLY CHARGED FOR ONE CLASS, in paise.
 *
 * tools/measure/last-class.json, 2026-09-13: the committed Class 10 heredity
 * topic, 18 beats, 4 asks, 38 calls against the deployed relay. Copied here
 * rather than read, because a package touches no files — but they are the
 * same figures tools/measure/model-cost.mjs prints, and the whole point of
 * this block is that the meter and the bill agree.
 *
 * Speech counts the eight replies the harness did not speak and the classroom
 * does: ₹5.11 of narration plus ₹3.40 of her answers.
 */
const MEASURED = {
  speechCharacters: 2964,
  speechPaise: 851,
  heardSeconds: 40.01,
  heardPaise: 27.4,
  llmCalls: 12,
  llmPaise: 1021, // ₹9.08 preparing the class + ₹1.13 judging four answers
};

/** The same class, call by call, in the shape the classroom makes them. */
const CLASS = {
  beats: 18,
  narrationCharacters: 99, // 1,780 characters over 18 beats
  judgeCalls: 8, // a verdict and a cross-question for each of four asks
  replyCharacters: 148, // 1,184 characters over 8 spoken replies
  answerSeconds: 5, // 40 seconds of microphone over 8 answers
};

const speechReq = (characters: number): RelayRequest =>
  req({ method: 'GET', url: `/api/speech?text=${'a'.repeat(characters)}` });

const hearReq = (seconds: number): RelayRequest =>
  req({
    url: '/api/hear',
    headers: { authorization: 'Bearer good-token', 'content-type': 'audio/wav' },
    body: new Uint8Array(Math.round(seconds * HEARD_BYTES_PER_SECOND)),
  });

/**
 * Every call one class makes, in order. `cold` adds what only the first
 * student of a topic pays: the planner and the artist, and the save.
 */
const aClass = (cold: boolean): { relay: RelayName; req: RelayRequest }[] => {
  const calls: { relay: RelayName; req: RelayRequest }[] = [];
  if (cold) {
    for (let i = 0; i < 4; i += 1) calls.push({ relay: 'llm', req: req() });
    calls.push({ relay: 'class', req: req({ url: '/api/class' }) });
  }
  calls.push({ relay: 'icons', req: req({ url: '/api/icons' }) });
  for (let i = 0; i < CLASS.beats; i += 1) {
    calls.push({ relay: 'speech', req: speechReq(CLASS.narrationCharacters) });
  }
  for (let i = 0; i < CLASS.judgeCalls; i += 1) {
    calls.push({ relay: 'hear', req: hearReq(CLASS.answerSeconds) });
    calls.push({ relay: 'llm', req: req() });
    calls.push({ relay: 'speech', req: speechReq(CLASS.replyCharacters) });
  }
  return calls;
};

const costOf = (calls: { relay: RelayName; req: RelayRequest }[]): number =>
  calls.reduce((sum, c) => sum + unitsFor(c.relay, c.req), 0);

describe('what a unit is worth', () => {
  /**
   * THE INVARIANT THE OLD TABLE BROKE: one unit is one paisa.
   *
   * Asserted against the rates rather than against a rounded-up call, because
   * this is about the prices and not about integer arithmetic — a five-second
   * answer rounds 3.45 up to 4, and that is a separate question, below.
   *
   * `llm: 10, hear: 4, speech: 1` failed this by 30x in one direction and 6x
   * in the other, and nothing in this file noticed.
   */
  it('prices every relay within 2% of what the vendor charged for a measured class', () => {
    const within2 = (charged: number, paise: number) =>
      expect(Math.abs(charged - paise) / paise).toBeLessThan(0.02);

    within2(MEASURED.speechCharacters * UNITS.speech.units, MEASURED.speechPaise);
    within2(MEASURED.heardSeconds * UNITS.hear.units, MEASURED.heardPaise);
    within2(MEASURED.llmCalls * UNITS.llm.units, MEASURED.llmPaise);
  });

  it('charges most for speech, because speech is what a class actually costs', () => {
    // The symptom that started this: 86% of the bill is her voice, and the
    // old meter charged 26 units for it against 80 for the models.
    const calls = aClass(false);
    const spentOn = (relay: RelayName) => costOf(calls.filter((c) => c.relay === relay));

    expect(spentOn('speech')).toBeGreaterThan(spentOn('llm'));
    expect(spentOn('speech')).toBeGreaterThan(spentOn('hear') * 20);
  });

  it('charges speech by the character, so a paste is not the price of a word', () => {
    const word = unitsFor('speech', speechReq(4));
    const paste = unitsFor('speech', speechReq(8_000));

    expect(word).toBe(2);
    expect(paste).toBe(2_320);
    // Under a flat unit per call these were equal, which is what let one
    // account spend tens of thousands of rupees inside a 3,000-unit day.
    expect(paste / word).toBeGreaterThan(1_000);
  });

  it('charges the ear by the second of audio it was handed', () => {
    expect(unitsFor('hear', hearReq(1))).toBe(1);
    expect(unitsFor('hear', hearReq(60))).toBe(Math.ceil(60 * 0.69));
    expect(unitsFor('hear', hearReq(600))).toBe(Math.ceil(600 * 0.69));
  });

  it('never prices a call at nothing', () => {
    // A free call is a call worth making a million times, and the per-minute
    // ceiling alone would happily let one run all day.
    expect(unitsFor('speech', req({ method: 'GET', url: '/api/speech' }))).toBe(1);
    expect(unitsFor('hear', req({ url: '/api/hear', body: new Uint8Array() }))).toBe(1);
    for (const relay of ['llm', 'speech', 'hear', 'class', 'icons'] as RelayName[]) {
      expect(unitsFor(relay, req())).toBeGreaterThan(0);
    }
  });

  it('counts a character, not a byte', () => {
    // usage.ts bills `[...text].length`, and a meter counting UTF-8 bytes
    // would charge a Devanagari class three times what it invoices.
    const devanagari = req({
      method: 'GET',
      url: `/api/speech?text=${encodeURIComponent('क'.repeat(100))}`,
    });

    expect(unitsFor('speech', devanagari)).toBe(unitsFor('speech', speechReq(100)));
  });
});

describe('a day', () => {
  /**
   * THE FAILURE THAT WOULD SHIP SILENTLY.
   *
   * Re-pricing the units without moving UNITS_PER_DAY cuts every student off
   * partway through their first class, and nothing else in this suite would
   * say so: each individual claim is allowed, and the refusal only arrives
   * once enough of them have added up.
   */
  it('lets a real class run start to finish, cold and cached', async () => {
    let at = 0;
    const ledger = createMemoryLedger(() => at);

    for (const cold of [true, false]) {
      at += 61_000; // a fresh rate-limit window, so only the budget can refuse
      for (const call of aClass(cold)) {
        const out = await admit(call.req, call.relay, gate({ ledger }));
        expect(out.ok).toBe(true);
      }
    }
  });

  it('is worth seven classes — one new topic and six already prepared', async () => {
    let at = 0;
    const ledger = createMemoryLedger(() => at);
    let finished = 0;
    let refused = false;

    for (let attempt = 0; attempt < 12 && !refused; attempt += 1) {
      at += 61_000;
      for (const call of aClass(attempt === 0)) {
        const out = await admit(call.req, call.relay, gate({ ledger }));
        if (!out.ok) {
          expect(out.response.status).toBe(429);
          expect(bodyOf(out.response).error).toMatchObject({ reason: 'budget' });
          refused = true;
          break;
        }
      }
      if (!refused) finished += 1;
    }

    expect(finished).toBe(7);
  });

  it('costs what the docblock on UNITS_PER_DAY says it costs', () => {
    // The arithmetic in that comment is the only justification for the
    // number, so it is asserted rather than trusted.
    expect(costOf(aClass(false))).toBe(1_579);
    expect(costOf(aClass(true))).toBe(1_929);
    expect(costOf(aClass(true)) + 6 * costOf(aClass(false))).toBeLessThanOrEqual(UNITS_PER_DAY);
    expect(costOf(aClass(true)) + 7 * costOf(aClass(false))).toBeGreaterThan(UNITS_PER_DAY);

    // The headline's own number. The docblock says seven classes weigh 11,403
    // units, that the meter prices those at ₹114, and that the vendor bills
    // about ₹78 for them — three figures a reader is entitled to check, and the
    // first is the one the other two are computed from.
    expect(costOf(aClass(true)) + 6 * costOf(aClass(false))).toBe(11_403);
  });
});

// ---------------------------------------------------------------- ledger ---

describe('the in-memory ledger', () => {
  it('allows an ordinary burst and stops a loop', async () => {
    let at = 0;
    const ledger = createMemoryLedger(() => at);

    for (let i = 0; i < REQUESTS_PER_MINUTE; i += 1) {
      expect((await ledger.claim(USER, 'speech', 1)).allowed).toBe(true);
    }
    const over = await ledger.claim(USER, 'speech', 1);

    expect(over.allowed).toBe(false);
    expect(!over.allowed && over.reason).toBe('rate');
  });

  it('opens the window again a minute later', async () => {
    let at = 0;
    const ledger = createMemoryLedger(() => at);
    for (let i = 0; i < REQUESTS_PER_MINUTE; i += 1) await ledger.claim(USER, 'speech', 1);

    at = 60_000;

    expect((await ledger.claim(USER, 'speech', 1)).allowed).toBe(true);
  });

  it('stops a patient spender at the daily budget', async () => {
    let at = 0;
    const ledger = createMemoryLedger(() => at);
    let spent = 0;
    // Spread across minutes so the rate limit is never what stops it.
    while (spent + UNITS.llm.units <= UNITS_PER_DAY) {
      at += 61_000;
      expect((await ledger.claim(USER, 'llm', UNITS.llm.units)).allowed).toBe(true);
      spent += UNITS.llm.units;
    }

    at += 61_000;
    const over = await ledger.claim(USER, 'llm', UNITS.llm.units);

    expect(over.allowed).toBe(false);
    expect(!over.allowed && over.reason).toBe('budget');
  });

  it('gives the budget back the next day', async () => {
    let at = 0;
    const ledger = createMemoryLedger(() => at);
    let spent = 0;
    while (spent + UNITS.llm.units <= UNITS_PER_DAY) {
      at += 61_000;
      await ledger.claim(USER, 'llm', UNITS.llm.units);
      spent += UNITS.llm.units;
    }
    expect((await ledger.claim(USER, 'llm', UNITS.llm.units)).allowed).toBe(false);

    at = 86_400_000 * 2;

    expect((await ledger.claim(USER, 'llm', UNITS.llm.units)).allowed).toBe(true);
  });

  it('meters each student separately', async () => {
    const ledger = createMemoryLedger(() => 0);
    for (let i = 0; i < REQUESTS_PER_MINUTE; i += 1) await ledger.claim('one', 'speech', 1);

    expect((await ledger.claim('two', 'speech', 1)).allowed).toBe(true);
  });
});

describe('the Postgres ledger', () => {
  const called: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (body: unknown, ok = true): typeof fetch =>
    (async (url: string, init: RequestInit) => {
      called.push({ url: String(url), init });
      return {
        ok,
        status: ok ? 200 : 500,
        json: async () => body,
      } as unknown as Response;
    }) as unknown as typeof fetch;

  it('asks for the user it was given, never for one out of a request', async () => {
    called.length = 0;
    const ledger = createSupabaseLedger('https://p.supabase.co', 'service-key', fakeFetch([{ allowed: true }]));

    expect((await ledger.claim(USER, 'llm', 10)).allowed).toBe(true);
    expect(called[0].url).toBe('https://p.supabase.co/rest/v1/rpc/claim_relay');
    expect(JSON.parse(String(called[0].init.body))).toEqual({
      p_user: USER,
      p_relay: 'llm',
      p_units: 10,
    });
  });

  it('refuses when the meter cannot be reached', async () => {
    const ledger = createSupabaseLedger('https://p.supabase.co', 'k', (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch);
    const out = await ledger.claim(USER, 'llm', 10);

    expect(out.allowed).toBe(false);
    expect(!out.allowed && out.reason).toBe('unavailable');
  });

  it('refuses when the meter answers with something it does not understand', async () => {
    const ledger = createSupabaseLedger('https://p.supabase.co', 'k', fakeFetch({ nope: true }));

    expect((await ledger.claim(USER, 'llm', 10)).allowed).toBe(false);
  });

  it('carries the reason and the wait back', async () => {
    const ledger = createSupabaseLedger(
      'https://p.supabase.co',
      'k',
      fakeFetch([{ allowed: false, reason: 'budget', retry_after: 1234 }]),
    );
    const out = await ledger.claim(USER, 'llm', 10);

    expect(!out.allowed && out.reason).toBe('budget');
    expect(!out.allowed && out.retryAfterSeconds).toBe(1234);
  });
});

// --------------------------------------------------------------- routing ---

describe('relayFor', () => {
  it('matches the last segment, so one router serves both hosts', () => {
    expect(relayFor('/api/llm')).toBe('llm');
    expect(relayFor('https://p.functions.supabase.co/relay/llm')).toBe('llm');
    expect(relayFor('/api/speech?text=hi')).toBe('speech');
    expect(relayFor('/api/hear')).toBe('hear');
  });

  it('has no opinion about a path it does not serve', () => {
    expect(relayFor('/api/nope')).toBeNull();
    expect(relayFor('/')).toBeNull();
  });
});

describe('handleRelay', () => {
  /**
   * The host's transcriber, RECORDING WHAT IT WAS HANDED.
   *
   * It used to take no arguments at all, so the one thing this router has to
   * get right about the ear — what the transcriber is actually told — was
   * asserted nowhere between the request and the host. That is the same gap
   * that let a form carrying no language at all pass every test for months:
   * every stub agreed with the code instead of with the vendor.
   */
  const deps = (over: Partial<Gate> = {}, told: HeardAudio[] = []) => ({
    key: 'sk-test',
    gate: gate(over),
    transcribe: async (call: HeardAudio): Promise<RelayResponse> => {
      told.push(call);
      return {
        status: 200,
        headers: {},
        body: { kind: 'json' as const, value: { text: 'heard it' } },
      };
    },
  });

  it('reaches OpenRouter only after the caller is admitted', async () => {
    const out = await handleRelay(req({ headers: {} }), deps());

    expect(out.status).toBe(401);
    // The decisive part: no upstream call was even described.
    expect(out.body.kind).toBe('json');
  });

  it('relays for an admitted caller', async () => {
    const out = await handleRelay(req(), deps());

    expect(out.status).toBe(200);
    expect(out.body.kind).toBe('stream');
  });

  it('never spends when the meter says no', async () => {
    const out = await handleRelay(
      req(),
      deps({ ledger: { async claim() { return { allowed: false, reason: 'rate', retryAfterSeconds: 30 }; } } }),
    );

    expect(out.status).toBe(429);
    expect(out.body.kind).toBe('json');
  });

  it('transcribes through the host, once admitted', async () => {
    const out = await handleRelay(
      req({ url: '/api/hear', headers: { authorization: 'Bearer good-token', 'content-type': 'audio/wav' }, body: new Uint8Array([1, 2, 3]) }),
      deps(),
    );

    expect(out.status).toBe(200);
    expect(out.body.kind === 'json' && out.body.value).toEqual({ text: 'heard it' });
  });

  it('tells the transcriber to listen in Hinglish, whatever the caller asked for', async () => {
    /**
     * End to end through the router, not around it: a POST to /api/hear that
     * asks for Hindi, and the whole value the host is handed.
     *
     * Asserted as one object rather than field by field, because the failure
     * being guarded is a REORDER — `language` holding 'audio/wav' typechecked
     * clean while the seam was three bare strings, and sent the vendor a
     * language it would ignore in favour of English. `HeardAudio` made that
     * unspellable; this is what proves the router fills it correctly.
     */
    const told: HeardAudio[] = [];
    const audio = new Uint8Array([1, 2, 3]);
    const out = await handleRelay(
      req({
        url: '/api/hear?language=hi',
        headers: { authorization: 'Bearer good-token', 'content-type': 'audio/wav' },
        body: audio,
      }),
      deps({}, told),
    );

    expect(out.status).toBe(200);
    expect(told).toEqual([
      { model: DEFAULT_HEAR_MODEL, language: HEAR_LANGUAGE, contentType: 'audio/wav', audio },
    ]);
  });

  it('says plainly that icons and class are not hosted here yet', async () => {
    for (const path of ['/api/icons', '/api/class']) {
      const out = await handleRelay(req({ url: path }), deps());
      expect(out.status).toBe(501);
    }
  });

  it('has nothing for a path it does not serve', async () => {
    expect((await handleRelay(req({ url: '/api/whatever' }), deps())).status).toBe(404);
  });
});
