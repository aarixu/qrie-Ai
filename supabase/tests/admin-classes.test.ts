// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { tutorSession } from './admin-school-fixtures.ts';
import { makeFinance, rpc, serviceRpc } from './billing-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { asService, freshDatabase, type JwtClaims } from './harness.ts';
import { classRow, report } from './safety-fixtures.ts';

/**
 * CLASSES: PENDING, PUBLISH, RETRACT, REJECT, REPORTS AND COST (0068). Written first.
 *
 * A browser sees only published classes. The owner publishes a class waiting
 * for review; ops or the owner retracts a published class or rejects a
 * pending one, with a fresh code, because its files are then deleted for
 * good. A removed class is hidden at once; its catalogue row goes only after
 * Storage holds none of its files (admin-api does the deleting, Task 10).
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let child: string;
let school: School;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  finance = await makeFinance(db);
  child = await anonymousChild(db);
  school = await buildSchool(db, 'CLS');
  await classRow(db, 'CLS-A', { topicRef: 'sci/a', files: ['manifest.json', 'beat1.json'] });
  await classRow(db, 'CLS-P', { status: 'pending', topicRef: 'sci/p' });
  await classRow(db, 'CLS-B', { topicRef: 'sci/b', files: ['manifest.json', 'b.json'] });
  await classRow(db, 'CLS-Q', { status: 'pending', topicRef: 'sci/q', files: ['q.json'] });
  // What CLS-A cost: one sitting on its topic, a priced call and an unpriced
  // one in it, and a warm call sharing the sitting's preparation id.
  await db.query(
    `insert into public.model_price (provider, model, unit, inr_per_unit, effective_from) values
       ('vertex', 'm-priced', 'prompt_token', 0.001, '2026-01-01'),
       ('vertex', 'm-priced', 'output_token', 0.002, '2026-01-01')`,
  );
  const sitting = await tutorSession(db, school.org, school.kid8a);
  await db.query(`update public.learning_session set topic_ref = 'sci/a' where id = $1`, [sitting]);
  const prep = crypto.randomUUID();
  await db.query(
    `insert into public.usage_event (user_id, session_id, relay, provider, model, status, prompt_tokens, output_tokens, prep_id, bucket) values
       ($1, $2, 'llm', 'vertex', 'm-priced', 200, 1000, null, $3, 'live'),
       ($1, $2, 'llm', 'vertex', 'm-unpriced', 200, 10, null, null, 'warm'),
       ($1, null, 'llm', 'vertex', 'm-priced', 200, null, 100, $3, 'warm')`,
    [school.kid8a, sitting, prep],
  );
  await report(db, school.kid8a, { kind: 'unsafe', lessonId: 'CLS-A' });
  await report(db, school.kid8b, { kind: 'wrong', lessonId: 'elsewhere', topicRef: 'sci/a' });
});
afterAll(async () => {
  await db.close();
});

const call = <T>(claims: JwtClaims, fn: string, args: Record<string, unknown> = {}) => rpc<T>(db, claims, fn, args);
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const asAnon = () =>
  db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    return (await tx.query<{ id: string }>(`select id from public.prepared_class order by id`)).rows.map((r) => r.id);
  });
const removePrepare = (claims: JwtClaims, id: string, action: string) =>
  call<{ classId: string; bucket: string; objects: string[] }>(claims, 'class_remove_prepare', {
    p_class: id, p_action: action, p_reason: 'a wrong diagram', p_env: 'TEST',
  });
const publish = (claims: JwtClaims, id: string) =>
  call(claims, 'class_publish', { p_class: id, p_reason: 'checked every beat', p_env: 'TEST' });
const status = async (id: string) =>
  (await one<{ review_status: string } | undefined>(`select review_status from public.prepared_class where id = $1`, [id]))?.review_status;

interface Row {
  id: string;
  topicRef: string;
  title: string;
  status: string;
  reports: { total: number; open: number; unsafe: number };
  cost: { inr: number; liveInr: number; warmInr: number; unpriced: boolean; calls: number; sittings: number };
  lastAction: { action: string; byName: string; at: string } | null;
}

describe('the catalogue', () => {
  it('a browser sees only published classes', async () => {
    expect(await asAnon()).toEqual(['CLS-A', 'CLS-B']);
  });
});

describe('the list', () => {
  it('owner, ops and safety list classes by status with report counts and cost; finance and a child cannot', async () => {
    for (const who of [owner, ops, safety]) {
      const all = await call<Row[]>(aal2(who), 'classes');
      expect(all.map((r) => r.id).sort()).toEqual(['CLS-A', 'CLS-B', 'CLS-P', 'CLS-Q']);
      expect((await call<Row[]>(aal2(who), 'classes', { p_status: 'pending' })).map((r) => r.id).sort()).toEqual(['CLS-P', 'CLS-Q']);
      const a = (await call<Row[]>(aal2(who), 'classes', { p_status: 'published' })).find((r) => r.id === 'CLS-A')!;
      expect(a).toMatchObject({ topicRef: 'sci/a', title: 'Title of CLS-A', status: 'published', reports: { total: 2, open: 2, unsafe: 1 }, lastAction: null });
    }
    await expect(call(aal2(owner), 'classes', { p_status: 'gone' })).rejects.toThrow(/a class status is pending, published, retracted or removed/);
    await expect(call(aal2(finance), 'classes')).rejects.toThrow(/not allowed/);
    await expect(call({ sub: child, aal: 'aal2' }, 'classes')).rejects.toThrow(/not allowed/);
  });

  it("cost is a floor when a call is unpriced, and counts the preparation's calls", async () => {
    const a = (await call<Row[]>(aal2(ops), 'classes')).find((r) => r.id === 'CLS-A')!;
    expect(a.cost).toEqual({ inr: 1.2, liveInr: 1, warmInr: 0.2, unpriced: true, calls: 3, sittings: 1 });
    const b = (await call<Row[]>(aal2(ops), 'classes')).find((r) => r.id === 'CLS-B')!;
    expect(b.cost).toEqual({ inr: 0, liveInr: 0, warmInr: 0, unpriced: false, calls: 0, sittings: 0 });
  });
});

describe('publishing', () => {
  it('only the owner with a fresh code publishes, and only a pending class', async () => {
    await expect(publish(fresh(ops), 'CLS-P')).rejects.toThrow(/not allowed/);
    await expect(publish(aal2(owner), 'CLS-P')).rejects.toThrow(/confirm with your authenticator code first/);
    await expect(publish(fresh(owner), 'CLS-A')).rejects.toThrow(/only a class waiting for review can be published/);
    await expect(publish(fresh(owner), 'NOPE')).rejects.toThrow(/there is no class with the ID NOPE/);
    await publish(fresh(owner), 'CLS-P');
    const p = await one<{ review_status: string; published_at: string | null }>(
      `select review_status, published_at from public.prepared_class where id = 'CLS-P'`,
    );
    expect(p.review_status).toBe('published');
    expect(p.published_at).not.toBeNull();
    const review = await one<{ action: string; actor: string; actor_name: string; reason: string; version: number }>(
      `select action, actor, actor_name, reason, version from admin.class_review where class_id = 'CLS-P'`,
    );
    expect(review).toEqual({ action: 'published', actor: owner.id, actor_name: 'Aarav', reason: 'checked every beat', version: 1 });
    const audit = await one<{ details: unknown }>(`select details from admin.audit_event where action = 'class-published'`);
    expect(audit.details).toEqual({ classId: 'CLS-P', topicRef: 'sci/p', version: 1 });
    expect(await asAnon()).toEqual(['CLS-A', 'CLS-B', 'CLS-P']);
  });
});

describe('removing a class', () => {
  it('ops retracts a published class with a fresh code: hidden from the catalogue at once, its files listed for removal', async () => {
    await expect(removePrepare(aal2(ops), 'CLS-B', 'retract')).rejects.toThrow(/confirm with your authenticator code first/);
    expect(await status('CLS-B')).toBe('published');
    const got = await removePrepare(fresh(ops), 'CLS-B', 'retract');
    expect(got.classId).toBe('CLS-B');
    expect(got.bucket).toBe('classes');
    expect(got.objects.sort()).toEqual(['CLS-B/b.json', 'CLS-B/manifest.json']);
    expect(await asAnon()).not.toContain('CLS-B');
    const b = await one<{ review_status: string; retracted_at: string | null }>(
      `select review_status, retracted_at from public.prepared_class where id = 'CLS-B'`,
    );
    expect(b.review_status).toBe('retracted');
    expect(b.retracted_at).not.toBeNull();
    expect((await one<{ details: unknown }>(`select details from admin.audit_event where action = 'class-retracted'`)).details).toEqual({
      classId: 'CLS-B', topicRef: 'sci/b', version: 1,
    });
    // Pressing again lists the same files and changes nothing more.
    expect((await removePrepare(fresh(ops), 'CLS-B', 'retract')).objects.sort()).toEqual(['CLS-B/b.json', 'CLS-B/manifest.json']);
    expect((await one<{ n: number }>(`select count(*)::int as n from admin.class_review where class_id = 'CLS-B'`)).n).toBe(1);
  });

  it('the owner rejects a pending class with a fresh code; safety and finance cannot remove one', async () => {
    await expect(removePrepare(fresh(safety), 'CLS-Q', 'reject')).rejects.toThrow(/not allowed/);
    await expect(removePrepare(fresh(finance), 'CLS-Q', 'reject')).rejects.toThrow(/not allowed/);
    await expect(removePrepare(fresh(owner), 'CLS-Q', 'delete')).rejects.toThrow(/say retract or reject/);
    await expect(removePrepare(fresh(owner), 'CLS-Q', 'retract')).rejects.toThrow(/only a published class can be retracted/);
    await expect(removePrepare(fresh(owner), 'CLS-A', 'reject')).rejects.toThrow(/only a class waiting for review can be rejected/);
    const got = await removePrepare(fresh(owner), 'CLS-Q', 'reject');
    expect(got.objects).toEqual(['CLS-Q/q.json']);
    expect(await status('CLS-Q')).toBe('retracted');
    const review = await one<{ action: string }>(`select action from admin.class_review where class_id = 'CLS-Q'`);
    expect(review.action).toBe('rejected');
  });

  it('the row goes only once its files are gone', async () => {
    await expect(serviceRpc(db, 'class_files_removed', { p_class: 'CLS-B', p_removed: 2 })).rejects.toThrow(
      /2 files of this class are still in storage/,
    );
    await expect(serviceRpc(db, 'class_files_removed', { p_class: 'CLS-A', p_removed: 0 })).rejects.toThrow(/this class is not being removed/);
    await db.query(`delete from storage.objects where bucket_id = 'classes' and name like 'CLS-B/%'`);
    expect(await serviceRpc(db, 'class_files_removed', { p_class: 'CLS-B', p_removed: 2 })).toEqual({ classId: 'CLS-B', removed: 2 });
    expect(await status('CLS-B')).toBeUndefined();
    const review = await one<{ action: string; files: number; actor: string; reason: string }>(
      `select action, files, actor, reason from admin.class_review where class_id = 'CLS-B' order by id desc limit 1`,
    );
    expect(review).toEqual({ action: 'files-removed', files: 2, actor: ops.id, reason: 'a wrong diagram' });
    const audit = await one<{ actor: string; details: unknown }>(`select actor, details from admin.audit_event where action = 'class-files-removed'`);
    expect(audit).toEqual({ actor: ops.id, details: { files: 2, topicRef: 'sci/b' } });
  });

  it('a removed class is listed under removed with its reports', async () => {
    const removed = await call<{ id: string; topicRef: string; byName: string; reason: string; removedAt: string; reports: unknown }[]>(
      aal2(safety), 'classes', { p_status: 'removed' },
    );
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ id: 'CLS-B', topicRef: 'sci/b', byName: 'Ops person', reason: 'a wrong diagram', reports: { total: 0, open: 0, unsafe: 0 } });
    const d = await call<{ live: unknown; removed: { id: string } | null; history: { action: string; byName: string; files: number | null }[]; filesInStorage: number }>(
      aal2(owner), 'class_detail', { p_class: 'CLS-B' },
    );
    expect(d.live).toBeNull();
    expect(d.removed?.id).toBe('CLS-B');
    expect(d.history.map((h) => h.action)).toEqual(['retracted', 'files-removed']);
    expect(d.history[1]).toMatchObject({ byName: 'Ops person', files: 2 });
    expect(d.filesInStorage).toBe(0);
    const a = await call<{ live: { id: string } | null; reportsByKind: unknown; reportsByStatus: unknown; filesInStorage: number }>(
      aal2(safety), 'class_detail', { p_class: 'CLS-A' },
    );
    expect(a.live?.id).toBe('CLS-A');
    expect(a.reportsByKind).toEqual({ wrong: 1, rude: 0, unsafe: 1, other: 0 });
    expect(a.reportsByStatus).toEqual({ new: 2, seen: 0, triaged: 0, closed: 0 });
    expect(a.filesInStorage).toBe(2);
    expect(JSON.stringify(a)).not.toContain('a private note');
    await expect(call(aal2(owner), 'class_detail', { p_class: 'NOPE' })).rejects.toThrow(/there is no class with the ID NOPE/);
  });

  it('a later preparation of the same topic can be kept again', async () => {
    await asService(db, (tx) =>
      tx.query(`insert into public.prepared_class (id, topic_ref, title, klass, subject) values ('CLS-B', 'sci/b', 'Again', 8, 'science')`),
    );
    expect(await status('CLS-B')).toBe('published');
    expect(await asAnon()).toContain('CLS-B');
  });

  it('the service-role function is not callable from a browser', async () => {
    for (const [role, may] of [['anon', false], ['authenticated', false], ['service_role', true]] as const) {
      const { ok } = await one<{ ok: boolean }>(
        `select has_function_privilege($1, 'admin.class_files_removed(text, integer)', 'execute') as ok`,
        [role],
      );
      expect(ok, role).toBe(may);
    }
  });
});
