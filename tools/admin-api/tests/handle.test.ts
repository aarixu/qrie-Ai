// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { setLicence } from '../../../supabase/tests/admin-school-fixtures.ts';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { CallerError, handleAdminApi, SERVER_FAILED, type AdminApiDeps } from '../src/handle.ts';
import { apiWorld, type ApiWorld } from './deps.ts';

/**
 * THE STAFF CONSOLE'S SERVICE CALLS (supabase/functions/admin-api). Written first.
 *
 * Over the real migrations, with stand-ins for the auth admin API (./deps.ts):
 * every call asks the database as the caller first (admin.api_gate,
 * admin.staff_invite, admin.direct_user_block), and nothing is created, reset
 * or banned when the database says no. Refusals come back as {error, code}.
 */

let db: PGlite;
let world: ApiWorld;
let owner: Staff; let ops: Staff; let safety: Staff; let child: string; let s: School;

const deps = () => world.deps();
const post = (route: string, body: unknown, token?: string) =>
  handleAdminApi({ method: 'POST', path: `/functions/v1/admin-api/${route}`, authorization: token ? `Bearer ${token}` : undefined, body }, deps());

beforeAll(async () => {
  db = await freshDatabase();
  world = apiWorld(db);
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav'); ops = await makeStaff(db, 'ops', 'Ops person'); safety = await makeStaff(db, 'safety', 'Safety person');
  child = await anonymousChild(db);
  s = await buildSchool(db, 'API');
  const { tokens } = world;
  tokens['owner'] = () => aal2(owner); tokens['owner-fresh'] = () => fresh(owner);
  tokens['ops'] = () => aal2(ops); tokens['ops-fresh'] = () => fresh(ops);
  tokens['safety-fresh'] = () => fresh(safety); tokens['child'] = () => ({ sub: child, aal: 'aal2', is_anonymous: true });
});
afterAll(async () => { await db.close(); });

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
    expect(world.passwords.size).toBe(0);
    expect(world.bans.size).toBe(0);
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
    expect(world.passwords.size).toBe(0);

    // A commit hands out PINs, so it wants a code from the last 10 minutes, as a new PIN does (R3).
    const commit = { code: 'API', students: SHEET, commit: true, acceptWarnings: true, reason: 'term starts', env: 'TEST' };
    expect(await send('import', commit, 'ops')).toMatchObject({ status: 403, body: { code: 'needs-mfa' } });
    expect(world.passwords.size).toBe(0);
    expect(await count(`select count(*)::int as n from lms.account where login_id = 'API-8A-5'`)).toBe(0);

    const done = await send('import', commit, 'ops-fresh');
    expect(done.status).toBe(200);
    const created = done.body.created as { loginId: string; pin: string }[];
    expect(created[0]).toMatchObject({ loginId: 'API-8A-5' });
    expect(created[0].pin).toMatch(/^\d{6}$/);
    expect(created[0].pin).toBe(world.passwords.get('API-8A-5'));
    expect((await lmsAudit('people-added')).map((r) => r.actor)).toEqual([ops.id]);
    expect(await adminAudit('people-import-requested')).toHaveLength(1);
  });

  it('a commit without a reason, or for the wrong environment, creates nobody', async () => {
    const accounts = await count(`select count(*)::int as n from lms.account`);
    const body = { code: 'API', students: 'grade,section,roll,name\n8,A,6,Ravi Rao\n', commit: true, acceptWarnings: true };
    const noReason = await send('import', { ...body, reason: '', env: 'TEST' }, 'ops-fresh');
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('other');
    expect(noReason.body.error).toMatch(/say why/);
    expect(await send('import', { ...body, reason: 'term starts', env: 'HOSTED' }, 'ops-fresh')).toMatchObject({
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
      'ops-fresh',
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/offboarded/);
  });

  it('a suspended school takes no new people from staff either, and checking a sheet is refused with the same sentence', async () => {
    // The sentence of migration 0063 (admin.import_refusal).
    const LAPSED =
      "This school's licence has ended and its grace period is over, so no new people can be added until it is renewed.";
    await buildSchool(db, 'API3');
    await setLicence(db, 'API3', 100, -20);
    const commit = await send(
      'import',
      { code: 'API3', students: SHEET, commit: true, acceptWarnings: true, reason: 'term starts', env: 'TEST' },
      'ops-fresh',
    );
    expect(commit.status).toBe(400);
    expect(commit.body.error).toBe(LAPSED);
    const preview = await send('import', { code: 'API3', students: SHEET }, 'ops');
    expect(preview.status).toBe(409);
    expect(preview.body.error).toBe(LAPSED);
  });

  it('a teachers sheet is added by the owner only: ops get not-allowed and nobody is made (R22)', async () => {
    const teachers = 'name,role,teaches\nNew Admin,admin,\nNew Teacher,teacher,8A Mathematics\n';
    const accounts = await count(`select count(*)::int as n from lms.account`);
    const body = { code: 'API', teachers, commit: true, acceptWarnings: true, reason: 'new staff', env: 'TEST' };

    const checked = await send('import', { code: 'API', teachers }, 'ops');
    expect(checked.status).toBe(200);
    expect(checked.body.committed).toBe(false);

    const refused = await send('import', body, 'ops-fresh');
    expect(refused).toMatchObject({ status: 403, body: { code: 'not-allowed' } });
    // A teachers sheet beside a students sheet is refused whole.
    expect(await send('import', { ...body, students: 'grade,section,roll,name\n8,A,9,Mira Das\n' }, 'ops-fresh')).toMatchObject({
      status: 403,
      body: { code: 'not-allowed' },
    });
    expect(await count(`select count(*)::int as n from lms.account`)).toBe(accounts);

    const done = await send('import', body, 'owner-fresh');
    expect(done.status).toBe(200);
    const created = done.body.created as { kind: string; pin: string }[];
    expect(created.map((c) => c.kind).sort()).toEqual(['admin', 'teacher']);
  });
});

