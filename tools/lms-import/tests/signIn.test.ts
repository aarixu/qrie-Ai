// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLOSED, LOCKED, NETWORK_LIMIT, WRONG_PIN } from '../../../packages/lms-client/src/backend.ts';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { asService, freshDatabase } from '../../../supabase/tests/harness.ts';
import { authPassword, guardPin } from '../src/pinGuard.ts';
import { clientIp, handleSignIn, type SignInDeps } from '../src/signIn.ts';

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

  it('is read from the first address of x-forwarded-for; without a usable one there is no per-network count', async () => {
    expect(clientIp('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
    expect(clientIp(' 2001:DB8::1 ')).toBe('2001:db8::1');
    expect(clientIp(null)).toBeUndefined();
    expect(clientIp('')).toBeUndefined();
    expect(clientIp('<script>, 10.0.0.1')).toBeUndefined();
    const before = (await db.query<{ n: number }>(`select count(*)::int n from lms.sign_in_ip`)).rows[0].n;
    await signIn('SIG-999', '123456');
    expect((await db.query<{ n: number }>(`select count(*)::int n from lms.sign_in_ip`)).rows[0].n).toBe(before);
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
