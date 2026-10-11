// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from './fixtures';
import { asService, asUser, freshDatabase } from './harness';

/**
 * TIME ON TASK FOR THE BRIEF'S METRIC (lam-one-brain Task 14, migration 0114).
 *
 * The brain divides unassisted gain by learning minutes, and takes minutes
 * only from public.learning_session.active_ms, which the server bounds. A
 * tutor sitting's comes from close_learning_session (0107). A hand-in's comes
 * from here: a test's from its own start to its hand-in, on the server's
 * clock; homework's from an optional time the phone sends with the hand-in,
 * bounded, and none when it sends none. Never estimated.
 */

let db: PGlite;
let one: School;
let q1: string;
let q2: string;

const MIN = 60_000;
const id = async (sql: string, params: unknown[] = []): Promise<string> =>
  (await db.query<{ id: string }>(sql, params)).rows[0].id;

async function work(kind: 'homework' | 'test', opts: { publishedAgo?: string; limit?: number } = {}): Promise<string> {
  const a = await id(
    `insert into lms.assignment (org_id, section_id, subject_id, created_by, kind, title, due_at, attempts_allowed,
                                 answer_types, time_limit_minutes)
     values ($1, $2, $3, $4, $5, 'Work', now() + interval '2 days', 3, '{mcq}', $6) returning id`,
    [one.org, one.s8a, one.maths, one.teacherA, kind, kind === 'test' ? (opts.limit ?? 30) : null],
  );
  await db.query(`insert into lms.assignment_item (assignment_id, item_id, position) values ($1, $2, 1), ($1, $3, 2)`, [
    a,
    q1,
    q2,
  ]);
  await db.query(`update lms.assignment set published_at = now() - $2::interval where id = $1`, [
    a,
    opts.publishedAgo ?? '1 day',
  ]);
  return a;
}

const answers = () => JSON.stringify({ [q1]: 1, [q2]: 0 });

/** The sitting a hand-in made, by its submission. */
async function sittingOf(submission: string): Promise<{ active_ms: number | null; span_ms: number; source: string }> {
  const { rows } = await db.query<{ active_ms: number | null; span_ms: number; source: string }>(
    `select s.active_ms, (extract(epoch from (s.ended_at - s.started_at)) * 1000)::bigint::int as span_ms, s.source
       from public.ledger_event e join public.learning_session s on s.id = e.session_id
      where e.payload ->> 'submissionId' = $1
      limit 1`,
    [submission],
  );
  return rows[0];
}

const handIn = (assignment: string, activeMs?: number | null) =>
  asUser(db, one.kid8a, (tx) =>
    tx.query<{ submission_id: string }>(
      activeMs === undefined
        ? `select * from lms.submit_mcq($1, $2::jsonb)`
        : `select * from lms.submit_mcq($1, $2::jsonb, p_active_ms => $3)`,
      activeMs === undefined ? [assignment, answers()] : [assignment, answers(), activeMs],
    ),
  ).then((r) => r.rows[0].submission_id);

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'LTM');
  q1 = await id(
    `insert into lms.item (org_id, outcome_ids, grade, subject, kind, stem, options, correct_index, created_by)
     values ($1, '{m8-add}', 8, 'Mathematics', 'mcq', '2 + 2 = ?', '["3","4","5"]'::jsonb, 1, $2) returning id`,
    [one.org, one.teacherA],
  );
  q2 = await id(
    `insert into lms.item (org_id, outcome_ids, grade, subject, kind, stem, options, correct_index, created_by)
     values ($1, '{m8-mul}', 8, 'Mathematics', 'mcq', '3 x 3 = ?', '["9","6"]'::jsonb, 0, $2) returning id`,
    [one.org, one.teacherA],
  );
});
afterAll(async () => {
  await db.close();
});

