// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { setLicence } from './admin-school-fixtures.ts';
import { buildSchool } from './fixtures.ts';
import { asClaims, asService, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * NO NEW PEOPLE FOR A SCHOOL THAT MAY NOT TAKE THEM (migration 0063). Written
 * first.
 *
 * admin.import_refusal answers NULL when a school may import people, or one
 * sentence saying why not: offboarded, suspended or ended, and (plan 5, seam
 * T2) the school's privacy decision through admin.privacy_import_refusal.
 * Staff reach it through admin.api_gate, the LMS lane through lms.import_refusal.
 */

const OFFBOARDED = 'This school is offboarded from Qrie, so no new people can be added.';
const LAPSED =
  "This school's licence has ended and its grace period is over, so no new people can be added until it is renewed.";

let db: PGlite;
let owner: Staff;
let ops: Staff;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
});
afterAll(async () => {
  await db.close();
});

const refusal = async (org: string) =>
  (await db.query<{ r: string | null }>(`select admin.import_refusal($1) as r`, [org])).rows[0].r;
const gate = (claims: JwtClaims, action: string, code: string) =>
  asClaims(db, claims, async (tx) =>
    (
      await tx.query<{ v: { actor: string; orgId: string } }>(
        `select admin.api_gate($1, $2, '', 'term starts', 'TEST') as v`,
        [action, code],
      )
    ).rows[0].v,
  );
const offboard = (org: string) =>
  db.query(`insert into admin.school_profile (org_id, offboarded_at) values ($1, now())`, [org]);
const requested = async () =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n from admin.audit_event where action = 'people-import-requested'`,
    )
  ).rows[0].n;
const can = async (role: string, fn: string) =>
  (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).rows[0].ok;

describe('whether a school may import people', () => {
  it('a school in good standing may import', async () => {
    const s = await buildSchool(db, 'IMOK');
    expect(await refusal(s.org)).toBeNull();
    await setLicence(db, 'IMOK', 100, 30);
    expect(await refusal(s.org)).toBeNull();
    await setLicence(db, 'IMOK', 100, -3);
    expect(await refusal(s.org)).toBeNull();
  });

  it('an offboarded school may not, and is told why', async () => {
    const s = await buildSchool(db, 'IMOF');
    await offboard(s.org);
    expect(await refusal(s.org)).toBe(OFFBOARDED);
  });

  it('a suspended or ended school may not, and is told why', async () => {
    const su = await buildSchool(db, 'IMSU');
    await setLicence(db, 'IMSU', 100, -20);
    expect(await refusal(su.org)).toBe(LAPSED);
    const en = await buildSchool(db, 'IMEN');
    await setLicence(db, 'IMEN', 100, -100);
    expect(await refusal(en.org)).toBe(LAPSED);
  });

  it('the privacy decision is asked last, through its own function (seam T2)', async () => {
    const good = await buildSchool(db, 'IMPR');
    const gone = await buildSchool(db, 'IMPO');
    await offboard(gone.org);
    expect((await db.query<{ r: string | null }>(`select admin.privacy_import_refusal($1) as r`, [good.org])).rows[0].r).toBeNull();
    await db.exec(
      `create or replace function admin.privacy_import_refusal(p_org uuid) returns text
         language sql stable security definer set search_path = admin, public
         as $$ select 'privacy undecided'::text $$`,
    );
    try {
      expect(await refusal(good.org)).toBe('privacy undecided');
      expect(await refusal(gone.org)).toBe(OFFBOARDED);
    } finally {
      await db.exec(
        `create or replace function admin.privacy_import_refusal(p_org uuid) returns text
           language sql stable security definer set search_path = admin, public
           as $$ select null::text $$`,
      );
    }
    expect(await refusal(good.org)).toBeNull();
  });

  it('the gate refuses staff an import for such a school with the same sentence, and still lets them check a sheet', async () => {
    const off = await buildSchool(db, 'IMGO');
    await offboard(off.org);
    const before = await requested();
    await expect(gate(fresh(ops), 'people-import', 'IMSU')).rejects.toMatchObject({ message: LAPSED });
    await expect(gate(fresh(ops), 'people-import', 'IMGO')).rejects.toMatchObject({ message: OFFBOARDED });
    await expect(gate(fresh(ops), 'people-import', 'IMGO')).rejects.toThrow(/offboarded/);
    const su = (await db.query<{ org_id: string }>(`select org_id from lms.school where code = 'IMSU'`)).rows[0].org_id;
    expect(await gate(aal2(ops), 'people-preview', 'IMSU')).toEqual({ actor: ops.id, orgId: su });
    expect(await requested()).toBe(before);
    // A school in good standing is still let through, and logged as before.
    await gate(fresh(owner), 'people-import', 'IMOK');
    expect(await requested()).toBe(before + 1);
  });

  it("the school admin's import code reaches it through one service-role door", async () => {
    const su = (await db.query<{ org_id: string }>(`select org_id from lms.school where code = 'IMSU'`)).rows[0].org_id;
    const answer = await asService(
      db,
      async (tx) => (await tx.query<{ r: string | null }>(`select lms.import_refusal($1) as r`, [su])).rows[0].r,
    );
    expect(answer).toBe(LAPSED);
    expect(await can('authenticated', 'lms.import_refusal(uuid)')).toBe(false);
    expect(await can('anon', 'lms.import_refusal(uuid)')).toBe(false);
    expect(await can('service_role', 'lms.import_refusal(uuid)')).toBe(true);
  });

  it('the admin helpers are internal', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(await can(role, 'admin.import_refusal(uuid)'), role).toBe(false);
      expect(await can(role, 'admin.privacy_import_refusal(uuid)'), role).toBe(false);
    }
  });
});
