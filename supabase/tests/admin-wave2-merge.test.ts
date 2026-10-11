// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { setLicence } from './admin-school-fixtures.ts';
import { makeFinance, rpc } from './billing-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { asClaims, asService, freshDatabase, type JwtClaims } from './harness.ts';
import { keepFlag } from './safety-fixtures.ts';

/**
 * WAVE 2 TOGETHER: PLAN 4 (THE APPS OBEY THE CONSOLE) AND PLAN 5 (SAFETY,
 * CLASSES AND PRIVACY), AND MIGRATION 0070. Written first.
 *
 * Each test here only makes sense with both plans' migrations applied: plan
 * 4's import gate asking plan 5's privacy decision (seam T2), plan 4's Today
 * reading plan 5's distress capture (0070), plan 4's tutor admission meeting
 * plan 5's flag route, and plan 5's migrations leaving the earlier rules of
 * claim_relay, app_config, flag_set and set_halt alone (seam T11).
 *
 * The database is HOSTED: plan 5's privacy gate answers only on HOSTED and
 * STAGING (its ruling R13).
 */

// The sentences of 0066 (admin.privacy_import_refusal) and 0063 (admin.import_refusal).
const PRIVACY =
  "Qrie has not yet recorded who is responsible for this school's children's data and who is told if a child may be at risk. " +
  'The owner records both on the Privacy page; until then nobody can be added to this school.';
const LAPSED =
  "This school's licence has ended and its grace period is over, so no new people can be added until it is renewed.";

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let undecided: School;
let suspended: School;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db, 'HOSTED');
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  finance = await makeFinance(db, 'Accounts');
  undecided = await buildSchool(db, 'WVU');
  suspended = await buildSchool(db, 'WVS');
  await setLicence(db, 'WVS', 100, -20);
});
afterAll(async () => {
  await db.close();
});

const call = (claims: JwtClaims, sql: string, params: unknown[] = []) =>
  asClaims(db, claims, (tx) => tx.query(sql, params));
const staffGate = (claims: JwtClaims, code: string) =>
  call(claims, `select admin.api_gate('people-import', $1, '', 'term starts', 'HOSTED')`, [code]);
const lmsLane = (org: string) =>
  asService(db, async (tx) => (await tx.query<{ r: string | null }>(`select lms.import_refusal($1) as r`, [org])).rows[0].r);
const decide = (code: string) =>
  rpc(db, fresh(owner), 'school_privacy_set', {
    p_code: code,
    p_fiduciary: 'school',
    p_recipient: 'school',
    p_basis: "counsel's letter of 2026-11-02",
    p_reason: 'counsel answered',
    p_env: 'HOSTED',
  });

interface Today {
  contest: { entriesToday: number; dailyCap: number; entriesOpen: boolean };
  capture: { distress: string; lastPurge: string };
}
const today = async (claims: JwtClaims = aal2(ops)) =>
  asClaims(db, claims, async (tx) => (await tx.query<{ t: Today }>(`select admin.today() as t`)).rows[0].t);

describe("an import asks plan 5's privacy decision through plan 4's gate (seam T2)", () => {
  it('an undecided school is refused with the privacy sentence on both paths: staff through api_gate, the LMS lane through lms.import_refusal', async () => {
    expect((await db.query<{ r: string | null }>(`select admin.import_refusal($1) as r`, [undecided.org])).rows[0].r).toBe(PRIVACY);
    await expect(staffGate(fresh(owner), 'WVU')).rejects.toMatchObject({ message: PRIVACY });
    expect(await lmsLane(undecided.org)).toBe(PRIVACY);
  });

  it('a suspended school is told about its licence first, on both paths, whatever its privacy decision', async () => {
    await expect(staffGate(fresh(owner), 'WVS')).rejects.toMatchObject({ message: LAPSED });
    expect(await lmsLane(suspended.org)).toBe(LAPSED);
    await decide('WVS');
    await expect(staffGate(fresh(owner), 'WVS')).rejects.toMatchObject({ message: LAPSED });
    expect(await lmsLane(suspended.org)).toBe(LAPSED);
  });

  it('once both decisions are recorded, a school in good standing may import on both paths', async () => {
    await decide('WVU');
    expect(await lmsLane(undecided.org)).toBeNull();
    const v = (await staffGate(fresh(owner), 'WVU')).rows[0] as { api_gate: { orgId: string } };
    expect(v.api_gate.orgId).toBe(undecided.org);
  });
});

