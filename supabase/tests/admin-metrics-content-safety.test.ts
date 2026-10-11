// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { makeFinance, rpc } from './billing-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { freshDatabase, type JwtClaims } from './harness.ts';
import { atIst, compute, figures, istDay, metricOf, nightly, series, sitting, usage } from './metrics-fixtures.ts';
import { classRow, keepFlag, report, setReport } from './safety-fixtures.ts';

/**
 * CONTENT AND SAFETY OVER TIME (0074). Written first.
 *
 * Classes by status and the question bank are snapshots of the nightly run.
 * Reports are counted by the day they arrived, open reports at a day's end
 * are rebuilt from when each was looked at, triaged and closed, and the
 * first look is a median of minutes. Distress flags are counted only from the
 * day capture went live. admin.content_view lists the most reported and the
 * costliest classes with counts and rupees only.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let cnt: School;
const day = (n: number) => istDay(db, n);

interface ContentView {
  classes: Record<'pending' | 'published' | 'retracted' | 'removed', number>;
  bank: { library: number; schoolApproved: number; schoolWaiting: number; drafts: number };
  mostReported: { id: string; title: string; topicRef: string; reports: { total: number; open: number; unsafe: number } }[];
  mostCost: { id: string; title: string; topicRef: string; cost: { inr: number; calls: number; sittings: number } }[];
}
const contentView = (claims: JwtClaims) => rpc<ContentView>(db, claims, 'content_view', {});

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  finance = await makeFinance(db);
  cnt = await buildSchool(db, 'CNT');
  await classRow(db, 'CNT-P', { status: 'pending', topicRef: 'sci/p' });
  await classRow(db, 'CNT-A', { topicRef: 'sci/a' });
  await classRow(db, 'CNT-B', { topicRef: 'sci/b' });
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('admin.session', 'on', true)`);
    await tx.query(
      `insert into admin.class_review (class_id, topic_ref, title, action, actor_name, reason)
       values ('CNT-GONE', 'sci/gone', 'A removed class', 'retracted', 'Aarav', 'a wrong diagram')`,
    );
  });
  const item = async (org: string | null, ref: string | null) =>
    (
      await db.query<{ id: string }>(
        `insert into lms.item (org_id, library_ref, kind, stem, options, correct_index)
         values ($1, $2, 'mcq', 'A question', '["a","b"]', 0) returning id`,
        [org, ref],
      )
    ).rows[0].id;
  await item(null, 'lib-a');
  await item(null, 'lib-b');
  const approved = await item(cnt.org, null);
  await item(cnt.org, null);
  await db.query(`insert into lms.item_approval (org_id, item_id, approved_by) values ($1, $2, $3)`, [cnt.org, approved, cnt.teacherA]);
  await db.query(
    `insert into lms.item_draft (org_id, created_by, grade, subject, stem, options, correct_index, model)
     values ($1, $2, 8, 'Mathematics', 'A draft', '["a","b"]', 0, 'gemini-x')`,
    [cnt.org, cnt.teacherA],
  );
});
afterAll(async () => {
  await db.close();
});

describe('content over time', () => {
  it('classes by status and the question bank are snapshots of the nightly run', async () => {
    await nightly(db);
    const y = await day(1);
    expect(await figures(db, 'content.classes', y)).toEqual({ pending: 1, published: 2, retracted: 0, removed: 1 });
    expect(await figures(db, 'content.bank', y)).toEqual({ library: 2, school_approved: 1, school_waiting: 1, drafts: 1 });
    await compute(db, 2);
    expect(await figures(db, 'content.classes', await day(2))).toEqual({});
  });
});

describe('safety over time', () => {
  it('new reports by kind, by the day they arrived', async () => {
    for (const kind of ['wrong', 'unsafe'] as const) {
      const id = await report(db, cnt.kid8a, { kind });
      await setReport(db, id, `received_at = ${atIst(1, '12:00')}`);
    }
    await compute(db, 1);
    expect(await figures(db, 'reports.new', await day(1))).toEqual({ '': 2, wrong: 1, unsafe: 1 });
  });

  it("open reports at a day's end are rebuilt from when each was looked at, triaged and closed", async () => {
    const open = await report(db, cnt.kid8b);
    await setReport(db, open, `received_at = ${atIst(6, '09:00')}, seen_at = ${atIst(5, '09:00')}, actioned_at = ${atIst(4, '09:00')}, status = 'triaged'`);
    const closedLongAgo = await report(db, cnt.kid8b);
    await setReport(db, closedLongAgo, `received_at = ${atIst(6, '09:30')}, status = 'closed'`);
    await compute(db, 6);
    await compute(db, 5);
    await compute(db, 4);
    expect(await figures(db, 'reports.open', await day(6))).toEqual({ '': 1, new: 1 });
    expect(await figures(db, 'reports.open', await day(5))).toEqual({ '': 1, seen: 1 });
    expect(await figures(db, 'reports.open', await day(4))).toEqual({ '': 1, triaged: 1 });
  });

  it('the first look: reports looked at and the median minutes, by the day they arrived', async () => {
    for (const minutes of [10, 30]) {
      const id = await report(db, cnt.kid8a);
      await setReport(db, id, `received_at = ${atIst(8, '09:00')}, seen_at = ${atIst(8, '09:00')} + make_interval(mins => $2::int), status = 'seen'`, [
        minutes,
      ]);
    }
    await compute(db, 8);
    await compute(db, 7);
    expect(await figures(db, 'reports.looked', await day(8))).toEqual({ '': 2 });
    expect(await figures(db, 'reports.first_look_median', await day(8))).toEqual({ '': 20 });
    expect(await figures(db, 'reports.looked', await day(7))).toEqual({ '': 0 });
    expect(await figures(db, 'reports.first_look_median', await day(7))).toEqual({});
  });

  it('distress flags are counted only from the day capture went live, and read not captured before', async () => {
    const before = metricOf(await series(db, aal2(owner), 'safety', 7), 'safety.flags');
    expect(before.captured).toBe(false);
    expect(before.why).toBe('Distress flags are not captured yet: none has arrived and the day capture went live is not recorded.');
    const id = crypto.randomUUID();
    expect(await keepFlag(db, cnt.kid8a, { id })).toBe(true);
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('admin.session', 'on', true)`);
      await tx.query(`update admin.safety_event set received_at = ${atIst(1, '15:00')} where id = $1`, [id]);
    });
    await compute(db, 1);
    expect(await figures(db, 'safety.flags', await day(1))).toEqual({});
    const after = metricOf(await series(db, aal2(owner), 'safety', 7), 'safety.flags');
    expect(after.captured).toBe(true);
    expect(after.capturedSince).toBe(await day(0));

    await rpc(db, fresh(owner), 'safety_capture_set', { p_on: await day(5), p_reason: 'the relay went live then', p_env: 'TEST' });
    await compute(db, 1);
    expect(await figures(db, 'safety.flags', await day(1))).toEqual({ '': 1, 'from-student': 1 });
    const live = metricOf(await series(db, aal2(safety), 'safety', 7), 'safety.flags');
    expect(live.capturedSince).toBe(await day(5));
    expect(live.points.find((p) => p.dim === '')).toMatchObject({ day: await day(1), value: 1 });
  });

  it('content_view lists the most reported and the costliest classes with counts only', async () => {
    for (const kid of [cnt.kid8a, cnt.kid8b]) await report(db, kid, { lessonId: 'CNT-B', note: 'zz a private note' });
    const s = await sitting(db, { org: cnt.org, user: cnt.kid8a, receivedSql: atIst(1), topic: 'sci/a' });
    await db.query(`insert into public.model_price (provider, model, unit, inr_per_unit, effective_from) values ('vertex', 'gemini-x', 'prompt_token', 0.001, '2026-01-01')`);
    await usage(db, { user: cnt.kid8a, session: s, atSql: atIst(1), promptTokens: 2000 });
    const view = await contentView(aal2(owner));
    expect(view.classes).toEqual({ pending: 1, published: 2, retracted: 0, removed: 1 });
    expect(view.bank).toEqual({ library: 2, schoolApproved: 1, schoolWaiting: 1, drafts: 1 });
    expect(view.mostReported[0]).toMatchObject({ id: 'CNT-B', title: 'Title of CNT-B', topicRef: 'sci/b', reports: { total: 2 } });
    expect(view.mostCost).toHaveLength(1);
    expect(view.mostCost[0]).toMatchObject({ id: 'CNT-A', cost: { inr: 2, calls: 1, sittings: 1 } });
    const text = JSON.stringify(view);
    expect(text).not.toContain('note');
    expect(text).not.toContain('private');
  });

  it("the Safety page is the owner's and safety's; content_view is the owner's and ops'", async () => {
    await expect(series(db, aal2(ops), 'safety', 7)).rejects.toThrow('not allowed');
    await expect(contentView(aal2(ops))).resolves.toMatchObject({ bank: { library: 2 } });
    await expect(contentView(aal2(safety))).rejects.toThrow('not allowed');
    await expect(contentView(aal2(finance))).rejects.toThrow('not allowed');
  });
});
