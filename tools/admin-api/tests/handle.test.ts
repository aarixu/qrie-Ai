// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { asClaims, asService, freshDatabase, type JwtClaims } from '../../../supabase/tests/harness.ts';
import { Refused } from '../../lms-import/src/admin.ts';
import { pgliteStore } from '../../lms-import/src/pgliteStore.ts';
import { CallerError, handleAdminApi, SERVER_FAILED, type AdminApiDeps } from '../src/handle.ts';

let db: PGlite;
let owner: Staff; let ops: Staff; let safety: Staff; let child: string; let s: School;
const tokens: Record<string, () => JwtClaims> = {};
const passwords = new Map<string, string>();
const bans = new Map<string, boolean>();
const rpcCalls: string[] = [];
let banFailsOnce = false;

function deps(): AdminApiDeps {
  const base = pgliteStore(db);
  return {
    async asCaller(authorization, fn, args) {
      const claims = tokens[authorization.replace(/^Bearer /, '')];
      if (!claims) throw new CallerError('JWSError JWSInvalidSignature', 'PGRST301');
      const names = Object.keys(args);
      try {
        return await asClaims(db, claims(), async (tx) =>
          (await tx.query<{ v: unknown }>(
            `select admin.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
            names.map((n) => args[n]),
          )).rows[0]?.v ?? null);
      } catch (e) {
        throw new CallerError((e as Error).message, String((e as { code?: string }).code ?? ''));
      }
    },
    lms: {
      rpc: async (fn, args) => {
        rpcCalls.push(fn);
        const names = Object.keys(args);
        return asService(db, async (tx) =>
          (await tx.query<{ v: unknown }>(
            `select lms.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
            names.map((n) => args[n]),
          )).rows[0]?.v ?? null);
      },
      store: { ...base, async createAccount(a) { passwords.set(a.loginId, a.password); return base.createAccount(a); } },
      auth: {
        async setPassword(userId, password) {
          const row = (await db.query<{ login_id: string }>(`select login_id from lms.account where user_id = $1`, [userId])).rows[0];
          passwords.set(row.login_id, password);
        },
      },
    },
    authAdmin: {
      async createStaffUser(email, password) {
        if ((await db.query(`select 1 from auth.users where email = $1`, [email])).rows.length) {
          throw new Refused(409, 'An account with that email already exists.');
        }
        const { rows } = await db.query<{ id: string }>(
          `insert into auth.users (email, raw_app_meta_data) values ($1, '{"provisioned_by":"staff"}') returning id`, [email]);
        passwords.set(email, password);
        return rows[0].id;
      },
      async setBanned(userId, banned) {
        if (banFailsOnce) { banFailsOnce = false; throw new Error('auth service 500'); }
        bans.set(userId, banned);
      },
    },
  };
}

const post = (route: string, body: unknown, token?: string) =>
  handleAdminApi({ method: 'POST', path: `/functions/v1/admin-api/${route}`, authorization: token ? `Bearer ${token}` : undefined, body }, deps());

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav'); ops = await makeStaff(db, 'ops', 'Ops person'); safety = await makeStaff(db, 'safety', 'Safety person');
  child = await anonymousChild(db);
  s = await buildSchool(db, 'API');
  tokens['owner'] = () => aal2(owner); tokens['owner-fresh'] = () => fresh(owner);
  tokens['ops'] = () => aal2(ops); tokens['ops-fresh'] = () => fresh(ops);
  tokens['safety-fresh'] = () => fresh(safety); tokens['child'] = () => ({ sub: child, aal: 'aal2', is_anonymous: true });
});
afterAll(async () => { await db.close(); });

/*
 * THE STAFF CONSOLE'S SERVICE CALLS (supabase/functions/admin-api). Written first.
 *
 * Over the real migrations, with stand-ins for the auth admin API: every call
 * asks the database as the caller first (admin.api_gate, admin.staff_invite,
 * admin.direct_user_block), and nothing is created, reset or banned when the
 * database says no. Refusals come back as {error, code}.
 */

const SHEET = 'grade,section,roll,name\n8,A,5,Asha Rao\n';
type Reply = { status: number; body: Record<string, unknown> };
const send = async (route: string, body: unknown, token?: string, d: AdminApiDeps = deps(), method = 'POST') =>
  (await handleAdminApi(
    { method, path: `/functions/v1/admin-api/${route}`, authorization: token ? `Bearer ${token}` : undefined, body },
    d,
  )) as Reply;
const count = async (sql: string, params: unknown[] = []) => (await db.query<{ n: number }>(sql, params)).rows[0].n;
const adminAudit = (action: string) =>
  db
    .query<{ actor: string; details: Record<string, unknown> }>(`select actor, details from admin.audit_event where action = $1 order by id`, [action])
    .then((r) => r.rows);
const lmsAudit = (action: string) =>
  db.query<{ actor: string; target: string }>(`select actor, target from lms.audit_event where action = $1 order by at`, [action]).then((r) => r.rows);

