import { describe, expect, it } from 'vitest';
import {
  REQUESTS_PER_MINUTE,
  UNITS,
  UNITS_PER_DAY,
  admit,
  createMemoryLedger,
  createSupabaseLedger,
  type Gate,
  type Ledger,
} from '../src/gate';
import { handleRelay, handleTicket, relayFor } from '../src/handler';
import { mintTicket, readTicket, TICKET_TTL_MS } from '../src/ticket';
import type { RelayRequest, RelayResponse } from '../src/relays';
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

  it('charges the ledger the relay’s own weight', async () => {
    const charged: { relay: string; units: number }[] = [];
    const ledger: Ledger = {
      async claim(_user, relay, units) {
        charged.push({ relay, units });
        return { allowed: true };
      },
    };

    await admit(req(), 'llm', gate({ ledger }));
    await admit(req({ method: 'GET', url: '/api/speech?text=hi' }), 'speech', gate({ ledger }));

    expect(charged).toEqual([
      { relay: 'llm', units: UNITS.llm },
      { relay: 'speech', units: UNITS.speech },
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
    while (spent + UNITS.llm <= UNITS_PER_DAY) {
      at += 61_000;
      expect((await ledger.claim(USER, 'llm', UNITS.llm)).allowed).toBe(true);
      spent += UNITS.llm;
    }

    at += 61_000;
    const over = await ledger.claim(USER, 'llm', UNITS.llm);

    expect(over.allowed).toBe(false);
    expect(!over.allowed && over.reason).toBe('budget');
  });

  it('gives the budget back the next day', async () => {
    let at = 0;
    const ledger = createMemoryLedger(() => at);
    let spent = 0;
    while (spent + UNITS.llm <= UNITS_PER_DAY) {
      at += 61_000;
      await ledger.claim(USER, 'llm', UNITS.llm);
      spent += UNITS.llm;
    }
    expect((await ledger.claim(USER, 'llm', UNITS.llm)).allowed).toBe(false);

    at = 86_400_000 * 2;

    expect((await ledger.claim(USER, 'llm', UNITS.llm)).allowed).toBe(true);
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
  const deps = (over: Partial<Gate> = {}) => ({
    key: 'sk-test',
    gate: gate(over),
    transcribe: async (): Promise<RelayResponse> => ({
      status: 200,
      headers: {},
      body: { kind: 'json' as const, value: { text: 'heard it' } },
    }),
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
