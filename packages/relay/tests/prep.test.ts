import { describe, expect, it } from 'vitest';
import { handleRelay, routeFor } from '../src/handler';
import {
  MAX_CONTROL_BYTES,
  MAX_PREP_STATE_REFS,
  PREP_LOCK_TTL_SECONDS,
  createMemoryPrepLocks,
  createSupabasePrepLocks,
  isTopicRef,
} from '../src/prep';
import type { Gate } from '../src/gate';
import type { RelayRequest, RelayResponse } from '../src/relays';
import type { Verifier } from '../src/auth';

/**
 * S IS THE WHOLE COST MODEL, AND 0017'S LOCK HAD NO CALLER.
 *
 * take_prep_lock and release_prep_lock are live in Postgres and nothing in
 * the product reaches them. These routes are the wiring: a client that is
 * about to spend Rs 30 preparing a topic asks first, and a second student on
 * the same cold topic is told to wait for the class they are about to be
 * handed instead of paying for its twin.
 */

const USER = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const ORG = '22222222-3333-4444-5555-666666666666';
const TOPIC = 'ncert-x/heredity/mendel';

const yes: Verifier = async (header) =>
  header === 'Bearer good-token'
    ? { ok: true, user: { userId: USER } }
    : { ok: false, status: 401, why: 'that sign-in is not valid' };

const gate = (over: Partial<Gate> = {}): Gate => ({
  verify: yes,
  ledger: { async claim() { return { allowed: true }; } },
  ...over,
});

const post = (url: string, value: unknown, over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url,
  headers: { authorization: 'Bearer good-token' },
  body: new TextEncoder().encode(JSON.stringify(value)),
  ...over,
});

const get = (url: string): RelayRequest => ({
  method: 'GET',
  url,
  headers: { authorization: 'Bearer good-token' },
  body: new Uint8Array(),
});

const deps = (over: Record<string, unknown> = {}) => ({
  key: 'sk-test',
  gate: gate(),
  transcribe: async (): Promise<RelayResponse> => {
    throw new Error('the transcriber has no business in a prep lock');
  },
  ...over,
});

const bodyOf = (out: RelayResponse): Record<string, unknown> =>
  out.body.kind === 'json' ? (out.body.value as Record<string, unknown>) : {};

describe('routeFor, for the prep family', () => {
  it('names all four, under either host prefix', () => {
    expect(routeFor('/api/prep/lock')).toBe('prep/lock');
    expect(routeFor('/api/prep/renew')).toBe('prep/renew');
    expect(routeFor('/api/prep/release')).toBe('prep/release');
    expect(routeFor('/api/prep/state?topicRefs=a%2Fb%2Fc')).toBe('prep/state');
    expect(routeFor('/relay/prep/lock')).toBe('prep/lock');
  });

  it('does not mistake a bare /prep or a stranger for a route', () => {
    expect(routeFor('/api/prep')).toBeNull();
    expect(routeFor('/api/prep/steal')).toBeNull();
    expect(routeFor('/api/lock')).toBeNull();
  });
});

describe('isTopicRef', () => {
  it('takes the product’s three-segment key and nothing else', () => {
    expect(isTopicRef('ncert-x/heredity/mendel')).toBe(true);
    expect(isTopicRef('a//c')).toBe(false);
    expect(isTopicRef('a/b')).toBe(false);
    expect(isTopicRef('')).toBe(false);
    expect(isTopicRef(42)).toBe(false);
  });

  /**
   * THE CHARACTER CLASS, WHICH THE STATE ROUTE DEPENDS ON.
   *
   * createSupabasePrepLocks.state builds a PostgREST in-list by wrapping
   * each ref in double quotes. With only a length-and-segments check, a
   * quote passed validation, broke the list open and fail-closed a batch of
   * up to fifty refs to a 503. A comment claimed it could not happen; it
   * could. These are the cases that make the comment true.
   */
  it('excludes the characters that would break the state route’s in-list', () => {
    expect(isTopicRef('a"/b/c')).toBe(false);
    expect(isTopicRef('a/b/c",\"x')).toBe(false);
    expect(isTopicRef('a,b/c/d')).toBe(false);
    expect(isTopicRef('a b/c/d')).toBe(false);
    expect(isTopicRef('a\\/b/c')).toBe(false);
  });

  it('still takes every topicRef shape the content actually uses', () => {
    expect(isTopicRef('class10-science/life-processes/transportation-in-human-beings')).toBe(true);
    expect(isTopicRef('class9-science/atoms-and-molecules/law-of-conservation-of-mass')).toBe(true);
    expect(isTopicRef('a.b/c_d/e~f')).toBe(true);
  });
});