describe('who may call', () => {
  it('refuses no sign-in, a forged token and a child before anything is created, reset or banned', async () => {
    expect(await post('import', { code: 'API' })).toMatchObject({ status: 401, body: { code: 'not-allowed' } });
    expect(await post('import', { code: 'API' }, 'forged')).toMatchObject({ status: 401, body: { code: 'not-allowed' } });
    const asChild: [string, unknown][] = [
      ['import', { code: 'API', students: SHEET, commit: true, acceptWarnings: true, reason: 'term starts', env: 'TEST' }],
      ['reset-pin', { code: 'API', loginId: 'API-101', reason: 'parent called', env: 'TEST' }],
      ['staff-invite', { email: 'kid@example.com', displayName: 'Kid', role: 'owner', reason: 'hire', env: 'TEST' }],
      ['user-block', { userId: child, blocked: true, reason: 'scripted abuse', env: 'TEST' }],
    ];
    for (const [route, body] of asChild) {
      expect(await post(route, body, 'child'), route).toMatchObject({ status: 403, body: { code: 'not-allowed' } });
    }
    expect(passwords.size).toBe(0);
    expect(bans.size).toBe(0);
    expect(await count(`select count(*)::int as n from auth.users where email is not null`)).toBe(0);
  });

  it('refuses a GET and a route that does not exist', async () => {
    expect((await send('import', null, 'ops', deps(), 'GET')).status).toBe(405);
    expect((await post('nowhere', {}, 'ops')).status).toBe(404);
  });
});

describe('people', () => {
  it("ops preview, then add people to a school; the school's log names the member of staff", async () => {
    const preview = await send('import', { code: 'API', students: SHEET }, 'ops');
    expect(preview.status).toBe(200);
    expect(preview.body.committed).toBe(false);
    expect(passwords.size).toBe(0);

    const done = await send(
      'import',
      { code: 'API', students: SHEET, commit: true, acceptWarnings: true, reason: 'term starts', env: 'TEST' },
      'ops',
    );
    expect(done.status).toBe(200);
    const created = done.body.created as { loginId: string; pin: string }[];
    expect(created[0]).toMatchObject({ loginId: 'API-8A-5' });
    expect(created[0].pin).toMatch(/^\d{6}$/);
    expect(created[0].pin).toBe(passwords.get('API-8A-5'));
    expect((await lmsAudit('people-added')).map((r) => r.actor)).toEqual([ops.id]);
    expect(await adminAudit('people-import-requested')).toHaveLength(1);
  });

  it('a commit without a reason, or for the wrong environment, creates nobody', async () => {
    const accounts = await count(`select count(*)::int as n from lms.account`);
    const body = { code: 'API', students: 'grade,section,roll,name\n8,A,6,Ravi Rao\n', commit: true, acceptWarnings: true };
    const noReason = await send('import', { ...body, reason: '', env: 'TEST' }, 'ops');
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('other');
    expect(noReason.body.error).toMatch(/say why/);
    expect(await send('import', { ...body, reason: 'term starts', env: 'HOSTED' }, 'ops')).toMatchObject({
      status: 409,
      body: { code: 'wrong-environment' },
    });
    expect(await count(`select count(*)::int as n from lms.account`)).toBe(accounts);
  });

  it('an offboarded school takes no new people', async () => {
    const s2 = await buildSchool(db, 'API2');
    await db.query(`insert into admin.school_profile (org_id, offboarded_at) values ($1, now())`, [s2.org]);
    const r = await send(
      'import',
      { code: 'API2', students: SHEET, commit: true, acceptWarnings: true, reason: 'term starts', env: 'TEST' },
      'ops',
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/offboarded/);
  });
});

describe('new PINs', () => {
  it('a new PIN needs a code from the last 10 minutes; then the old PIN stops and its holder is signed out', async () => {
    const old = passwords.get('API-8A-5');
    const body = { code: 'API', loginId: 'api-8a-5', reason: 'parent called', env: 'TEST' };
    expect(await send('reset-pin', body, 'ops')).toMatchObject({ status: 403, body: { code: 'needs-mfa' } });
    expect(passwords.get('API-8A-5')).toBe(old);

    rpcCalls.length = 0;
    const r = await send('reset-pin', body, 'ops-fresh');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ loginId: 'API-8A-5', displayName: 'Asha Rao' });
    expect(r.body.pin).toBe(passwords.get('API-8A-5'));
    expect(rpcCalls).toContain('end_sessions');
    expect((await lmsAudit('pin-reset')).at(-1)).toMatchObject({ actor: ops.id, target: 'API-8A-5' });
    expect(await adminAudit('pin-reset-requested')).toHaveLength(1);
  });

  it("a new PIN for an unknown ID is a 404, and the request is in the platform's log", async () => {
    const r = await send('reset-pin', { code: 'API', loginId: 'API-999', reason: 'parent called', env: 'TEST' }, 'ops-fresh');
    expect(r.status).toBe(404);
    expect((await adminAudit('pin-reset-requested')).at(-1)?.details).toEqual({ loginId: 'API-999' });
  });

  it('the safety reviewer can do none of it', async () => {
    const calls: [string, unknown][] = [
      ['import', { code: 'API', students: SHEET }],
      ['reset-pin', { code: 'API', loginId: 'API-8A-5', reason: 'parent called', env: 'TEST' }],
      ['user-block', { userId: child, blocked: true, reason: 'scripted abuse', env: 'TEST' }],
      ['staff-invite', { email: 'someone@example.com', displayName: 'Someone', role: 'ops', reason: 'hire', env: 'TEST' }],
    ];
    for (const [route, body] of calls) {
      expect(await send(route, body, 'safety-fresh'), route).toMatchObject({ status: 403, body: { code: 'not-allowed' } });
    }
  });
});

