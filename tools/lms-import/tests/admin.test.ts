// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLicence } from '../../../supabase/tests/admin-school-fixtures.ts';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { asService, freshDatabase } from '../../../supabase/tests/harness.ts';
import { handleAdmin, type AdminDeps } from '../src/admin.ts';
import { pgliteStore } from '../src/pgliteStore.ts';

/**
 * THE HOSTED SCHOOL PORTAL'S ADMIN CALLS (supabase/functions/lms-admin,
 * migration 0046). Written first.
 *
 * On the hosted project a browser cannot create a sign-in: that takes the
 * service role, which only the server holds. This handler does what the demo
 * server does for the admin — add people from the sheets, give a new PIN, give
 * a parent a sign-in — checking every time, on the server, that the caller is
 * their school's admin. Here it runs over the real migrations, with a
 * stand-in for the identity service and the auth admin API.
 */

let db: PGlite;
let one: School;
const passwords = new Map<string, string>();
const rpcCalls: string[] = [];
const tokens: Record<string, string> = {};

function deps(): AdminDeps {
  const base = pgliteStore(db);
  return {
    verify: async (header) => {
      const user = header?.startsWith('Bearer ') ? tokens[header.slice(7)] : undefined;
      return user ? { ok: true, user: { userId: user } } : { ok: false, status: 401, why: 'that sign-in is not valid' };
    },
    rpc: async (fn, args) => {
      rpcCalls.push(fn);
      const names = Object.keys(args);
      return asService(db, async (tx) => {
        const { rows } = await tx.query<{ v: unknown }>(
          `select lms.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
          names.map((n) => args[n]),
        );
        return rows[0]?.v ?? null;
      });
    },
    store: {
      ...base,
      async createAccount(a) {
        passwords.set(a.loginId, a.password);
        return base.createAccount(a);
      },
    },
    auth: {
      async setPassword(userId, password) {
        const login = (await db.query<{ login_id: string }>(`select login_id from lms.account where user_id = $1`, [userId])).rows[0];
        passwords.set(login.login_id, password);
      },
    },
  };
}

const call = (path: string, body: unknown, as = 'admin-token', method = 'POST') =>
  handleAdmin({ method, path, authorization: as ? `Bearer ${as}` : undefined, body }, deps());

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'HOS');
  tokens['admin-token'] = one.admin;
  tokens['teacher-token'] = one.teacherA;
  tokens['student-token'] = one.kid8a;
});
afterAll(async () => {
  await db.close();
});

describe('who may call', () => {
  it('is the school admin only, signed in', async () => {
    const sheet = { students: 'grade,section,roll,name\n8,A,5,Asha Rao\n' };
    expect(await call('/import', sheet, '')).toMatchObject({ status: 401 });
    expect(await call('/import', sheet, 'forged')).toMatchObject({ status: 401 });
    expect(await call('/import', sheet, 'teacher-token')).toEqual({ status: 403, body: { error: 'Only the school admin can add people.' } });
    expect(await call('/import', sheet, 'student-token')).toMatchObject({ status: 403 });
    // An admin who has left the school (0034) is an admin no longer.
    const gone = await seat(db, one.org, 'admin', 'HOS-A9', 'Former Admin');
    await db.query(`update lms.account set left_at = now() where user_id = $1`, [gone]);
    await db.query(`delete from public.membership where user_id = $1`, [gone]);
    tokens['gone-token'] = gone;
    expect(await call('/import', sheet, 'gone-token')).toMatchObject({ status: 403 });
    expect(await call('/nowhere', sheet)).toMatchObject({ status: 404 });
    expect(await call('/import', sheet, 'admin-token', 'GET')).toMatchObject({ status: 405 });
  });
});

describe('adding people from the sheets', () => {
  it('checks without creating anybody, then creates them with a PIN as their password', async () => {
    const sheet = { students: 'grade,section,roll,name\n8,A,5,Asha Rao\n8,B,6,Dev Singh\n' };
    const check = await call('/import', sheet);
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ committed: false, errors: [], created: [] });
    expect(passwords.size).toBe(0);

    const done = await call('/import', { ...sheet, commit: true, acceptWarnings: true });
    const body = done.body as { committed: boolean; created: { loginId: string; pin: string; className?: string }[] };
    expect(body.committed).toBe(true);
    expect(body.created.map((c) => [c.loginId, c.className])).toEqual([
      ['HOS-8A-5', '8A'],
      ['HOS-8B-6', '8B'],
    ]);
    for (const c of body.created) expect(passwords.get(c.loginId)).toBe(c.pin);
    const audit = await db.query<{ actor: string; action: string; target: string }>(
      `select actor, action, target from lms.audit_event where action = 'people-added'`,
    );
    expect(audit.rows).toEqual([{ actor: one.admin, action: 'people-added', target: '2 people' }]);
  });

  it('asks for the warnings to be accepted first, and reports a sheet’s mistakes without creating anybody', async () => {
    const warned = await call('/import', { students: 'grade,section,roll,name\n9,C,1,New Class Kid\n', commit: true });
    expect(warned).toEqual({ status: 400, body: { error: 'Read and accept the warnings first.' } });
    const wrong = await call('/import', { students: 'grade,section,roll,name\n8,A,,No Roll\n', commit: true, acceptWarnings: true });
    expect(wrong.status).toBe(200);
    expect((wrong.body as { committed: boolean; errors: string[] }).committed).toBe(false);
    expect((wrong.body as { errors: string[] }).errors.length).toBeGreaterThan(0);
    await expect(call('/import', { students: 42 })).resolves.toMatchObject({ status: 400 });
  });
});

describe('a new PIN', () => {
  it('replaces the password, ends every session, and is in the activity log', async () => {
    const r = await call('/reset-pin', { loginId: 'hos-8a-5' });
    expect(r.status).toBe(200);
    const body = r.body as { loginId: string; displayName: string; pin: string };
    expect(body).toMatchObject({ loginId: 'HOS-8A-5', displayName: 'Asha Rao' });
    expect(passwords.get('HOS-8A-5')).toBe(body.pin);
    expect(rpcCalls).toContain('end_sessions');
    const audit = await db.query(`select 1 from lms.audit_event where action = 'pin-reset' and target = 'HOS-8A-5' and actor = $1`, [one.admin]);
    expect(audit.rows).toHaveLength(1);
    expect(await call('/reset-pin', { loginId: 'NOPE-1' })).toMatchObject({ status: 404 });
    expect(await call('/reset-pin', { loginId: 'HOS-8A-5' }, 'teacher-token')).toMatchObject({ status: 403 });
  });
});

describe("a parent's sign-in", () => {
  it('is a parent account with the next P-number and an 8-digit PIN, linked to the child', async () => {
    const first = await call('/add-parent', { studentLoginId: 'HOS-101', displayName: ' Sunita  Sharma ' });
    expect(first.status).toBe(200);
    const p = first.body as { loginId: string; displayName: string; pin: string };
    expect(p).toMatchObject({ loginId: 'HOS-P1', displayName: 'Sunita Sharma' });
    expect(p.pin).toMatch(/^[1-9]\d{7}$/);
    expect(passwords.get('HOS-P1')).toBe(p.pin);
    const linked = await db.query(
      `select 1 from lms.guardian g join lms.account a on a.user_id = g.parent_user_id
        where a.login_id = 'HOS-P1' and a.kind = 'parent' and g.student_user_id = $1`,
      [one.kid8a],
    );
    expect(linked.rows).toHaveLength(1);
    const second = await call('/add-parent', { studentLoginId: 'HOS-102', displayName: 'Ravi Mehta' });
    expect((second.body as { loginId: string }).loginId).toBe('HOS-P2');
    const audit = await db.query(`select target from lms.audit_event where action = 'parent-added' order by at`);
    expect(audit.rows).toEqual([{ target: 'HOS-P1 HOS-101' }, { target: 'HOS-P2 HOS-102' }]);
  });

  it('is refused for anyone but a child of the school, without a name, and to anyone but the admin', async () => {
    expect(await call('/add-parent', { studentLoginId: 'HOS-T1', displayName: 'Asha Rao' })).toMatchObject({ status: 400 });
    expect(await call('/add-parent', { studentLoginId: 'HOS-101', displayName: ' ' })).toMatchObject({ status: 400 });
    expect(await call('/add-parent', { studentLoginId: 'NOPE-1', displayName: 'Asha Rao' })).toMatchObject({ status: 404 });
    expect(await call('/add-parent', { studentLoginId: 'HOS-101', displayName: 'Asha Rao' }, 'teacher-token')).toMatchObject({ status: 403 });
    const parents = await db.query(`select count(*)::int n from lms.account where kind = 'parent'`);
    expect(parents.rows[0]).toEqual({ n: 2 });
  });
});

describe('a school that may not import', () => {
  // The sentences of migration 0063 (admin.import_refusal).
  const LAPSED =
    "This school's licence has ended and its grace period is over, so no new people can be added until it is renewed.";
  const OFFBOARDED = 'This school is offboarded from Qrie, so no new people can be added.';
  const SHEET = 'grade,section,roll,name\n8,A,5,Asha Rao\n';
  const accounts = async (org: string) =>
    (await db.query<{ n: number }>(`select count(*)::int as n from lms.account where org_id = $1`, [org])).rows[0].n;

  it('the admin of a suspended school is told why when checking a sheet, and nobody is made', async () => {
    const su = await buildSchool(db, 'HSU');
    tokens['hsu-admin'] = su.admin;
    await setLicence(db, 'HSU', 100, -20);
    const before = await accounts(su.org);
    rpcCalls.length = 0;
    expect(await call('/import', { students: SHEET }, 'hsu-admin')).toEqual({ status: 409, body: { error: LAPSED } });
    expect(
      await call('/import', { students: SHEET, commit: true, acceptWarnings: true }, 'hsu-admin'),
    ).toEqual({ status: 409, body: { error: LAPSED } });
    expect(await accounts(su.org)).toBe(before);
    expect(rpcCalls).toContain('import_refusal');
    expect(rpcCalls).not.toContain('import_snapshot');
  });

  it('the admin of an offboarded school is told why', async () => {
    const off = await buildSchool(db, 'HOF');
    tokens['hof-admin'] = off.admin;
    await db.query(`insert into admin.school_profile (org_id, offboarded_at) values ($1, now())`, [off.org]);
    expect(await call('/import', { students: SHEET }, 'hof-admin')).toEqual({ status: 409, body: { error: OFFBOARDED } });
  });
});
