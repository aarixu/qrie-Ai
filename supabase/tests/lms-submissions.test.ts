// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from './fixtures';
import { asService, asUser, freshDatabase } from './harness';

/**
 * L3 of the LMS build, MCQ half: submissions and marks (migration 0024).
 *
 * The rule the rest serves: a student sends only which options they chose.
 * Whether that is right is decided by the database, from a key the student
 * can never read — so no client can claim a mark it did not earn.
 * Written first and watched failing before 0024 existed.
 */

let db: PGlite;
let one: School;
let q1: string; // 2 + 2 = ? key 1
let q2: string; // 3 x 3 = ? key 0

const id = async (sql: string, params: unknown[] = []): Promise<string> =>
  (await db.query<{ id: string }>(sql, params)).rows[0].id;

async function homework(opts: { attempts?: number; dueInDays?: number; publish?: boolean } = {}): Promise<string> {
  const hw = await id(
    `insert into lms.assignment (org_id, section_id, subject_id, created_by, kind, title, due_at, attempts_allowed, answer_types)
     values ($1, $2, $3, $4, 'homework', 'HW', now() + make_interval(days => $5), $6, '{mcq}') returning id`,
    [one.org, one.s8a, one.maths, one.teacherA, opts.dueInDays ?? 2, opts.attempts ?? 1],
  );
  await db.query(`insert into lms.assignment_item (assignment_id, item_id, position) values ($1, $2, 1), ($1, $3, 2)`, [
    hw,
    q1,
    q2,
  ]);
  if (opts.publish ?? true) await db.query(`update lms.assignment set published_at = now() where id = $1`, [hw]);
  return hw;
}

const submit = (student: string, hw: string, answers: Record<string, number | null>) =>
  asUser(db, student, (tx) =>
    tx.query<{ submission_id: string; correct: number; total: number }>(
      `select * from lms.submit_mcq($1, $2::jsonb)`,
      [hw, JSON.stringify(answers)],
    ),
  ).then((r) => r.rows[0]);

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'SUB');
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

