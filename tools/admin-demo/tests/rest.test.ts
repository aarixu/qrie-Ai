// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { callRpc, type Caller } from '../src/rest.ts';

let db: PGlite;
let owner: Staff;
let ops: Staff;
let stranger: string;

const as = (claims: object): Caller => ({ role: 'authenticated', claims: { role: 'authenticated', is_anonymous: false, ...claims } });
const call = async (fn: string, args: Record<string, unknown>, caller: Caller, schema = 'admin') => {
  const r = await callRpc(db, { schema, fn, args, caller });
  return { status: r.status, body: JSON.parse(r.json) as unknown };
};

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db, 'TEST');
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  stranger = await createUser(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe('who is asking, as PostgREST decides it', () => {
  it('a signed-in person who is not staff gets 403 and the database\'s own "not allowed"', async () => {
    expect(await call('me', {}, as({ sub: stranger, aal: 'aal2' }))).toEqual({
      status: 403,
      body: { code: '42501', message: 'not allowed', details: null, hint: null },
    });
  });

  it('the owner at aal1 (password only) is refused the same way', async () => {
    const r = await call('me', {}, as({ sub: owner.id, aal: 'aal1' }));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: '42501', message: 'not allowed' });
  });

  it('the owner at aal2 gets admin.me()', async () => {
    expect(await call('me', {}, as(aal2(owner)))).toEqual({
      status: 200,
      body: { userId: owner.id, role: 'owner', displayName: 'Aarav', environment: 'TEST' },
    });
  });

  it('a signed-out browser (anon) is refused with 401, as PostgREST answers anon', async () => {
    const r = await call('me', {}, { role: 'anon' });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: '42501' });
  });

  it('the service role reaches a service-only function; a signed-in person does not', async () => {
    expect(await call('bootstrap_status', {}, { role: 'service_role' })).toMatchObject({ status: 200, body: { environment: 'TEST' } });
    expect((await call('bootstrap_status', {}, as(aal2(owner)))).status).toBe(403);
  });
});

describe('the answer, shaped as PostgREST shapes it', () => {
  it('a set-returning function answers an array of rows, timestamps as Postgres writes them in UTC', async () => {
    const r = await call('staff_list', {}, as(aal2(owner)));
    expect(r.status).toBe(200);
    const rows = r.body as { user_id: string; role: string; active: boolean; created_at: string }[];
    expect(rows.map((x) => x.role).sort()).toEqual(['ops', 'owner']);
    expect(rows[0].active).toBe(true);
    expect(rows[0].created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?\+00:00$/);
  });

  it('a void function answers null; its jsonb argument travels as the JSON it was given', async () => {
    const r = await call(
      'flag_set',
      { p_key: 'banner.message', p_scope: 'global', p_scope_id: '', p_value: 'Exams this week', p_reason: 'demo notice', p_env: 'TEST' },
      as(aal2(ops)),
    );
    expect(r).toEqual({ status: 200, body: null });
    const flags = (await call('flag_list', {}, as(aal2(ops)))).body as { key: string; value: unknown; scope: string | null }[];
    expect(flags.find((f) => f.key === 'banner.message' && f.scope === 'global')?.value).toBe('Exams this week');
  });

  it('arguments are cast to their declared types (dates, integers, booleans)', async () => {
    const r = await call(
      'school_create',
      {
        p_code: 'RESTX',
        p_name: 'Rest Test School',
        p_board: 'CBSE',
        p_year_label: '2026-27',
        p_starts_on: '2026-04-01',
        p_ends_on: '2027-03-31',
        p_reason: 'testing the demo',
        p_env: 'TEST',
      },
      as(fresh(owner)),
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a raise is 400 with its message and P0001', async () => {
    expect(
      await call(
        'flag_set',
        { p_key: 'nope', p_scope: 'global', p_scope_id: '', p_value: true, p_reason: 'testing', p_env: 'TEST' },
        as(aal2(ops)),
      ),
    ).toEqual({ status: 400, body: { code: 'P0001', message: 'there is no switch called nope', details: null, hint: null } });
  });

  it('a guarded action without a fresh code is 403 and names the code', async () => {
    const r = await call('metric_recompute', { p_from: '2026-01-01', p_to: '2026-01-02', p_reason: 'testing', p_env: 'TEST' }, as(aal2(owner)));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: '42501', message: 'confirm with your authenticator code first' });
  });
});

describe('what never reaches the database', () => {
  it('an argument the function does not have, a missing one, or a name of the wrong shape: 404 PGRST202', async () => {
    for (const [fn, args] of [
      ['me', { p_extra: 1 }],
      ['school_health', {}],
      ['me', { 'p_x); drop table x; --': 1 }],
      ['me; drop table x', {}],
      ['no_such_function', {}],
    ] as const) {
      const r = await call(fn, args, as(aal2(owner)));
      expect(r.status, fn).toBe(404);
      expect(r.body).toMatchObject({ code: 'PGRST202' });
    }
  });

  it('a schema that is not exposed: 406 PGRST106', async () => {
    const r = await call('uid', {}, as(aal2(owner)), 'auth');
    expect(r.status).toBe(406);
    expect(r.body).toMatchObject({ code: 'PGRST106' });
  });

  it('the public schema is exposed too: app_config answers a signed-out browser', async () => {
    const r = await call('app_config', {}, { role: 'anon' }, 'public');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty(['banner.message']);
  });
});