describe('homework time on task', () => {
  it('records the time the phone sends with the hand-in on the hand-in\'s sitting', async () => {
    const s = await sittingOf(await handIn(await work('homework'), 5 * MIN));
    expect(s.source).toBe('homework');
    expect(s.active_ms).toBe(5 * MIN);
    // The sitting spans at least its time on task, as 0107 keeps a tutor sitting.
    expect(s.span_ms).toBeGreaterThanOrEqual(5 * MIN);
  });

  it('records none when the phone sends none: an older build hands in as before', async () => {
    const s = await sittingOf(await handIn(await work('homework')));
    expect(s.active_ms).toBeNull();
    const n = await sittingOf(await handIn(await work('homework'), null));
    expect(n.active_ms).toBeNull();
  });

  it('records none for a time below zero, and the hand-in still goes through', async () => {
    const s = await sittingOf(await handIn(await work('homework'), -5));
    expect(s.active_ms).toBeNull();
  });

  it('caps the time at three hours, and at the time since the work was published', async () => {
    const long = await sittingOf(await handIn(await work('homework'), 10 * 60 * MIN));
    expect(long.active_ms).toBe(180 * MIN);
    const fresh = await sittingOf(await handIn(await work('homework', { publishedAgo: '10 minutes' }), 60 * MIN));
    expect(fresh.active_ms).toBeGreaterThanOrEqual(10 * MIN);
    expect(fresh.active_ms).toBeLessThan(11 * MIN);
  });

  it('takes the time through the once-only hand-in too, and a resend makes no second sitting', async () => {
    const hw = await work('homework');
    const key = crypto.randomUUID();
    const send = () =>
      asUser(db, one.kid8a, (tx) =>
        tx.query<{ submission_id: string }>(
          `select * from lms.submit_mcq_once($1, $2::jsonb, $3, p_active_ms => $4)`,
          [hw, answers(), key, 4 * MIN],
        ),
      ).then((r) => r.rows[0].submission_id);
    const first = await send();
    expect(await send()).toBe(first);
    expect((await sittingOf(first)).active_ms).toBe(4 * MIN);
    const { rows } = await db.query<{ n: number }>(
      `select count(distinct session_id)::int n from public.ledger_event where payload ->> 'assignmentId' = $1`,
      [hw],
    );
    expect(rows[0].n).toBe(1);
  });

  it('still hands in through the old three-argument once-only call', async () => {
    const hw = await work('homework');
    const { rows } = await asUser(db, one.kid8a, (tx) =>
      tx.query<{ submission_id: string }>(`select * from lms.submit_mcq_once($1, $2::jsonb, $3)`, [
        hw,
        answers(),
        crypto.randomUUID(),
      ]),
    );
    expect((await sittingOf(rows[0].submission_id)).active_ms).toBeNull();
  });
});

describe('test time on task, on the server\'s clock', () => {
  it('is from the test\'s start to its hand-in, whatever the phone sends', async () => {
    const t = await work('test');
    await asUser(db, one.kid8a, (tx) => tx.query(`select * from lms.start_test($1)`, [t]));
    await db.query(
      `update lms.test_start set started_at = now() - interval '10 minutes' where assignment_id = $1 and student_user_id = $2`,
      [t, one.kid8a],
    );
    const s = await sittingOf(await handIn(t, 1 * MIN));
    expect(s.source).toBe('test');
    expect(s.active_ms).toBeGreaterThanOrEqual(10 * MIN);
    expect(s.active_ms).toBeLessThan(11 * MIN);
    expect(s.span_ms).toBeGreaterThanOrEqual(s.active_ms!);
  });

  it('stops at the test\'s end when the server hands it in after time is up', async () => {
    const t = await work('test', { limit: 30 });
    await asUser(db, one.kid8a, (tx) => tx.query(`select * from lms.start_test($1)`, [t]));
    await db.query(
      `update lms.test_start set started_at = now() - interval '40 minutes' where assignment_id = $1 and student_user_id = $2`,
      [t, one.kid8a],
    );
    await asService(db, (tx) => tx.query(`select lms.finalize_tests($1)`, [t]));
    const { rows } = await db.query<{ id: string }>(
      `select id from lms.submission where assignment_id = $1 and student_user_id = $2`,
      [t, one.kid8a],
    );
    expect((await sittingOf(rows[0].id)).active_ms).toBe(30 * MIN);
  });
});

describe('closing a sitting wakes the brain', () => {
  it('puts the learner on the brain queue, so the metric counts the sitting\'s time', async () => {
    const kid = one.kid8b;
    const session = crypto.randomUUID();
    await db.query(
      `insert into public.learning_session (id, org_id, user_id, source, started_at)
       values ($1, $2, $3, 'class', now() - interval '20 minutes')`,
      [session, one.org, kid],
    );
    await db.query(`delete from public.brain_queue where user_id = $1`, [kid]);
    await asUser(db, kid, (tx) =>
      tx.query(`select public.close_learning_session($1, now(), $2)`, [session, 12 * MIN]),
    );
    const { rows } = await db.query(`select 1 from public.brain_queue where user_id = $1`, [kid]);
    expect(rows).toHaveLength(1);
  });
});

describe('learner_model.metrics', () => {
  it('is a jsonb column on the learner model', async () => {
    const { rows } = await db.query<{ data_type: string }>(
      `select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'learner_model' and column_name = 'metrics'`,
    );
    expect(rows[0]?.data_type).toBe('jsonb');
  });
});
