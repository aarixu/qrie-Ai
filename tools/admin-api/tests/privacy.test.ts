// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { rpc } from '../../../supabase/tests/billing-fixtures.ts';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { classRow, populateChild } from '../../../supabase/tests/safety-fixtures.ts';
import { handleAdminApi, type AdminApiDeps } from '../src/handle.ts';
import { apiWorld, type ApiWorld } from './deps.ts';

/**
 * ADMIN-API REMOVES THE FILES (plan 5, Task 10). Written first.
 *
 * Over the real migrations, with Storage as a stand-in that deletes
 * storage.objects rows (./deps.ts): each route asks the database as the
 * caller first (admin.class_remove_prepare, admin.erasure_prepare), then
 * removes the files, then reports back with the service role
 * (admin.class_files_removed, admin.erasure_complete). When Storage fails,
 * the class stays hidden and the child is not erased; pressing again finishes.
 */

let db: PGlite;
let world: ApiWorld;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let school: School;
let kid: { login: string; parent: string; assignment: string; photo: string };

type Reply = { status: number; body: Record<string, unknown> };
const send = async (route: string, body: unknown, token: string, d: AdminApiDeps = world.deps()) =>
  (await handleAdminApi(
    { method: 'POST', path: `/functions/v1/admin-api/${route}`, authorization: `Bearer ${token}`, body },
    d,
  )) as Reply;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => (await one<{ n: number }>(sql, params)).n;
const classStatus = async (id: string) =>
  (await one<{ review_status: string } | undefined>(`select review_status from public.prepared_class where id = $1`, [id]))
    ?.review_status ?? null;
const filesOf = (id: string) =>
  count(`select count(*)::int as n from storage.objects where bucket_id = 'classes' and name like $1`, [`${id}/%`]);
const requestStatus = async (id: string) =>
  (await one<{ status: string }>(`select status from admin.erasure_request where id = $1`, [id])).status;
const removeBody = (classId: string, action: 'retract' | 'reject') => ({
  classId, action, reason: 'a wrong answer in it', env: 'TEST',
});

/** A school student who has left, with a verified erasure request. */
async function verifiedRequest(login: string, reference: string): Promise<string> {
  await rpc(db, aal2(ops), 'school_person_disable', { p_code: 'APX', p_login: login, p_reason: 'left the school', p_env: 'TEST' });
  const { requestId } = await rpc<{ requestId: string }>(db, aal2(ops), 'erasure_intake', {
    p_channel: 'email', p_requester: 'parent', p_reference: reference, p_code: 'APX', p_login: login, p_user: null,
    p_received_on: (await one<{ d: string }>(`select lms.india_today()::text as d`)).d,
    p_reason: 'a parent asked by email', p_env: 'TEST',
  });
  await rpc(db, aal2(ops), 'erasure_verify', { p_request: requestId, p_how: 'parent-callback', p_reason: 'rang back', p_env: 'TEST' });
  return requestId;
}

beforeAll(async () => {
  db = await freshDatabase();
  world = apiWorld(db);
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  school = await buildSchool(db, 'APX');
  kid = await populateChild(db, school, school.kid8a);
  const { tokens } = world;
  tokens['owner'] = () => aal2(owner);
  tokens['owner-fresh'] = () => fresh(owner);
  tokens['ops'] = () => aal2(ops);
  tokens['ops-fresh'] = () => fresh(ops);
  tokens['safety'] = () => fresh(safety);
});
afterAll(async () => {
  await db.close();
});

describe('class-remove', () => {
  it('ops retracts a published class with a fresh code (token ops-fresh): hidden at once, files removed, then the row', async () => {
    await classRow(db, 'cls-retract', { files: ['manifest.json', 'beats/1.json'] });
    expect(await send('class-remove', removeBody('cls-retract', 'retract'), 'ops')).toMatchObject({
      status: 403, body: { code: 'needs-mfa' },
    });
    expect(await classStatus('cls-retract')).toBe('published');
    expect(await filesOf('cls-retract')).toBe(2);
    const ok = await send('class-remove', removeBody('cls-retract', 'retract'), 'ops-fresh');
    expect(ok).toEqual({ status: 200, body: { classId: 'cls-retract', removed: 2 } });
    expect(await filesOf('cls-retract')).toBe(0);
    expect(await classStatus('cls-retract')).toBeNull();
  });

  it('the owner rejects a pending class the same way; safety is refused (403 not-allowed) and nothing changes', async () => {
    await classRow(db, 'cls-reject', { status: 'pending', files: ['manifest.json'] });
    expect(await send('class-remove', removeBody('cls-reject', 'reject'), 'safety')).toMatchObject({
      status: 403, body: { code: 'not-allowed' },
    });
    expect(await classStatus('cls-reject')).toBe('pending');
    expect(await filesOf('cls-reject')).toBe(1);
    expect(await send('class-remove', removeBody('cls-reject', 'reject'), 'owner-fresh')).toEqual({
      status: 200, body: { classId: 'cls-reject', removed: 1 },
    });
    expect(await filesOf('cls-reject')).toBe(0);
    expect(await classStatus('cls-reject')).toBeNull();
  });

  it('when Storage fails the class stays hidden and retracted, and pressing again finishes it', async () => {
    await classRow(db, 'cls-storage', { files: ['manifest.json', 'a.json', 'b.json'] });
    world.failNextRemove();
    expect(await send('class-remove', removeBody('cls-storage', 'retract'), 'ops-fresh')).toEqual({
      status: 502,
      body: { error: 'The class is hidden, but Storage did not remove its files. Press again; it is safe to repeat.', code: 'other' },
    });
    expect(await classStatus('cls-storage')).toBe('retracted');
    expect(await filesOf('cls-storage')).toBe(3);
    expect(await send('class-remove', removeBody('cls-storage', 'retract'), 'ops-fresh')).toEqual({
      status: 200, body: { classId: 'cls-storage', removed: 3 },
    });
    expect(await classStatus('cls-storage')).toBeNull();
  });
});