describe('createMemoryPrepLocks', () => {
  it('grants a free topic and reports the count in flight', async () => {
    const locks = createMemoryPrepLocks();
    const won = await locks.take(TOPIC, USER);
    expect(won).not.toBeNull();
    expect(won!.granted).toBe(true);
    expect(won!.running).toBe(1);
  });

  it('tells the loser who holds it and until when', async () => {
    const locks = createMemoryPrepLocks(() => 1_000_000);
    await locks.take(TOPIC, OTHER);
    const lost = await locks.take(TOPIC, USER);
    expect(lost!.granted).toBe(false);
    expect(lost!.reason).toBe('held');
    expect(lost!.holder).toBe(OTHER);
    expect(lost!.expiresAt).toBeDefined();
  });

  it('turns the ninth simultaneous preparation away with busy', async () => {
    const locks = createMemoryPrepLocks();
    for (let i = 0; i < 8; i += 1) {
      expect((await locks.take(`s/c/t${i}`, USER))!.granted).toBe(true);
    }
    const ninth = await locks.take('s/c/t-free', USER);
    expect(ninth!.granted).toBe(false);
    expect(ninth!.reason).toBe('busy');
  });

  it('sweeps an expired lock, because a closed browser releases nothing', async () => {
    let at = 0;
    const locks = createMemoryPrepLocks(() => at);
    await locks.take(TOPIC, OTHER);
    at = PREP_LOCK_TTL_SECONDS * 1000 + 1;
    expect((await locks.take(TOPIC, USER))!.granted).toBe(true);
  });

  it('releases only for the holder', async () => {
    const locks = createMemoryPrepLocks();
    await locks.take(TOPIC, OTHER);
    expect(await locks.release(TOPIC, USER)).toBe(false);
    expect(await locks.release(TOPIC, OTHER)).toBe(true);
    // Tidying up after a crash may be late; that is not an error.
    expect(await locks.release(TOPIC, OTHER)).toBe(false);
  });

  it('answers preparing for a held topic and absent otherwise, and takes no lock doing it', async () => {
    const locks = createMemoryPrepLocks();
    await locks.take(TOPIC, OTHER);
    const states = await locks.state([TOPIC, 'a/b/c']);
    expect(states).toEqual({ [TOPIC]: 'preparing', 'a/b/c': 'absent' });
    // The read must not have claimed anything: a/b/c is still free to take.
    expect((await locks.take('a/b/c', USER))!.granted).toBe(true);
  });
});

