import { describe, expect, it } from 'vitest';
import { handleRelay, routeFor } from '../src/handler';
import { createMemorySafetyEventStore, createSupabaseSafetyEventStore } from '../src/safetyFlag';
import type { Gate } from '../src/gate';
import type { RelayRequest, RelayResponse } from '../src/relays';
import type { Verifier } from '../src/auth';

/**
 * A DISTRESS FLAG REACHES THE SERVER, AND NOTHING ELSE DOES. (Plan 5.)
 *
 * The tutor's screen recognises distress on the phone. This route carries
 * the fact of it to Postgres: a uuid, the category, whose words matched, a
 * time, the platform and the build. A body with any other key is refused, so
 * no words can ride along. It is admitted like a report: above the kill
 * switch, zero units, exempt from halted, capped and budget, still signed in
 * and still rate-limited.
 */

const USER = '11111111-2222-3333-4444-555555555555';
const FLAG_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const yes: Verifier = async (header) =>
  header === 'Bearer good-token'
    ? { ok: true, user: { userId: USER } }
    : { ok: false, status: 401, why: 'that sign-in is not valid' };

const gate = (over: Partial<Gate> = {}): Gate => ({
  verify: yes,
  ledger: { async claim() { return { allowed: true }; } },
  ...over,
});

const flag = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: FLAG_ID,
  category: 'distress',
  direction: 'from-student',
  at: '2026-10-08T05:00:00.000Z',
  platform: 'web',
  release: 'abc1234',
  ...over,
});

const post = (value: unknown, over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url: '/api/flag',
  headers: { authorization: 'Bearer good-token' },
  body: new TextEncoder().encode(JSON.stringify(value)),
  ...over,
});

const deps = (over: Record<string, unknown> = {}) => ({
  key: 'sk-test',
  gate: gate(),
  safetyEvents: createMemorySafetyEventStore(),
  transcribe: async (): Promise<RelayResponse> => {
    throw new Error('the transcriber has no business in a flag');
  },
  ...over,
});

const bodyOf = (out: RelayResponse): Record<string, unknown> =>
  out.body.kind === 'json' ? (out.body.value as Record<string, unknown>) : {};
const messageOf = (out: RelayResponse): string =>
  String((bodyOf(out).error as { message?: unknown } | undefined)?.message ?? '');

