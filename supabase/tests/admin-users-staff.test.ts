// @vitest-environment node
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { addHostedStandIns } from './admin-standins.ts';
import { buildSchool, type School } from './fixtures.ts';
import { asClaims, createUser, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * USERS AND STAFF (migration 0054). Written first.
 *
 * Pins: the second door (direct users: counted, found by at least 8
 * characters of their ID, a card with no name, phone or address, a block);
 * staff (M2: staff_set takes the environment and only an account made for
 * staff; an invitation is an inactive row; activation needs a verified
 * authenticator where factors are recorded; the roster); the gate admin-api
 * asks as the caller before it acts; and the owner's audit log viewer.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let child: string;
let permanent: string;
let s: School;
let staffMade: string;
beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  child = await anonymousChild(db);
  permanent = await createUser(db);
  s = await buildSchool(db, 'USR');
  staffMade = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
  await db.query(`insert into public.contest_signup (user_id, student_name, klass) values ($1, 'A child', 8)`, [child]);
  await db.query(
    `insert into public.consent_record (user_id, parent_name, parent_phone, source, otp_verified_at)
     values ($1, 'A parent', '+919999999999', 'contest', now())`,
    [permanent],
  );
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at)
     values (gen_random_uuid(), public.org_of($1), $1, 'class', now())`,
    [child],
  );
});
afterAll(async () => {
  await db.close();
});

const call = <T = unknown>(claims: JwtClaims, sql: string, params: unknown[] = []) =>
  asClaims(db, claims, async (tx) => (await tx.query<{ v: T }>(`select ${sql} as v`, params)).rows[0].v);
const rows = <T = Record<string, unknown>>(claims: JwtClaims, sql: string, params: unknown[] = []) =>
  asClaims(db, claims, async (tx) => (await tx.query<T>(`select * from ${sql}`, params)).rows);
const auditRows = async (action: string) =>
  (
    await db.query<{ id: number; actor: string; target_kind: string; target_id: string; reason: string; details: Record<string, unknown> }>(
      `select id, actor, target_kind, target_id, reason, details from admin.audit_event where action = $1 order by id`,
      [action],
    )
  ).rows;
const auditCount = async () => (await db.query<{ n: number }>(`select count(*)::int as n from admin.audit_event`)).rows[0].n;
const childClaims = async (): Promise<JwtClaims> => ({ sub: await anonymousChild(db), aal: 'aal2' });

const summary = (claims: JwtClaims = aal2(ops)) => call<Record<string, number>>(claims, `admin.direct_users_summary()`);
const find = (ref: string, claims: JwtClaims = aal2(ops)) => call<Record<string, unknown>[]>(claims, `admin.direct_user_find($1)`, [ref]);
const card = (user: string, claims: JwtClaims = aal2(ops)) => call<Record<string, unknown>>(claims, `admin.direct_user($1::uuid)`, [user]);
const block = (user: string, yes: boolean, reason = 'scripted abuse', env = 'TEST', claims: JwtClaims = aal2(ops)) =>
  call(claims, `admin.direct_user_block($1::uuid, $2, $3, $4)`, [user, yes, reason, env]);

describe('direct users (door 2)', () => {
  it('counts anonymous and permanent, created and active in 7 days, contest entries, consents and blocks; school and staff accounts are not counted', async () => {
    expect(await summary()).toEqual({
      total: 2,
      anonymous: 1,
      permanent: 1,
      createdLast7Days: 2,
      activeLast7Days: 1,
      withContestEntry: 1,
      withConsent: 1,
      blocked: 0,
    });
  });

  it('finds a user by at least 8 characters of their user ID, at most 5, with no name, phone or address', async () => {
    const found = await find(child.slice(0, 8));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ userId: child, ref: child.slice(0, 8) });
    await expect(find('abc')).rejects.toThrow(/at least the first 8 characters/);
    expect(await find(s.kid8a.slice(0, 8))).toEqual([]);
    const text = JSON.stringify(found) + JSON.stringify(await find(permanent.slice(0, 8)));
    for (const word of ['A child', '+919999999999', 'A parent']) expect(text).not.toContain(word);
  });

  it('a card: created, last active, sessions, school or none, contest entry and consent as yes or no', async () => {
    const today = (await db.query<{ d: string }>(`select to_char(lms.india_today(), 'YYYY-MM-DD') as d`)).rows[0].d;
    const c = await card(child);
    expect(c).toMatchObject({ anonymous: true, sessions: 1, schoolCode: null, contestEntry: true, consent: false, blocked: false });
    expect(c.lastActiveOn).toBe(today);
    await expect(card(s.kid8a)).rejects.toThrow(/not a direct user/);
  });

  it('blocking records it, signs them out and is audited; unblocking removes it; a school or staff account is refused', async () => {
    await block(child, true);
    expect((await db.query(`select 1 from admin.user_block where user_id = $1`, [child])).rows).toHaveLength(1);
    expect((await auditRows('user-blocked')).at(-1)).toMatchObject({ target_kind: 'user', target_id: child, reason: 'scripted abuse' });
    expect((await summary()).blocked).toBe(1);
    expect((await card(child)).blocked).toBe(true);

    await block(child, false, 'appeal');
    expect((await db.query(`select 1 from admin.user_block where user_id = $1`, [child])).rows).toHaveLength(0);
    expect((await auditRows('user-unblocked')).at(-1)).toMatchObject({ target_id: child, reason: 'appeal' });

    await expect(block(s.kid8a, true)).rejects.toThrow(/belongs to a school/);
    await expect(block(ops.id, true)).rejects.toThrow(/staff page/);
    await expect(block(child, true, 'scripted abuse', 'HOSTED')).rejects.toThrow(/this console is TEST/);
    await expect(block(child, true, '')).rejects.toThrow(/say why/);
  });

  it('the safety reviewer cannot read or block direct users', async () => {
    const reviewer = aal2(safety);
    await expect(summary(reviewer)).rejects.toThrow(/not allowed/);
    await expect(find(child.slice(0, 8), reviewer)).rejects.toThrow(/not allowed/);
    await expect(card(child, reviewer)).rejects.toThrow(/not allowed/);
    await expect(block(child, true, 'scripted abuse', 'TEST', reviewer)).rejects.toThrow(/not allowed/);
  });
});

const me = (who: string) => call<{ role: string }>(aal2({ id: who }), `admin.me()`);
const staffSet = (claims: JwtClaims, user: string, role: string, name: string, active: boolean, reason: string, env = 'TEST') =>
  call(claims, `admin.staff_set($1::uuid, $2, $3, $4, $5, $6)`, [user, role, name, active, reason, env]);
const invite = (claims: JwtClaims, user: string, role: string, name = 'Reviewer', reason = 'backup reviewer') =>
  call(claims, `admin.staff_invite($1::uuid, $2, $3, $4, 'TEST')`, [user, role, name, reason]);

describe('staff (M2)', () => {
  it('staff_set takes the environment and refuses an account not made for staff', async () => {
    await expect(staffSet(fresh(owner), permanent, 'ops', 'Someone', true, 'new ops')).rejects.toThrow(/only an account made for staff/);
    await expect(staffSet(fresh(owner), staffMade, 'ops', 'New', true, 'new ops', 'HOSTED')).rejects.toThrow(/this console is TEST/);
    await expect(
      call(fresh(owner), `admin.staff_set($1::uuid, 'ops', 'New', true, 'new ops')`, [staffMade]),
    ).rejects.toThrow(/does not exist/);
  });

  it("an invitation adds an inactive row for an account made for staff: the owner's, with a fresh code", async () => {
    await expect(invite(aal2(owner), staffMade, 'safety')).rejects.toThrow(/authenticator code/);
    await expect(invite(fresh(ops), staffMade, 'safety')).rejects.toThrow(/not allowed/);
    await invite(fresh(owner), staffMade, 'safety');
    const row = (await db.query<{ active: boolean; deactivated_at: Date | null; role: string }>(
      `select active, deactivated_at, role from admin.platform_staff where user_id = $1`,
      [staffMade],
    )).rows;
    expect(row).toEqual([{ active: false, deactivated_at: null, role: 'safety' }]);
    await expect(me(staffMade)).rejects.toThrow(/not allowed/);
    await expect(invite(fresh(owner), staffMade, 'safety')).rejects.toThrow(/already on the staff list/);
    const another = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    await expect(invite(fresh(owner), another, 'boss')).rejects.toThrow(/no staff role called boss/);
    await expect(invite(fresh(owner), permanent, 'ops')).rejects.toThrow(/only an account made for staff/);
    expect((await auditRows('staff-invited')).at(-1)).toMatchObject({ target_kind: 'staff', target_id: staffMade, details: { role: 'safety' } });
  });

  it('activation needs a verified authenticator where the platform records factors', async () => {
    await addHostedStandIns(db);
    const activate = () => staffSet(fresh(owner), staffMade, 'safety', 'Reviewer', true, 'confirmed by phone');
    await expect(activate()).rejects.toThrow(/not set up an authenticator/);
    await db.query(`insert into auth.mfa_factors (user_id, factor_type, status) values ($1, 'totp', 'unverified')`, [staffMade]);
    await expect(activate()).rejects.toThrow(/not set up an authenticator/);
    await db.query(`update auth.mfa_factors set status = 'verified' where user_id = $1`, [staffMade]);
    await activate();
    expect((await me(staffMade)).role).toBe('safety');
  });

  it("the roster shows active, invited, switched-off and made-but-never-added accounts, and each authenticator's state", async () => {
    const leaver = await makeStaff(db, 'ops', 'Leaver');
    await staffSet(fresh(owner), leaver.id, 'ops', 'Leaver', false, 'left');
    const invitee = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    await invite(fresh(owner), invitee, 'ops', 'Invitee', 'joining soon');
    const orphan = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    const roster = await rows<{ user_id: string; role: string | null; status: string; factor: string }>(aal2(owner), `admin.staff_roster()`);
    const of = (id: string) => roster.find((r) => r.user_id === id);
    expect(of(staffMade)).toMatchObject({ status: 'active', factor: 'verified' });
    expect(of(ops.id)).toMatchObject({ status: 'active', factor: 'none' });
    expect(of(leaver.id)).toMatchObject({ status: 'off' });
    expect(of(invitee)).toMatchObject({ status: 'invited' });
    expect(of(orphan)).toMatchObject({ status: 'account-only', role: null });
    await expect(rows(aal2(ops), `admin.staff_roster()`)).rejects.toThrow(/not allowed/);
  });
});

const gate = (claims: JwtClaims, action: string, code: string, target: string, reason: string, env: string) =>
  call<{ actor: string; orgId: string | null }>(claims, `admin.api_gate($1, $2, $3, $4, $5)`, [action, code, target, reason, env]);

describe('the gate admin-api asks first', () => {
  it('people-preview: ops or owner, no reason, nothing written', async () => {
    const before = await auditCount();
    expect(await gate(aal2(ops), 'people-preview', 'usr', '', '', '')).toEqual({ actor: ops.id, orgId: s.org });
    expect(await auditCount()).toBe(before);
    await expect(gate(aal2(safety), 'people-preview', 'USR', '', '', '')).rejects.toThrow(/not allowed/);
    await expect(gate(await childClaims(), 'people-preview', 'USR', '', '', '')).rejects.toThrow(/not allowed/);
    await expect(gate(aal2(ops), 'people-preview', 'NOPE', '', '', '')).rejects.toThrow(/no school with the code NOPE/);
  });

  it('people-import: a reason and the environment, logged as requested, and refused for an offboarded school', async () => {
    await gate(aal2(ops), 'people-import', 'USR', '', 'term starts', 'TEST');
    expect((await auditRows('people-import-requested')).at(-1)).toMatchObject({ target_kind: 'school', target_id: 'USR', reason: 'term starts' });
    await expect(gate(aal2(ops), 'people-import', 'USR', '', '', 'TEST')).rejects.toThrow(/say why/);
    await expect(gate(aal2(ops), 'people-import', 'USR', '', 'term starts', 'HOSTED')).rejects.toThrow(/this console is TEST/);
    const o = await buildSchool(db, 'USR2');
    await db.query(`insert into admin.school_profile (org_id, offboarded_at) values ($1, now())`, [o.org]);
    await expect(gate(aal2(ops), 'people-import', 'USR2', '', 'term starts', 'TEST')).rejects.toThrow(/offboarded/);
  });

  it('pin-reset: a fresh code, and the ID in the audit details', async () => {
    await expect(gate(aal2(ops), 'pin-reset', 'USR', 'usr-101', 'parent called', 'TEST')).rejects.toThrow(/authenticator code/);
    await expect(gate(fresh(ops), 'pin-reset', 'USR', 'usr-101', 'parent called', 'TEST')).resolves.toEqual({ actor: ops.id, orgId: s.org });
    expect((await auditRows('pin-reset-requested')).at(-1)).toMatchObject({ target_id: 'USR', details: { loginId: 'USR-101' } });
  });

  it('staff-invite: the owner with a fresh code; the email only as a hash', async () => {
    await expect(gate(fresh(ops), 'staff-invite', '', 'New.Person@Example.com', 'hire', 'TEST')).rejects.toThrow(/not allowed/);
    expect(await gate(fresh(owner), 'staff-invite', '', 'New.Person@Example.com', 'hire', 'TEST')).toEqual({ actor: owner.id, orgId: null });
    const row = (await auditRows('staff-invite-requested')).at(-1)!;
    expect(row.details).toEqual({ emailSha256: createHash('sha256').update('new.person@example.com').digest('hex') });
    expect(JSON.stringify(row).toLowerCase()).not.toContain('example.com');
  });

  it('an unknown action is refused, after the staff check', async () => {
    await expect(gate(aal2(ops), 'drop-tables', 'USR', '', 'why not', 'TEST')).rejects.toThrow(/no such action/);
    await expect(gate(await childClaims(), 'drop-tables', 'USR', '', 'why not', 'TEST')).rejects.toThrow(/not allowed/);
  });
});

describe('the audit log viewer', () => {
  it('owner only; filters by actor, action prefix and India dates; pages by id', async () => {
    type Row = { id: number; actor: string | null; action: string };
    const list = (args: string, params: unknown[] = []) => rows<Row>(aal2(owner), `admin.audit_list(${args})`, params);
    const all = await list('');
    expect(all.length).toBeGreaterThan(5);

    const byOps = await list('p_actor => $1::uuid', [ops.id]);
    expect(byOps.length).toBeGreaterThan(0);
    expect(byOps.every((r) => r.actor === ops.id)).toBe(true);

    const users = await list(`p_action => 'user-'`);
    expect([...new Set(users.map((r) => r.action))].sort()).toEqual(['user-blocked', 'user-unblocked']);

    const total = (await db.query<{ n: number }>(`select count(*)::int as n from admin.audit_event`)).rows[0].n;
    expect(await list('p_from => lms.india_today(), p_to => lms.india_today()')).toHaveLength(total);
    expect(await list('p_from => lms.india_today() + 1')).toEqual([]);

    const third = all[2].id;
    const older = await list('p_before => $1::bigint', [third]);
    expect(older.length).toBe(all.length - 3);
    expect(older.every((r) => Number(r.id) < Number(third))).toBe(true);
    expect(older.map((r) => Number(r.id))).toEqual([...older.map((r) => Number(r.id))].sort((a, b) => b - a));

    expect(await list('p_limit => 2')).toHaveLength(2);
    expect(await list(`p_action => '%'`)).toEqual([]);
    await expect(rows(aal2(ops), `admin.audit_list()`)).rejects.toThrow(/not allowed/);
  });
});