describe('a student submitting MCQ homework', () => {
  it('is marked by the database, from a key the student cannot read', async () => {
    const hw = await homework();
    const r = await submit(one.kid8a, hw, { [q1]: 1, [q2]: 1 });
    expect(r).toMatchObject({ correct: 1, total: 2 });
  });

  it('counts an unanswered question as not correct', async () => {
    const hw = await homework();
    const r = await submit(one.kid8a, hw, { [q1]: 1 });
    expect(r).toMatchObject({ correct: 1, total: 2 });
  });

  it('cannot write its own answers or marks directly', async () => {
    const hw = await homework();
    const { submission_id } = await submit(one.kid8a, hw, { [q1]: 0, [q2]: 1 });
    await expect(
      asUser(db, one.kid8a, (tx) =>
        tx.query(`update lms.submission_answer set correct = true where submission_id = $1`, [submission_id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, one.kid8a, (tx) =>
        tx.query(`insert into lms.mark (submission_id, machine_correct, machine_total) values ($1, 2, 2)`, [submission_id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('is refused an answer to a question that is not on the assignment', async () => {
    const hw = await homework();
    await expect(submit(one.kid8a, hw, { [q1]: 1, 'aaaaaaaa-0000-0000-0000-000000000000': 0 })).rejects.toThrow(
      /not on this assignment/,
    );
  });

  it('is refused an option that the question does not have — rejected, not clamped', async () => {
    const hw = await homework();
    await expect(submit(one.kid8a, hw, { [q1]: 7 })).rejects.toThrow(/no option 7/);
  });

  it('is refused for a section the student is not in', async () => {
    const hw = await homework();
    await expect(submit(one.kid8b, hw, { [q1]: 1 })).rejects.toThrow(/not your homework/);
  });

  it('is refused for a draft', async () => {
    const hw = await homework({ publish: false });
    await expect(submit(one.kid8a, hw, { [q1]: 1 })).rejects.toThrow(/not your homework/);
  });

  it('is refused an attempt beyond the number allowed', async () => {
    const hw = await homework({ attempts: 1 });
    await submit(one.kid8a, hw, { [q1]: 1 });
    await expect(submit(one.kid8a, hw, { [q1]: 1 })).rejects.toThrow(/no attempts left/);
  });

  it('numbers a second allowed attempt', async () => {
    const hw = await homework({ attempts: 2 });
    await submit(one.kid8a, hw, { [q1]: 0 });
    const second = await submit(one.kid8a, hw, { [q1]: 1 });
    const { rows } = await db.query<{ attempt: number }>(`select attempt from lms.submission where id = $1`, [
      second.submission_id,
    ]);
    expect(rows[0].attempt).toBe(2);
  });

  it('flags a submission after the due date as late, and still takes it', async () => {
    const hw = await homework({ dueInDays: -1 });
    const { submission_id } = await submit(one.kid8a, hw, { [q1]: 1 });
    const { rows } = await db.query<{ late: boolean }>(`select late from lms.submission where id = $1`, [submission_id]);
    expect(rows[0].late).toBe(true);
  });

  it('files each answer in the ledger as homework evidence, under the school, with the outcome', async () => {
    const hw = await homework();
    await submit(one.kid8a, hw, { [q1]: 1, [q2]: 1 });
    const { rows } = await db.query<{ source: string; outcome_ids: string[]; correct: string; org_id: string }>(
      `select source, outcome_ids, payload->>'correct' as correct, org_id from public.ledger_event
        where user_id = $1 and payload->>'assignmentId' = $2 order by seq`,
      [one.kid8a, hw],
    );
    expect(rows).toEqual([
      { source: 'homework', outcome_ids: ['m8-add'], correct: 'true', org_id: one.org },
      { source: 'homework', outcome_ids: ['m8-mul'], correct: 'false', org_id: one.org },
    ]);
  });
});

describe('who sees a submission and its mark', () => {
  let submission: string;
  beforeAll(async () => {
    const hw = await homework();
    submission = (await submit(one.kid8a, hw, { [q1]: 1, [q2]: 0 })).submission_id;
  });

  it('the student who made it', async () => {
    const { rows } = await asUser(db, one.kid8a, (tx) =>
      tx.query(`select machine_correct from lms.mark where submission_id = $1`, [submission]),
    );
    expect(rows).toEqual([{ machine_correct: 2 }]);
  });

  it('not a classmate', async () => {
    const mate = await seat(db, one.org, 'student', 'SUB-103', 'Mate');
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id) values ($1, $2, $3, $4)`,
      [one.org, one.year, one.s8a, mate],
    );
    const { rows } = await asUser(db, mate, (tx) => tx.query(`select 1 from lms.submission where id = $1`, [submission]));
    expect(rows).toEqual([]);
  });

  it('the teacher of that class', async () => {
    const { rows } = await asUser(db, one.teacherA, (tx) => tx.query(`select 1 from lms.submission where id = $1`, [submission]));
    expect(rows).toHaveLength(1);
  });

  it('not a teacher of another class', async () => {
    const { rows } = await asUser(db, one.teacherB, (tx) => tx.query(`select 1 from lms.submission where id = $1`, [submission]));
    expect(rows).toEqual([]);
  });
});

describe("a teacher's mark", () => {
  let submission: string;
  beforeAll(async () => {
    const hw = await homework();
    submission = (await submit(one.kid8a, hw, { [q1]: 1, [q2]: 1 })).submission_id;
  });

  it('is kept beside the machine mark, with who gave it and when', async () => {
    await asUser(db, one.teacherA, (tx) => tx.query(`select lms.set_teacher_mark($1, 2, 2)`, [submission]));
    const { rows } = await db.query<Record<string, unknown>>(
      `select machine_correct, machine_total, teacher_score::float8 as teacher_score,
              teacher_max::float8 as teacher_max, marked_by from lms.mark where submission_id = $1`,
      [submission],
    );
    expect(rows[0]).toEqual({ machine_correct: 1, machine_total: 2, teacher_score: 2, teacher_max: 2, marked_by: one.teacherA });
  });

  it('keeps every change in a history nobody can edit', async () => {
    await asUser(db, one.teacherA, (tx) => tx.query(`select lms.set_teacher_mark($1, 1.5, 2)`, [submission]));
    const { rows } = await db.query<{ old_score: number | null; new_score: number }>(
      `select old_score::float8 as old_score, new_score::float8 as new_score from lms.mark_history
        where submission_id = $1 order by changed_at, new_score desc`,
      [submission],
    );
    expect(rows.map((r) => [r.old_score, r.new_score])).toEqual([
      [null, 2],
      [2, 1.5],
    ]);
    await expect(
      asUser(db, one.teacherA, (tx) => tx.query(`delete from lms.mark_history where submission_id = $1`, [submission])),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot be given by a teacher who does not teach the class', async () => {
    await expect(
      asUser(db, one.teacherB, (tx) => tx.query(`select lms.set_teacher_mark($1, 0, 2)`, [submission])),
    ).rejects.toThrow(/not your class/);
  });

  it('refuses a score above the maximum', async () => {
    await expect(
      asUser(db, one.teacherA, (tx) => tx.query(`select lms.set_teacher_mark($1, 3, 2)`, [submission])),
    ).rejects.toThrow(/check|between/);
  });
});

describe('the nightly purge', () => {
  it('never touches a submission or a mark', async () => {
    const hw = await homework();
    const { submission_id } = await submit(one.kid8a, hw, { [q1]: 1 });
    await db.query(`update lms.submission set submitted_at = now() - interval '400 days' where id = $1`, [submission_id]);
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(1)`));
    const { rows } = await db.query(`select 1 from lms.mark where submission_id = $1`, [submission_id]);
    expect(rows).toHaveLength(1);
  });
});