describe('the prep routes through handleRelay', () => {
  it('says plainly when this host has no locks', async () => {
    expect((await handleRelay(post('/api/prep/lock', { topicRef: TOPIC }), deps())).status).toBe(501);
  });

  it('admits before it locks', async () => {
    const out = await handleRelay(
      post('/api/prep/lock', { topicRef: TOPIC }, { headers: {} }),
      deps({ prepLocks: createMemoryPrepLocks() }),
    );
    expect(out.status).toBe(401);
  });

  it('grants through the route and hands back the contract shape', async () => {
    const out = await handleRelay(
      post('/api/prep/lock', { topicRef: TOPIC }),
      deps({ prepLocks: createMemoryPrepLocks() }),
    );
    expect(out.status).toBe(200);
    const body = bodyOf(out);
    expect(body.granted).toBe(true);
    expect(body.running).toBe(1);
  });

  it('refuses a key that is not a topicRef, because two derived keys are no lock', async () => {
    const out = await handleRelay(
      post('/api/prep/lock', { topicRef: 'just-a-slug' }),
      deps({ prepLocks: createMemoryPrepLocks() }),
    );
    expect(out.status).toBe(400);
  });

  it('releases through the route', async () => {
    const locks = createMemoryPrepLocks();
    await handleRelay(post('/api/prep/lock', { topicRef: TOPIC }), deps({ prepLocks: locks }));
    const out = await handleRelay(post('/api/prep/release', { topicRef: TOPIC }), deps({ prepLocks: locks }));
    expect(bodyOf(out)).toEqual({ released: true });
  });

  it('serves state as a GET and refuses a POST there', async () => {
    const locks = createMemoryPrepLocks();
    await locks.take(TOPIC, OTHER);
    const out = await handleRelay(get(`/api/prep/state?topicRefs=${encodeURIComponent(TOPIC)}`), deps({ prepLocks: locks }));
    expect(out.status).toBe(200);
    expect((bodyOf(out).states as Record<string, string>)[TOPIC]).toBe('preparing');

    expect((await handleRelay(post('/api/prep/state', {}), deps({ prepLocks: locks }))).status).toBe(405);
  });

  it('caps the state list, because an unbounded IN-list is somebody else’s query', async () => {
    const refs = Array.from({ length: MAX_PREP_STATE_REFS + 1 }, (_, i) => `s/c/t${i}`).join(',');
    const out = await handleRelay(
      get(`/api/prep/state?topicRefs=${encodeURIComponent(refs)}`),
      deps({ prepLocks: createMemoryPrepLocks() }),
    );
    expect(out.status).toBe(400);
  });

  it('answers 503 when the lock store is unreachable — fail closed, never a free-for-all', async () => {
    const out = await handleRelay(
      post('/api/prep/lock', { topicRef: TOPIC }),
      deps({
        prepLocks: {
          async take() { return null; },
          async renew() { return null; },
          async release() { return null; },
          async state() { return null; },
        },
      }),
    );
    expect(out.status).toBe(503);
  });

  /**
   * THE HEARTBEAT. The TTL is 180 seconds against a preparation measured at
   * ninety-six on a DEVELOPMENT machine; the stated device is a cheap
   * Android. Without a renew, a slow phone's lock is swept mid-preparation,
   * a second student wins it, and both preparations are paid for in full.
   */
  it('renews the holder’s lock and pushes the deadline out', async () => {
    let at = 1_000_000;
    const locks = createMemoryPrepLocks(() => at);
    const won = await locks.take(TOPIC, USER);
    const firstDeadline = won!.expiresAt;

    at += 120_000; // past nothing yet, but two thirds of the way to the TTL
    const out = await handleRelay(post('/api/prep/renew', { topicRef: TOPIC }), deps({ prepLocks: locks }));
    expect(bodyOf(out)).toEqual({ renewed: true });

    at += 120_000; // 240s after taking it: lapsed, had nobody renewed
    const states = await locks.state([TOPIC]);
    expect(states![TOPIC]).toBe('preparing');
    const again = await locks.take(TOPIC, OTHER);
    expect(again!.granted).toBe(false);
    expect(new Date(String(firstDeadline)).getTime()).toBeLessThan(at);
  });

  it('lets only the holder renew, so a loser cannot extend the winner’s lock', async () => {
    const locks = createMemoryPrepLocks();
    await locks.take(TOPIC, USER);
    expect(await locks.renew(TOPIC, OTHER)).toBe(false);
    expect(await locks.renew(TOPIC, USER)).toBe(true);
  });

  it('answers a late renew with false rather than an error', async () => {
    let at = 1_000_000;
    const locks = createMemoryPrepLocks(() => at);
    await locks.take(TOPIC, USER);
    at += PREP_LOCK_TTL_SECONDS * 1000 + 1;
    expect(await locks.renew(TOPIC, USER)).toBe(false);
  });

  it('refuses a body larger than any lock this app takes, before decoding it', async () => {
    const out = await handleRelay(
      {
        method: 'POST',
        url: '/api/prep/lock',
        headers: { authorization: 'Bearer good-token' },
        body: new Uint8Array(MAX_CONTROL_BYTES + 1),
      },
      deps({ prepLocks: createMemoryPrepLocks() }),
    );
    expect(out.status).toBe(413);
  });
});