describe('erase', () => {
  let requestId: string;

  it('ops and a stale owner cannot erase', async () => {
    requestId = await verifiedRequest(kid.login, 'MAIL 2026/11 #9');
    expect(await send('erase', { requestId, reason: 'verified request', env: 'TEST' }, 'ops-fresh')).toMatchObject({
      status: 403, body: { code: 'not-allowed' },
    });
    expect(await send('erase', { requestId, reason: 'verified request', env: 'TEST' }, 'owner')).toMatchObject({
      status: 403, body: { code: 'needs-mfa' },
    });
    expect(await requestStatus(requestId)).toBe('verified');
  });

  it('when a photo will not delete, nothing is erased and pressing again finishes it', async () => {
    world.failNextRemove();
    expect(await send('erase', { requestId, reason: 'verified request', env: 'TEST' }, 'owner-fresh')).toEqual({
      status: 502,
      body: { error: "Nothing was erased: Storage did not remove the child's photos. Press again; it is safe to repeat.", code: 'other' },
    });
    expect(await requestStatus(requestId)).toBe('erasing');
    expect(await count(`select count(*)::int as n from lms.account where user_id = $1`, [school.kid8a])).toBe(1);
    expect(await count(`select count(*)::int as n from storage.objects where name = $1`, [kid.photo])).toBe(1);
  });

  it('the owner erases a verified request with a fresh code', async () => {
    const ok = await send('erase', { requestId, reason: 'verified request', env: 'TEST' }, 'owner-fresh');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ requestId, photos: 1 });
    expect(Object.keys(ok.body).sort()).toEqual(['activityLogLines', 'photos', 'requestId', 'rows']);
    expect(await count(`select count(*)::int as n from auth.users where id = $1`, [school.kid8a])).toBe(0);
    expect(await count(`select count(*)::int as n from public.student_report where user_id = $1`, [school.kid8a])).toBe(0);
    expect(await count(`select count(*)::int as n from storage.objects where name = $1`, [kid.photo])).toBe(0);
    expect(await requestStatus(requestId)).toBe('erased');
    const erased = await db.query<{ actor: string }>(
      `select actor from admin.audit_event where action = 'child-erased' and target_id = $1`,
      [requestId],
    );
    expect(erased.rows).toEqual([{ actor: owner.id }]);
  });
});

describe('a server that cannot remove files, and a bad body', () => {
  it('a server without Storage answers 503 and changes nothing', async () => {
    await classRow(db, 'cls-nostorage', { files: ['manifest.json'] });
    const request = await verifiedRequest('APX-102', 'LETTER 12');
    const noFiles: AdminApiDeps = { ...world.deps(), files: undefined };
    const unavailable = { status: 503, body: { error: 'This server cannot remove files yet.', code: 'other' } };
    expect(await send('class-remove', removeBody('cls-nostorage', 'retract'), 'ops-fresh', noFiles)).toEqual(unavailable);
    expect(await send('erase', { requestId: request, reason: 'verified request', env: 'TEST' }, 'owner-fresh', noFiles)).toEqual(
      unavailable,
    );
    const noService: AdminApiDeps = { ...world.deps(), serviceAdmin: undefined };
    expect(await send('class-remove', removeBody('cls-nostorage', 'retract'), 'ops-fresh', noService)).toEqual(unavailable);
    expect(await classStatus('cls-nostorage')).toBe('published');
    expect(await requestStatus(request)).toBe('verified');
  });

  it('a bad body is a 400 before the database is asked', async () => {
    const asked: string[] = [];
    const base = world.deps();
    const spy: AdminApiDeps = {
      ...base,
      asCaller: async (auth, fn, args) => {
        asked.push(fn);
        return base.asCaller(auth, fn, args);
      },
    };
    const bad: [string, unknown][] = [
      ['class-remove', { classId: '', action: 'retract', reason: 'r', env: 'TEST' }],
      ['class-remove', { classId: 'x'.repeat(201), action: 'retract', reason: 'r', env: 'TEST' }],
      ['class-remove', { classId: 'cls-nostorage', action: 'delete', reason: 'r', env: 'TEST' }],
      ['class-remove', { classId: 42, action: 'retract', reason: 'r', env: 'TEST' }],
      ['erase', { requestId: 'not-a-uuid', reason: 'r', env: 'TEST' }],
      ['erase', { reason: 'r', env: 'TEST' }],
      ['erase', ['a list']],
    ];
    for (const [route, body] of bad) {
      const reply = await send(route, body, 'owner-fresh', spy);
      expect(reply.status, JSON.stringify(body)).toBe(400);
    }
    expect(asked).toEqual([]);
  });
});