describe("Today reads plan 5's distress capture (0070)", () => {
  it('reads not captured until the first flag, then captured; the purge stays not captured', async () => {
    expect((await today()).capture).toEqual({ distress: 'not-captured', lastPurge: 'not-captured' });
    expect(await keepFlag(db, undecided.kid8a)).toBe(true);
    expect((await today()).capture).toEqual({ distress: 'captured', lastPurge: 'not-captured' });
    expect((await today(aal2(safety))).capture.distress).toBe('captured');
  });

  it("reads captured from the day the owner records, before any flag arrives", async () => {
    const other = await freshDatabase();
    try {
      await setEnvironment(other, 'HOSTED');
      const o = await makeStaff(other, 'owner', 'Aarav');
      const read = async () =>
        asClaims(other, aal2(o), async (tx) => (await tx.query<{ t: Today }>(`select admin.today() as t`)).rows[0].t.capture);
      expect((await read()).distress).toBe('not-captured');
      await asClaims(other, aal2(o), (tx) =>
        tx.query(`select admin.safety_capture_set(current_date, 'relay deployed', 'HOSTED')`),
      );
      expect((await read()).distress).toBe('captured');
    } finally {
      await other.close();
    }
  });

  it("keeps plan 4's contest lines: entries open and the switch's daily limit", async () => {
    expect((await today()).contest).toMatchObject({ entriesOpen: true, dailyCap: 2000 });
    const set = (key: string, value: unknown) =>
      call(fresh(owner), `select admin.flag_set($1, 'global', '', $2::jsonb, 'a reason', 'HOSTED')`, [key, JSON.stringify(value)]);
    await set('contest.daily_limit', 500);
    await set('contest.entries_open', false);
    expect((await today()).contest).toMatchObject({ entriesOpen: false, dailyCap: 500 });
    await set('contest.daily_limit', 2000);
    await set('contest.entries_open', true);
  });

  it('is still refused to finance and to a non-staff user', async () => {
    await expect(today(aal2(finance))).rejects.toThrow(/not allowed/);
    await expect(today({ sub: undecided.kid8a, aal: 'aal2' })).rejects.toThrow(/not allowed/);
  });
});

describe("plan 4's tutor admission meets plan 5's flag route", () => {
  it("a distress flag claim from a child at a switched-off school gets plan 4's halted answer, which the relay lets through", async () => {
    await call(fresh(owner), `select admin.flag_set('tutor.enabled', 'school', 'WVU', 'false'::jsonb, 'a reason', 'HOSTED')`);
    const claim = await asService(db, async (tx) =>
      (await tx.query<{ allowed: boolean; reason: string }>(`select * from public.claim_relay($1, 'flag', 0)`, [undecided.kid8a])).rows[0],
    );
    expect(claim).toMatchObject({ allowed: false, reason: 'halted' });
    await call(fresh(owner), `select admin.flag_set('tutor.enabled', 'school', 'WVU', 'true'::jsonb, 'a reason', 'HOSTED')`);
  });
});

describe('nothing in wave 2 recreates a seam function without its earlier rules (seam T11)', () => {
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const definers = (fn: string) => {
    const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+${fn.replace('.', '\\.')}\\s*\\(`, 'i');
    return files.filter((f) => re.test(readFileSync(dir + f, 'utf8'))).map((f) => f.slice(0, 4));
  };

  it('each seam function is last written by the migration that carries its rules', () => {
    expect(definers('public.claim_relay').at(-1)).toBe('0064'); // plan 4: a switched-off or suspended school is halted
    expect(definers('public.app_config').at(-1)).toBe('0060'); // plan 3: billing state, suspension turns the tutor off
    expect(definers('public.my_app_config').at(-1)).toBe('0064');
    // plan 2's R23 (tutor.enabled = true is the owner's), kept by 0075, which adds tutor.only_prepared = false.
    expect(definers('admin.flag_set')).toEqual(['0050', '0053', '0075']);
    expect(definers('admin.set_halt').at(-1)).toBe('0061'); // the stop is open to finance
    expect(definers('admin.privacy_import_refusal')).toEqual(['0063', '0066']); // T2: plan 4's stub, plan 5's gate
    expect(definers('admin.today')).toEqual(['0049', '0062', '0070']);
  });

  it('the rules still hold with every migration applied', async () => {
    // set_halt (0061): finance may stop, and only the owner with a fresh code resumes.
    await call(aal2(finance), `select admin.set_halt(true, 'a payment run looks wrong', 'HOSTED')`);
    await expect(call(fresh(ops), `select admin.set_halt(false, 'all clear', 'HOSTED')`)).rejects.toThrow(/not allowed/);
    await call(fresh(owner), `select admin.set_halt(false, 'all clear', 'HOSTED')`);
    // flag_set (0053, R23): ops may switch a school's tutor off, never on.
    await call(fresh(ops), `select admin.flag_set('tutor.enabled', 'school', 'WVU', 'false'::jsonb, 'a reason', 'HOSTED')`);
    await expect(
      call(fresh(ops), `select admin.flag_set('tutor.enabled', 'school', 'WVU', 'true'::jsonb, 'a reason', 'HOSTED')`),
    ).rejects.toThrow(/not allowed/);
    // app_config (0060): a suspended school reads tutor.enabled false.
    const config = async (code: string) =>
      (await db.query<{ c: Record<string, unknown> }>(`select public.app_config($1) as c`, [code])).rows[0].c;
    expect((await config('WVU'))['tutor.enabled']).toBe(false);
    expect((await config('WVS'))['tutor.enabled']).toBe(false);
    expect((await config('WVS'))['billing.state']).toBe('suspended');
    await call(fresh(owner), `select admin.flag_set('tutor.enabled', 'school', 'WVU', 'true'::jsonb, 'a reason', 'HOSTED')`);
    expect((await config('WVU'))['tutor.enabled']).toBe(true);
  });
});