describe('staff invitations', () => {
  const invite = { email: 'New.Person@example.com', displayName: 'New Person', role: 'ops', reason: 'hire', env: 'TEST' };

  it("a staff invite is the owner's with a fresh code: an inactive account made for staff, and its temporary password once", async () => {
    const r = await send('staff-invite', invite, 'owner-fresh');
    expect(r.status).toBe(200);
    expect(r.body.email).toBe('new.person@example.com');
    const userId = r.body.userId as string;
    expect(r.body.temporaryPassword).toHaveLength(20);
    expect(r.body.temporaryPassword).toBe(passwords.get('new.person@example.com'));
    const made = (
      await db.query<{ p: string }>(`select raw_app_meta_data ->> 'provisioned_by' as p from auth.users where id = $1`, [userId])
    ).rows;
    expect(made).toEqual([{ p: 'staff' }]);
    const row = (await db.query<{ active: boolean }>(`select active from admin.platform_staff where user_id = $1`, [userId])).rows;
    expect(row).toEqual([{ active: false }]);
    expect(await adminAudit('staff-invite-requested')).toHaveLength(1);
    expect(await adminAudit('staff-invited')).toHaveLength(1);
  });

  it('ops cannot invite; a bad address or one already in use is refused', async () => {
    expect(await send('staff-invite', { ...invite, email: 'other@example.com' }, 'ops-fresh')).toMatchObject({
      status: 403,
      body: { code: 'not-allowed' },
    });
    const rows = await count(`select count(*)::int as n from admin.audit_event`);
    expect((await send('staff-invite', { ...invite, email: 'not-an-email' }, 'owner-fresh')).status).toBe(400);
    expect(await count(`select count(*)::int as n from admin.audit_event`)).toBe(rows);
    const again = await send('staff-invite', invite, 'owner-fresh');
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already exists/);
  });
});

describe('blocking a direct user', () => {
  const blocked = () => db.query(`select 1 from admin.user_block where user_id = $1`, [child]).then((r) => r.rows.length);

  it('blocking a direct user records it, then bans the sign-in; unblocking reverses both', async () => {
    const r = await send('user-block', { userId: child, blocked: true, reason: 'scripted abuse', env: 'TEST' }, 'ops');
    expect(r).toEqual({ status: 200, body: { userId: child, blocked: true } });
    expect(await blocked()).toBe(1);
    expect(bans.get(child)).toBe(true);
    const back = await send('user-block', { userId: child, blocked: false, reason: 'appeal upheld', env: 'TEST' }, 'ops');
    expect(back).toEqual({ status: 200, body: { userId: child, blocked: false } });
    expect(await blocked()).toBe(0);
    expect(bans.get(child)).toBe(false);
  });

  it('a school account cannot be blocked here, and nothing is banned', async () => {
    const r = await send('user-block', { userId: s.kid8a, blocked: true, reason: 'scripted abuse', env: 'TEST' }, 'ops');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/belongs to a school/);
    expect(bans.has(s.kid8a)).toBe(false);

    const d = deps();
    const asked = vi.spyOn(d, 'asCaller');
    const notId = await send('user-block', { userId: 'not-a-uuid', blocked: true, reason: 'scripted abuse', env: 'TEST' }, 'ops', d);
    expect(notId.status).toBe(400);
    expect(asked).not.toHaveBeenCalled();
  });

  it('a ban that fails after the record says so, and pressing again is safe', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const before = (await adminAudit('user-blocked')).length;
      banFailsOnce = true;
      const body = { userId: child, blocked: true, reason: 'scripted abuse', env: 'TEST' };
      const first = await send('user-block', body, 'ops');
      expect(first.status).toBe(502);
      expect(first.body.error).toMatch(/Recorded, but the sign-in service did not confirm it/);
      expect(await blocked()).toBe(1);
      expect((await send('user-block', body, 'ops')).status).toBe(200);
      expect(bans.get(child)).toBe(true);
      expect((await adminAudit('user-blocked')).length).toBe(before + 2);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe('when the database fails', () => {
  it('an unexpected database failure shows a plain message and logs the details', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const broken: AdminApiDeps = {
        ...deps(),
        asCaller: async () => {
          throw new CallerError('relation "x" does not exist', '42P01');
        },
      };
      const r = await send('import', { code: 'API', students: SHEET }, 'ops', broken);
      expect(r.status).toBe(500);
      expect(r.body.error).toBe(SERVER_FAILED);
      expect(String(r.body.error)).not.toContain('relation');
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
