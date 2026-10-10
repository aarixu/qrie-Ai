// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLOSED, LOCKED, NETWORK_LIMIT, WRONG_PIN } from '../../../packages/lms-client/src/backend.ts';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { asService, freshDatabase } from '../../../supabase/tests/harness.ts';
import { authPassword, guardPin } from '../src/pinGuard.ts';
import { callerKey, handleSignIn, MAX_BODY, serveSignIn, type SignInDeps } from '../src/signIn.ts';

/**
 * THE HOSTED SIGN-IN'S GUARD (supabase/functions/lms-signin, migration 0046).
 * Written first.
 *
 * Supabase Auth has no per-ID lockout, so on the hosted project the browser
 * asks this guard first. It answers as the demo server's sign-in does
 * (tools/lms-demo/src/auth.ts) — the same words for an unknown ID and a wrong
 * PIN, five wrong PINs in a row lock the ID for fifteen minutes, right PIN or
 * not — and only for the right PIN hands back the account's Supabase Auth
 * password. Here it runs over the real migrations.
 */

const PEPPER = 'test-pepper-0123456789-abcdefghijklmnop';

let db: PGlite;
let one: School;

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const names = Object.keys(args);
  return asService(db, async (tx) => {
    const { rows } = await tx.query<{ v: unknown }>(
      `select lms.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
      names.map((n) => args[n]),
    );
    return rows[0]?.v ?? null;
  });
}

const deps: SignInDeps = { rpc, pepper: PEPPER };
const signIn = (loginId: unknown, pin: unknown, ip?: string) =>
  handleSignIn({ method: 'POST', body: JSON.stringify({ loginId, pin }), ...(ip ? { ip } : {}) }, deps);

/** A request as it reaches the lms-signin function, its body a stream with no declared length. */
const request = (headers: Record<string, string>, body: string | ReadableStream<Uint8Array> | null, method = 'POST') => ({
  method,
  headers: new Headers(headers),
  body: typeof body === 'string' ? new Response(body).body : body,
});
/** A sign-in through the function's door, from a caller with these headers. */
const signInWith = async (headers: Record<string, string>, loginId: string, pin: string) => {
  const res = await serveSignIn(request(headers, JSON.stringify({ loginId, pin })), deps);
  return { status: res.status, body: await res.json() };
};
const key = (headers: Record<string, string>) => callerKey(new Headers(headers));
/** 200 tries not proven right, counted under this key: its budget for the window, spent. */
const spend = async (ipKey: string | undefined, prefix: string) => {
  for (let i = 0; i < 200; i++) await rpc('pin_guard_try', { p_login: `${prefix}${i}`, p_ip: ipKey });
};
const ipRow = async (ipKey: string) =>
  (await db.query<{ failures: number }>(`select failures from lms.sign_in_ip where ip = $1`, [ipKey])).rows[0];

/** A new PIN for an ID, as the portal gives one: the count and any lock are cleared. */
const givePin = (user: string, loginId: string, pin: string) => guardPin(rpc, PEPPER, user, loginId, pin);

const guardRow = async (loginId: string) =>
  (
    await db.query<{ failures: number; locked_for: number | null }>(
      `select failures, extract(epoch from locked_until - now())::int as locked_for from lms.sign_in_guard where login_id = $1`,
      [loginId],
    )
  ).rows[0];

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'SIG');
});
afterAll(async () => {
  await db.close();
});
afterEach(() => vi.restoreAllMocks());

describe('the right PIN', () => {
  it('gets the account’s auth password back, and a wrong one gets the demo’s words and nothing else', async () => {
    await givePin(one.kid8a, 'SIG-101', '493817');
    expect(await signIn('sig-101', '493817')).toEqual({
      status: 200,
      body: { password: await authPassword(PEPPER, 'SIG-101', '493817') },
    });
    expect(await signIn('SIG-101', '493818')).toEqual({ status: 401, body: { error: WRONG_PIN } });
  });
});

describe('an unknown ID', () => {
  it('gets exactly what a wrong PIN gets, after the same work', async () => {
    await givePin(one.kid8b, 'SIG-102', '715284');
    const derive = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    const unknown = await signIn('SIG-999', '715284');
    const unknownWork = derive.mock.calls.length;
    const wrong = await signIn('SIG-102', '715285');
    expect(unknown).toEqual(wrong);
    expect(unknown).toEqual({ status: 401, body: { error: WRONG_PIN } });
    expect(unknownWork).toBe(1);
    expect(derive.mock.calls.length - unknownWork).toBe(1);
  });
});

describe('five wrong PINs in a row', () => {
  it('lock the ID for fifteen minutes, even against the right PIN', async () => {
    await givePin(one.kid8b, 'SIG-102', '715284');
    for (let i = 0; i < 5; i++) expect(await signIn('SIG-102', '000001')).toEqual({ status: 401, body: { error: WRONG_PIN } });
    expect(await signIn('SIG-102', '715284')).toEqual({ status: 401, body: { error: LOCKED } });
    const row = await guardRow('SIG-102');
    expect(row.locked_for).toBeGreaterThan(14 * 60);
    expect(row.locked_for).toBeLessThanOrEqual(15 * 60);
    // Fifteen minutes on, the right PIN works again.
    await db.query(`update lms.sign_in_guard set locked_until = now() - interval '1 second' where login_id = 'SIG-102'`);
    expect((await signIn('SIG-102', '715284')).status).toBe(200);
  });

  it('are counted afresh after a right PIN', async () => {
    await givePin(one.teacherA, 'SIG-T1', '58203917');
    for (let i = 0; i < 4; i++) await signIn('SIG-T1', '11111111');
    expect((await signIn('SIG-T1', '58203917')).status).toBe(200);
    expect(await guardRow('SIG-T1')).toMatchObject({ failures: 0, locked_for: null });
    for (let i = 0; i < 4; i++) expect(await signIn('SIG-T1', '11111111')).toEqual({ status: 401, body: { error: WRONG_PIN } });
    expect((await signIn('SIG-T1', '58203917')).status).toBe(200);
  });

  it('are counted before each PIN is checked, so tries sent all at once get five guesses and no more', async () => {
    await givePin(one.teacherB, 'SIG-T2', '69314825');
    const burst = await Promise.all(Array.from({ length: 12 }, () => signIn('SIG-T2', '22222222')));
    const said = burst.map((r) => (r.body as { error: string }).error);
    expect(said.filter((e) => e === WRONG_PIN)).toHaveLength(5);
    expect(said.filter((e) => e === LOCKED)).toHaveLength(7);
  });

  it('lock the ID even when no try was ever recorded as right or wrong: the count is taken up front', async () => {
    await givePin(one.teacherB, 'SIG-T2', '69314825');
    const verdicts: string[] = [];
    for (let i = 0; i < 6; i++) verdicts.push(((await rpc('pin_guard_try', { p_login: 'SIG-T2', p_ip: null })) as { verdict: string }).verdict);
    expect(verdicts).toEqual(['check', 'check', 'check', 'check', 'check', 'locked']);
  });

  it('are cleared by a new PIN', async () => {
    await givePin(one.teacherB, 'SIG-T2', '69314825');
    for (let i = 0; i < 5; i++) await signIn('SIG-T2', '22222222');
    expect(await signIn('SIG-T2', '69314825')).toEqual({ status: 401, body: { error: LOCKED } });
    await givePin(one.teacherB, 'SIG-T2', '81726354');
    expect((await signIn('SIG-T2', '81726354')).status).toBe(200);
    expect(await signIn('SIG-T2', '69314825')).toEqual({ status: 401, body: { error: WRONG_PIN } });
  });
});

describe('someone who has left the school (0034)', () => {
  it('is told the account is closed — only after the right PIN, as the demo does', async () => {
    const gone = await seat(db, one.org, 'student', 'SIG-103', 'Gone Kid');
    await givePin(gone, 'SIG-103', '384756');
    await db.query(`update lms.account set left_at = now() where user_id = $1`, [gone]);
    expect(await signIn('SIG-103', '384757')).toEqual({ status: 401, body: { error: WRONG_PIN } });
    expect(await signIn('SIG-103', '384756')).toEqual({ status: 401, body: { error: CLOSED } });
    for (let i = 0; i < 5; i++) await signIn('SIG-103', '384757');
    expect(await signIn('SIG-103', '384756')).toEqual({ status: 401, body: { error: LOCKED } });
  });
});

describe('one network', () => {
  it('gets 200 failed tries in 15 minutes, then is refused for any ID; other networks are not', async () => {
    const school = '203.0.113.7';
    await givePin(one.kid8a, 'SIG-101', '493817');
    for (let i = 0; i < 200; i++) {
      const v = (await rpc('pin_guard_try', { p_login: `SIG-X${i}`, p_ip: school })) as { verdict: string };
      expect(v.verdict).toBe('unknown');
    }
    expect(await signIn('SIG-101', '493817', school)).toEqual({ status: 429, body: { error: NETWORK_LIMIT } });
    // Refused before the ID was looked at, so the ID's own count is untouched.
    expect(await guardRow('SIG-101')).toMatchObject({ failures: 0 });
    expect((await signIn('SIG-101', '493817', '198.51.100.20')).status).toBe(200);
    // Once its window is over, the network starts again.
    await db.query(`update lms.sign_in_ip set window_start = now() - interval '16 minutes' where ip = $1`, [school]);
    expect((await signIn('SIG-101', '493817', school)).status).toBe(200);
  });

  it('is not held to the limit for right PINs: a whole school signs in from one address', async () => {
    const school = '198.51.100.9';
    await givePin(one.kid8a, 'SIG-101', '493817');
    await signIn('SIG-101', '000000', school);
    for (let i = 0; i < 3; i++) expect((await signIn('SIG-101', '493817', school)).status).toBe(200);
    const { rows } = await db.query<{ failures: number }>(`select failures from lms.sign_in_ip where ip = $1`, [school]);
    expect(rows).toEqual([{ failures: 1 }]);
  });

  it('is not held to the limit when neither header holds an address', async () => {
    expect(await key({})).toBeUndefined();
    expect(await key({ 'x-forwarded-for': '' })).toBeUndefined();
    expect(await key({ 'x-forwarded-for': '<script>, unknown', 'cf-connecting-ip': 'nobody' })).toBeUndefined();
    const before = (await db.query<{ n: number }>(`select count(*)::int n from lms.sign_in_ip`)).rows[0].n;
    expect(await signInWith({ 'x-forwarded-for': 'unknown' }, 'SIG-999', '123456')).toEqual({ status: 401, body: { error: WRONG_PIN } });
    expect((await db.query<{ n: number }>(`select count(*)::int n from lms.sign_in_ip`)).rows[0].n).toBe(before);
  });
});

describe('the key a try is counted under (callerKey)', () => {
  // A proxy appends the address it was reached from to x-forwarded-for, after
  // whatever the caller sent in it; so its first entry is the caller's to choose.
  it('cannot be another address’s for naming it first in x-forwarded-for: a forger spends a budget of their own, not the school’s', async () => {
    const school = '203.0.113.50';
    await givePin(one.kid8a, 'SIG-101', '493817');
    const schoolKey = await key({ 'x-forwarded-for': school });
    const forgerKey = await key({ 'x-forwarded-for': `${school}, 198.51.100.66` });
    expect(schoolKey).toBe(school);
    expect(forgerKey).not.toBe(schoolKey);
    await spend(forgerKey, 'SIG-F');
    // The forger, even with a right PIN, is refused; the school is not.
    expect(await signInWith({ 'x-forwarded-for': `${school}, 198.51.100.66` }, 'SIG-101', '493817')).toEqual({
      status: 429,
      body: { error: NETWORK_LIMIT },
    });
    expect((await signInWith({ 'x-forwarded-for': school }, 'SIG-101', '493817')).status).toBe(200);
    expect(await ipRow(school)).toEqual({ failures: 0 });
  });

  it('is cf-connecting-ip, when that holds an address, whatever x-forwarded-for says', async () => {
    expect(await key({ 'cf-connecting-ip': '198.51.100.5', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })).toBe('198.51.100.5');
    // Not an address there: the chain is used.
    expect(await key({ 'cf-connecting-ip': 'nobody', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })).toBe('203.0.113.7,10.0.0.1');
    await givePin(one.kid8a, 'SIG-101', '493817');
    expect((await signInWith({ 'cf-connecting-ip': '198.51.100.77', 'x-forwarded-for': '203.0.113.77' }, 'SIG-101', '000000')).status).toBe(401);
    expect(await ipRow('198.51.100.77')).toEqual({ failures: 1 });
    expect(await ipRow('203.0.113.77')).toBeUndefined();
  });

  it('is an IPv6 address’s /64, so every address in one /64 shares one budget', async () => {
    const mine = await key({ 'cf-connecting-ip': '2001:DB8:1:2::1' });
    expect(mine).toBe('2001:db8:1:2::/64');
    expect(await key({ 'cf-connecting-ip': '2001:0db8:0001:0002:ffff:ffff:ffff:ffff' })).toBe(mine);
    expect(await key({ 'cf-connecting-ip': '2001:db8:1:3::1' })).toBe('2001:db8:1:3::/64');
    expect(await key({ 'x-forwarded-for': '2001:db8:1:2::7, 2001:db8:9:9:1:2:3:4' })).toBe('2001:db8:1:2::/64,2001:db8:9:9::/64');
    // IPv4 written as IPv6 is IPv4.
    expect(await key({ 'cf-connecting-ip': '::ffff:198.51.100.5' })).toBe('198.51.100.5');
    await givePin(one.kid8a, 'SIG-101', '493817');
    await spend(mine, 'SIG-V');
    expect(await signInWith({ 'cf-connecting-ip': '2001:db8:1:2:abcd::5' }, 'SIG-101', '493817')).toEqual({
      status: 429,
      body: { error: NETWORK_LIMIT },
    });
    expect((await signInWith({ 'cf-connecting-ip': '2001:db8:1:3::1' }, 'SIG-101', '493817')).status).toBe(200);
  });

  it('is a SHA-256 when the chain is longer than the 64 characters the table keeps, so a forger who copies a long chain’s opening does not share it', async () => {
    const chain = '2001:db8:aaaa:bbbb::1, 2001:db8:cccc:dddd::1, 2001:db8:eeee:ffff::1';
    const real = await key({ 'x-forwarded-for': chain });
    const copied = await key({ 'x-forwarded-for': `${chain}, 198.51.100.66` });
    expect(real).toMatch(/^[0-9a-f]{64}$/);
    expect(copied).toMatch(/^[0-9a-f]{64}$/);
    expect(copied).not.toBe(real);
    await givePin(one.kid8a, 'SIG-101', '493817');
    await spend(copied, 'SIG-L');
    expect((await signInWith({ 'x-forwarded-for': chain }, 'SIG-101', '493817')).status).toBe(200);
  });
});

describe('the function’s door (serveSignIn)', () => {
  const expectHeaders = (res: Response) => {
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('application/json');
  };
  /** A stream of `total` spaces in 100-byte chunks, counting what has been taken from it. */
  const spaces = (total: number) => {
    const counter = { sent: 0 };
    // highWaterMark 0: nothing is taken until it is read.
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          if (counter.sent >= total) return c.close();
          counter.sent += 100;
          c.enqueue(new Uint8Array(100).fill(0x20));
        },
      },
      { highWaterMark: 0 },
    );
    return { stream, counter };
  };

  it('reads a body with no declared length only until it is past the limit, and refuses it', async () => {
    const { stream, counter } = spaces(100_000);
    const res = await serveSignIn(request({}, stream), deps);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'That request is too large.' });
    expectHeaders(res);
    expect(counter.sent).toBeLessThanOrEqual(MAX_BODY + 300);
  });

  it('refuses a body whose declared length is over the limit without reading it', async () => {
    const { stream, counter } = spaces(1_000);
    const res = await serveSignIn(request({ 'content-length': '1000' }, stream), deps);
    expect(res.status).toBe(413);
    expectHeaders(res);
    expect(counter.sent).toBe(0);
  });

  it('answers a body that breaks off while being read with 400 and its headers, not a crash', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"loginId":"SIG-1'));
      },
      pull(c) {
        c.error(new TypeError('connection reset'));
      },
    });
    const res = await serveSignIn(request({}, broken), deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'That request could not be read.' });
    expectHeaders(res);
  });

  it('sends its headers with every other answer', async () => {
    await givePin(one.kid8a, 'SIG-101', '493817');
    for (const res of [
      await serveSignIn(request({}, JSON.stringify({ loginId: 'SIG-101', pin: '493817' })), deps),
      await serveSignIn(request({}, JSON.stringify({ loginId: 'SIG-101', pin: '000000' })), deps),
      await serveSignIn(request({}, 'not json'), deps),
      await serveSignIn(request({}, null, 'GET'), deps),
    ]) {
      expectHeaders(res);
    }
  });
});

describe('what is not a sign-in', () => {
  it('is refused without looking anything up', async () => {
    await givePin(one.kid8a, 'SIG-101', '493817');
    const post = (body: string) => handleSignIn({ method: 'POST', body }, deps);
    expect(await handleSignIn({ method: 'GET', body: '' }, deps)).toEqual({ status: 405, body: { error: 'POST only.' } });
    expect(await post('x'.repeat(513))).toEqual({ status: 413, body: { error: 'That request is too large.' } });
    for (const body of ['not json', '[]', '{"loginId":5,"pin":"493817"}', '{"loginId":"SIG-101"}']) {
      expect(await post(body)).toEqual({ status: 400, body: { error: 'Enter your ID and PIN.' } });
    }
    // No ID or PIN of these shapes exists: the demo's words, and nothing counted.
    for (const [id, pin] of [['SIG-101', '12345'], ['SIG-101', '123456789'], ['SIG-101', '49381a'], ['S', '493817'], ['SIG 101', '493817']]) {
      expect(await signIn(id, pin)).toEqual({ status: 401, body: { error: WRONG_PIN } });
    }
    expect(await guardRow('SIG-101')).toMatchObject({ failures: 0 });
  });
});

describe('the guard in the database', () => {
  const as = (role: 'anon' | 'authenticated', sql: string) =>
    db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      return tx.query(sql);
    });

  it('is the service role’s alone: no browser may call its functions or read its tables', async () => {
    for (const fn of ['pin_guard_try(text, text)', 'pin_guard_passed(text, text)', 'pin_guard_set(uuid, text, text, text)']) {
      const { rows } = await db.query<{ exists: boolean }>(`select to_regprocedure($1) is not null as exists`, [`lms.${fn}`]);
      expect(rows[0].exists).toBe(true);
    }
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(as(role, `select lms.pin_guard_try('SIG-101', null)`)).rejects.toThrow(/permission denied/);
      await expect(as(role, `select lms.pin_guard_passed('SIG-101', null)`)).rejects.toThrow(/permission denied/);
      await expect(
        as(role, `select lms.pin_guard_set('${one.kid8a}', 'SIG-101', '${'0'.repeat(32)}', '${'0'.repeat(64)}')`),
      ).rejects.toThrow(/permission denied/);
      await expect(as(role, `select * from lms.sign_in_guard`)).rejects.toThrow(/permission denied/);
      await expect(as(role, `select * from lms.sign_in_ip`)).rejects.toThrow(/permission denied/);
    }
  });

  it('writes a row only for the account the ID belongs to', async () => {
    await expect(rpc('pin_guard_set', { p_user: one.kid8b, p_login: 'SIG-101', p_salt: '0'.repeat(32), p_verifier: '0'.repeat(64) })).rejects.toThrow(
      /SIG-101/,
    );
  });
});