describe('new PINs', () => {
  it('a new PIN needs a code from the last 10 minutes; then the old PIN stops and its holder is signed out', async () => {
    const old = world.passwords.get('API-8A-5');
    const body = { code: 'API', loginId: 'api-8a-5', reason: 'parent called', env: 'TEST' };
    expect(await send('reset-pin', body, 'ops')).toMatchObject({ status: 403, body: { code: 'needs-mfa' } });
    expect(world.passwords.get('API-8A-5')).toBe(old);

    world.rpcCalls.length = 0;
    const r = await send('reset-pin', body, 'ops-fresh');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ loginId: 'API-8A-5', displayName: 'Asha Rao' });
    expect(r.body.pin).toBe(world.passwords.get('API-8A-5'));
    expect(world.rpcCalls).toContain('end_sessions');
    expect((await lmsAudit('pin-reset')).at(-1)).toMatchObject({ actor: ops.id, target: 'API-8A-5' });
    expect(await adminAudit('pin-reset-requested')).toHaveLength(1);
  });

  it("a teacher's or a school admin's new PIN is the owner's: ops get not-allowed and the old PIN keeps working (R22)", async () => {
    for (const loginId of ['API-T1', 'api-a1']) {
      const body = { code: 'API', loginId, reason: 'forgot it', env: 'TEST' };
      expect(await send('reset-pin', body, 'ops-fresh'), loginId).toMatchObject({ status: 403, body: { code: 'not-allowed' } });
      expect(world.passwords.has(loginId.toUpperCase())).toBe(false);
      const r = await send('reset-pin', body, 'owner-fresh');
      expect(r.status).toBe(200);
      expect(r.body.pin).toBe(world.passwords.get(loginId.toUpperCase()));
    }
  });

  it('an ID that is not plain letters, digits and hyphens is refused before anything is asked or reset, so a look-alike cannot slip past R22', async () => {
    await buildSchool(db, 'STJ');
    const asked = (await adminAudit('pin-reset-requested')).length;
    // 'ﬆ' (U+FB06) upper-cases to 'ST' in JavaScript but stays itself in Postgres.
    for (const loginId of ['ﬆJ-T1', 'ﬆJ-A1', 'STß-T1', 'STJ‐T1', 'STJ T1']) {
      for (const token of ['ops-fresh', 'owner-fresh']) {
        const r = await send('reset-pin', { code: 'STJ', loginId, reason: 'forgot it', env: 'TEST' }, token);
        expect(r, `${token} ${loginId}`).toMatchObject({ status: 400, body: { code: 'other' } });
      }
    }
    expect(world.passwords.has('STJ-T1')).toBe(false);
    expect(world.passwords.has('STJ-A1')).toBe(false);
    expect((await adminAudit('pin-reset-requested')).length).toBe(asked);
    // The plain ID is still the owner's alone, whatever its case.
    expect(await send('reset-pin', { code: 'STJ', loginId: 'stj-t1', reason: 'forgot it', env: 'TEST' }, 'ops-fresh')).toMatchObject({
      status: 403,
      body: { code: 'not-allowed' },
    });
    const r = await send('reset-pin', { code: 'STJ', loginId: ' stj-t1 ', reason: 'forgot it', env: 'TEST' }, 'owner-fresh');
    expect(r.status).toBe(200);
    expect(r.body.pin).toBe(world.passwords.get('STJ-T1'));
    expect((await adminAudit('pin-reset-requested')).at(-1)?.details).toEqual({ loginId: 'STJ-T1' });
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
    expect(r.body.temporaryPassword).toBe(world.passwords.get('new.person@example.com'));
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

  it('an invite that fails after the sign-in is made takes the sign-in back, so the address can be invited again', async () => {
    const users = (email: string) => count(`select count(*)::int as n from auth.users where email = $1`, [email]);
    // admin.staff_invite refuses a role api_gate does not check: the account made for it is deleted.
    const badRole = await send('staff-invite', { ...invite, email: 'role@example.com', role: 'auditor' }, 'owner-fresh');
    expect(badRole.status).toBe(400);
    expect(await users('role@example.com')).toBe(0);
    // The database fails after the account is made.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const d = deps();
      const broken: AdminApiDeps = {
        ...d,
        asCaller: (a, fn, args) => (fn === 'staff_invite' ? Promise.reject(new Error('connection reset')) : d.asCaller(a, fn, args)),
      };
      const r = await send('staff-invite', { ...invite, email: 'blip@example.com' }, 'owner-fresh', broken);
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toContain(world.passwords.get('blip@example.com') ?? 'no password was made');
      expect(await users('blip@example.com')).toBe(0);
    } finally {
      logged.mockRestore();
    }
    const retry = await send('staff-invite', { ...invite, email: 'blip@example.com' }, 'owner-fresh');
    expect(retry.status).toBe(200);
    expect(await users('blip@example.com')).toBe(1);
  });
});