describe('createSupabasePrepLocks', () => {
  const membershipRow = JSON.stringify([{ org_id: ORG }]);

  it('resolves the caller’s organisation with org_of — the one rule — then claims', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const locks = createSupabasePrepLocks('https://x.supabase.co', 'service-key', async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).endsWith('/rest/v1/rpc/org_of')) {
        // PostgREST answers a scalar function with the bare JSON value.
        return new Response(JSON.stringify(ORG), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(
        JSON.stringify([{ granted: true, reason: null, holder: USER, expires_at: '2026-09-18T05:03:00Z', running: 1 }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const won = await locks.take(TOPIC, USER);
    expect(won).toEqual({ granted: true, holder: USER, expiresAt: '2026-09-18T05:03:00Z', running: 1 });

    // The relay asks the database's rule (0021's org_of: a school beats a solo
    // org) instead of keeping its own copy of an older one.
    const orgOf = calls.find((c) => c.url.endsWith('/rest/v1/rpc/org_of'));
    expect(orgOf!.body).toEqual({ p_user: USER });
    expect(calls.some((c) => c.url.includes('/rest/v1/membership'))).toBe(false);

    const rpc = calls.find((c) => c.url.endsWith('/rest/v1/rpc/take_prep_lock'));
    expect(rpc!.body).toEqual({ p_topic: TOPIC, p_user: USER, p_org: ORG });
  });

  it('renews through extend_prep_lock, holder-only and with the same TTL', async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const locks = createSupabasePrepLocks('https://x.supabase.co', 'service-key', async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response('true', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    expect(await locks.renew(TOPIC, USER)).toBe(true);
    expect(calls[0].url).toBe('https://x.supabase.co/rest/v1/rpc/extend_prep_lock');
    // No org: extending is holder-only and needs no admission decision.
    expect(calls[0].body).toEqual({ p_topic: TOPIC, p_user: USER, p_ttl_seconds: PREP_LOCK_TTL_SECONDS });
  });

  it('fails closed on a renew it cannot reach, rather than claiming the lock is still held', async () => {
    const locks = createSupabasePrepLocks('https://x.supabase.co', 'service-key', async () =>
      new Response('nope', { status: 500 }),
    );
    expect(await locks.renew(TOPIC, USER)).toBeNull();
  });

  it('fails closed when the caller has no membership to resolve', async () => {
    // org_of answers null for a user with no membership.
    const locks = createSupabasePrepLocks('https://x.supabase.co', 'service-key', async () =>
      new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    expect(await locks.take(TOPIC, USER)).toBeNull();
  });

  it('joins prepared_class and unexpired locks into per-ref states, with GETs only', async () => {
    const calls: { url: string; method: string }[] = [];
    const locks = createSupabasePrepLocks('https://x.supabase.co', 'service-key', async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      if (String(url).includes('/rest/v1/prepared_class')) {
        return new Response(JSON.stringify([{ topic_ref: 'a/b/ready' }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify([{ topic_ref: 'a/b/locked' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const states = await locks.state(['a/b/ready', 'a/b/locked', 'a/b/cold']);
    expect(states).toEqual({ 'a/b/ready': 'ready', 'a/b/locked': 'preparing', 'a/b/cold': 'absent' });
    // A read takes no lock: nothing but GETs went over the wire.
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    // And only a published class is announced ready — a retracted one must
    // send the next student to prepare, not to a class that was pulled.
    expect(calls.find((c) => c.url.includes('prepared_class'))!.url).toMatch(/review_status=eq\.published/);
  });

  it('releases through the definer function and reads the boolean back', async () => {
    const locks = createSupabasePrepLocks('https://x.supabase.co', 'service-key', async (url) => {
      if (String(url).endsWith('/rest/v1/rpc/release_prep_lock')) {
        return new Response('true', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(membershipRow, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    expect(await locks.release(TOPIC, USER)).toBe(true);
  });
});