describe('the flag route', () => {
  it('routeFor names the flag route from either host prefix', () => {
    expect(routeFor('/api/flag')).toBe('flag');
    expect(routeFor('/relay/flag')).toBe('flag');
    expect(routeFor('https://x.supabase.co/functions/v1/relay/flag')).toBe('flag');
  });

  it('a flag is kept for the verified user and answered 202', async () => {
    const store = createMemorySafetyEventStore();
    const out = await handleRelay(post(flag()), deps({ safetyEvents: store }));
    expect(out.status).toBe(202);
    expect(bodyOf(out)).toEqual({ kept: true });
    expect(store.kept).toEqual([
      {
        userId: USER,
        flag: {
          id: FLAG_ID,
          category: 'distress',
          direction: 'from-student',
          at: '2026-10-08T05:00:00.000Z',
          platform: 'web',
          release: 'abc1234',
        },
      },
    ]);
  });

  it('a body carrying any other key is refused, so no words can ride along', async () => {
    for (const extra of [{ note: 'x' }, { text: 'x' }, { lessonId: 'L1' }]) {
      const store = createMemorySafetyEventStore();
      const out = await handleRelay(post(flag(extra)), deps({ safetyEvents: store }));
      expect(out.status).toBe(400);
      expect(messageOf(out)).toBe('a flag carries no words: only id, category, direction, at, platform and release');
      expect(store.kept).toEqual([]);
    }
  });

  it('refuses a category other than distress, a wrong direction, a non-uuid id and a bad time', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ category: 'redirect' }, "a flag's category is distress"],
      [{ direction: 'sideways' }, "a flag's direction is from-student or to-student"],
      [{ id: 'not-a-uuid' }, 'a flag has a uuid'],
      [{ at: 'yesterday' }, 'a flag carries the time it was made, as ISO text'],
      [{ at: 12 }, 'a flag carries the time it was made, as ISO text'],
      [{ platform: 'ios' }, 'platform is "web" or "android"'],
      [{ release: '' }, 'release must be short text'],
      [{ release: 'x'.repeat(101) }, 'release must be short text'],
    ];
    for (const [over, message] of cases) {
      const out = await handleRelay(post(flag(over)), deps());
      expect(out.status, JSON.stringify(over)).toBe(400);
      expect(messageOf(out)).toBe(message);
    }
    const notJson = await handleRelay({ ...post(flag()), body: new TextEncoder().encode('{nope') }, deps());
    expect(notJson.status).toBe(400);
    expect(messageOf(notJson)).toBe('that is not JSON');
    const notObject = await handleRelay(post([1, 2]), deps());
    expect(messageOf(notObject)).toBe('a flag is an object');
  });

  it('a retry answers 202 with kept false', async () => {
    const store = createMemorySafetyEventStore();
    expect(bodyOf(await handleRelay(post(flag()), deps({ safetyEvents: store })))).toEqual({ kept: true });
    const again = await handleRelay(post(flag()), deps({ safetyEvents: store }));
    expect(again.status).toBe(202);
    expect(bodyOf(again)).toEqual({ kept: false });
    expect(store.kept).toHaveLength(1);
  });

  it('the kill switch and a halted or capped meter do not stop a flag; a rate refusal does', async () => {
    expect((await handleRelay(post(flag()), deps({ disabled: true }))).status).toBe(202);
    for (const reason of ['halted', 'capped', 'budget'] as const) {
      const out = await handleRelay(
        post(flag()),
        deps({ gate: gate({ ledger: { async claim() { return { allowed: false, reason, retryAfterSeconds: 300 }; } } }) }),
      );
      expect(out.status, reason).toBe(202);
    }
    const rate = await handleRelay(
      post(flag()),
      deps({ gate: gate({ ledger: { async claim() { return { allowed: false, reason: 'rate', retryAfterSeconds: 30 }; } } }) }),
    );
    expect(rate.status).toBe(429);
    const down = await handleRelay(
      post(flag()),
      deps({ gate: gate({ ledger: { async claim() { return { allowed: false, reason: 'unavailable', retryAfterSeconds: 5 }; } } }) }),
    );
    expect(down.status).toBe(503);
  });

  it('without a store it is 501; without a sign-in 401; too large 413; GET 405', async () => {
    const none = await handleRelay(post(flag()), deps({ safetyEvents: undefined }));
    expect(none.status).toBe(501);
    expect(messageOf(none)).toBe('this host cannot take a flag');
    expect((await handleRelay({ ...post(flag()), headers: {} }, deps())).status).toBe(401);
    expect((await handleRelay({ ...post(flag()), headers: {} }, deps({ disabled: true }))).status).toBe(401);
    const big = await handleRelay(post(flag({ release: 'x'.repeat(2000) })), deps());
    expect(big.status).toBe(413);
    expect((await handleRelay({ ...post(flag()), method: 'GET' }, deps())).status).toBe(405);
  });

  it('when the store cannot keep it, 503 says the app keeps it', async () => {
    const out = await handleRelay(post(flag()), deps({ safetyEvents: { async keep() { return null; } } }));
    expect(out.status).toBe(503);
    expect(messageOf(out)).toBe('the flag was not kept this second; the app keeps it and sends it again');
  });
});

describe('createSupabaseSafetyEventStore', () => {
  it('the deployed store calls keep_safety_event with the service role and reads true, false and null', async () => {
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    let answer: unknown = true;
    const store = createSupabaseSafetyEventStore('https://x.supabase.co', 'service-key', async (url, init) => {
      calls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const f = { id: FLAG_ID, category: 'distress' as const, direction: 'to-student' as const, at: '2026-10-08T05:00:00.000Z' };

    expect(await store.keep(USER, f)).toEqual({ fresh: true });
    expect(calls[0].url).toBe('https://x.supabase.co/rest/v1/rpc/keep_safety_event');
    expect(calls[0].headers.apikey).toBe('service-key');
    expect(calls[0].headers.authorization).toBe('Bearer service-key');
    expect(calls[0].body).toEqual({
      p_user: USER,
      p_id: FLAG_ID,
      p_category: 'distress',
      p_direction: 'to-student',
      p_platform: null,
      p_release: null,
      p_at: '2026-10-08T05:00:00.000Z',
    });
    answer = false;
    expect(await store.keep(USER, f)).toEqual({ fresh: false });
    answer = null;
    expect(await store.keep(USER, f)).toBeNull();

    const failing = createSupabaseSafetyEventStore('https://x.supabase.co', 'k', async () => new Response('no', { status: 500 }));
    expect(await failing.keep(USER, f)).toBeNull();
    const throwing = createSupabaseSafetyEventStore('https://x.supabase.co', 'k', async () => {
      throw new Error('down');
    });
    expect(await throwing.keep(USER, f)).toBeNull();
  });
});