describe('blocking a direct user', () => {
  const blocked = () => db.query(`select 1 from admin.user_block where user_id = $1`, [child]).then((r) => r.rows.length);

  it('blocking a direct user records it, then bans the sign-in; unblocking reverses both', async () => {
    const r = await send('user-block', { userId: child, blocked: true, reason: 'scripted abuse', env: 'TEST' }, 'ops');
    expect(r).toEqual({ status: 200, body: { userId: child, blocked: true } });
    expect(await blocked()).toBe(1);
    expect(world.bans.get(child)).toBe(true);
    const back = await send('user-block', { userId: child, blocked: false, reason: 'appeal upheld', env: 'TEST' }, 'ops');
    expect(back).toEqual({ status: 200, body: { userId: child, blocked: false } });
    expect(await blocked()).toBe(0);
    expect(world.bans.get(child)).toBe(false);
  });

  it('a school account cannot be blocked here, and nothing is banned', async () => {
    const r = await send('user-block', { userId: s.kid8a, blocked: true, reason: 'scripted abuse', env: 'TEST' }, 'ops');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/belongs to a school/);
    expect(world.bans.has(s.kid8a)).toBe(false);

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
      world.failNextBan();
      const body = { userId: child, blocked: true, reason: 'scripted abuse', env: 'TEST' };
      const first = await send('user-block', body, 'ops');
      expect(first.status).toBe(502);
      expect(first.body.error).toMatch(/Recorded, but the sign-in service did not confirm it/);
      expect(await blocked()).toBe(1);
      expect((await send('user-block', body, 'ops')).status).toBe(200);
      expect(world.bans.get(child)).toBe(true);
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
