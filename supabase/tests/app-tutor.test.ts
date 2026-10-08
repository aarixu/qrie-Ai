// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { setLicence } from './admin-school-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { asClaims, asService, asUser, freshDatabase } from './harness.ts';

/**
 * THE TUTOR'S ADMISSION OBEYS THE SCHOOL'S SWITCH (migration 0064). Written
 * first.
 *
 * public.claim_relay refuses a class, before the window and the budgets, when
 * the learner's effective tutor.enabled is false: their school's own value,
 * else the platform's, and false while the school is suspended. The refusal
 * reads 'halted' (R1), which the relay already shows as a pause and lets a
 * report through. public.my_app_config gives the tutor app its learner's own
 * school's config.
 */

let db: PGlite;
let owner: Staff;
let toff: School;
let ton: School;
let tsus: School;
let tgra: School;
let anon: string;

const setFlag = (scope: 'school' | 'global', code: string, value: boolean) =>
  asClaims(db, fresh(owner), (tx) =>
    tx.query(`select admin.flag_set('tutor.enabled', $1, $2, $3::jsonb, 'a reason', 'TEST')`, [
      scope,
      code,
      JSON.stringify(value),
    ]),
  );
const setSchool = (code: string, value: boolean) => setFlag('school', code, value);
const setGlobal = (value: boolean) => setFlag('global', '', value);

interface Claim {
  allowed: boolean;
  reason: string | null;
  retry_after: number;
}
const claim = (user: string, relay = 'llm', units = 1) =>
  asService(db, async (tx) => (await tx.query<Claim>(`select * from public.claim_relay($1, $2, $3)`, [user, relay, units])).rows[0]);
const projectUnits = async () =>
  (await db.query<{ n: number }>(`select coalesce(sum(units), 0)::int as n from public.relay_budget_day`)).rows[0].n;
const can = async (role: string, fn: string) =>
  (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).rows[0].ok;
const appConfig = async (code: string | null) =>
  (await db.query<{ c: Record<string, unknown> }>(`select public.app_config($1) as c`, [code])).rows[0].c;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  await makeStaff(db, 'ops', 'Ops person');
  toff = await buildSchool(db, 'TOFF');
  ton = await buildSchool(db, 'TON');
  tsus = await buildSchool(db, 'TSUS');
  tgra = await buildSchool(db, 'TGRA');
  await setLicence(db, 'TSUS', 100, -20);
  await setLicence(db, 'TGRA', 100, -3);
  anon = await anonymousChild(db);
  await setSchool('TOFF', false);
});
afterAll(async () => {
  await db.close();
});

// Test setup writes the tables directly, as the database owner (as admin-relay.test.ts does).
beforeEach(async () => {
  await db.query(`update public.relay_control set halted = false, halted_reason = null, global_units_per_day = 50000`);
  await db.query(`delete from public.relay_budget_day`);
});

describe('the tutor admission', () => {
  it('a child at a school whose tutor is switched off is refused as halted, and spends nothing', async () => {
    const before = await projectUnits();
    expect(await claim(toff.kid8a)).toEqual({ allowed: false, reason: 'halted', retry_after: 300 });
    expect(await projectUnits()).toBe(before);
    const usage = await db.query<{ day_units: number }>(`select day_units from public.relay_usage where user_id = $1`, [
      toff.kid8a,
    ]);
    expect(usage.rows.every((r) => r.day_units === 0)).toBe(true);
  });

  it('a child at another school, and a child with no school, are not affected', async () => {
    expect(await claim(ton.kid8a)).toMatchObject({ allowed: true });
    expect(await claim(anon)).toMatchObject({ allowed: true });
  });

  it("a suspended school's children are refused; a school in grace is not", async () => {
    expect(await claim(tsus.kid8a)).toEqual({ allowed: false, reason: 'halted', retry_after: 300 });
    expect(await claim(tgra.kid8a)).toMatchObject({ allowed: true });
  });

  it("the platform's switch off refuses everyone except a school switched on by itself", async () => {
    await setGlobal(false);
    try {
      expect(await claim(anon)).toMatchObject({ allowed: false, reason: 'halted' });
      expect(await claim(ton.kid8a)).toMatchObject({ allowed: false, reason: 'halted' });
      await setSchool('TON', true);
      expect(await claim(ton.kid8a)).toMatchObject({ allowed: true });
    } finally {
      await setGlobal(true);
    }
    expect(await claim(ton.kid8a)).toMatchObject({ allowed: true });
    expect(await claim(anon)).toMatchObject({ allowed: true });
  });

  it('a report gets the same halted answer, which the relay lets through (packages/relay/src/gate.ts:338-342)', async () => {
    expect(await claim(toff.kid8a, 'report', 0)).toMatchObject({ allowed: false, reason: 'halted' });
  });

  it('the stop still comes first', async () => {
    await db.query(`update public.relay_control set halted = true`);
    expect(await claim(ton.kid8a)).toEqual({ allowed: false, reason: 'halted', retry_after: 300 });
  });

  it("claim_relay is still the service role's only", async () => {
    const fn = 'public.claim_relay(uuid, text, integer)';
    expect(await can('anon', fn)).toBe(false);
    expect(await can('authenticated', fn)).toBe(false);
    expect(await can('service_role', fn)).toBe(true);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(await can(role, 'admin.tutor_enabled_for(uuid)'), role).toBe(false);
    }
  });
});

describe('my_app_config', () => {
  it("is the caller's own school's config", async () => {
    const mine = await asUser(
      db,
      toff.kid8a,
      async (tx) => (await tx.query<{ c: Record<string, unknown> }>(`select public.my_app_config() as c`)).rows[0].c,
    );
    expect(mine).toEqual(await appConfig('TOFF'));
    expect(mine['tutor.enabled']).toBe(false);

    const suspended = await asUser(
      db,
      tsus.kid8a,
      async (tx) => (await tx.query<{ c: Record<string, unknown> }>(`select public.my_app_config() as c`)).rows[0].c,
    );
    expect(suspended['billing.state']).toBe('suspended');

    const anonymous = await asClaims(
      db,
      { sub: anon, is_anonymous: true },
      async (tx) => (await tx.query<{ c: Record<string, unknown> }>(`select public.my_app_config() as c`)).rows[0].c,
    );
    expect(anonymous).toEqual(await appConfig(null));

    const signedOut = await db.transaction(async (tx) => {
      await tx.exec('set local role anon');
      return (await tx.query<{ c: Record<string, unknown> }>(`select public.my_app_config() as c`)).rows[0].c;
    });
    expect(signedOut).toEqual(await appConfig(null));
  });
});
