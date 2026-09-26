// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from './fixtures';
import { asUser, freshDatabase } from './harness';

/**
 * L2 of the LMS build: the question bank and homework (migration 0023).
 *
 * The two rules the rest hangs on:
 *   - only an item a teacher of the school has approved can be set as work —
 *     the review pipeline for 4,697 questions nobody has reviewed yet;
 *   - a student never sees an answer key.
 * Written first and watched failing before 0023 existed.
 */

let db: PGlite;
let one: School;
let two: School;
let libraryItem: string;

const id = async (sql: string, params: unknown[] = []): Promise<string> =>
  (await db.query<{ id: string }>(sql, params)).rows[0].id;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'ONE');
  two = await buildSchool(db, 'TWO');
  libraryItem = await id(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
     values ('probe-x', '{sci8-x}', 8, 'Mathematics', 'mcq', 'What is 2 + 2?',
             '["3","4","5","22"]'::jsonb, 1, '["adds wrong","","counts on","joins digits"]'::jsonb)
     returning id`,
  );
});
afterAll(async () => {
  await db.close();
});

const asTeacher = <T>(user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, (tx) => tx.query<T>(sql, params));

// Values, not a select from lms.section: a section the teacher cannot see
// would select nothing, and the test would fail on an empty result instead of
// on the policy it is meant to exercise.
async function draftHomework(teacher: string, section: string, subject: string, org = one.org): Promise<string> {
  const { rows } = await asTeacher<{ id: string }>(
    teacher,
    `insert into lms.assignment (org_id, section_id, subject_id, created_by, kind, title, due_at, answer_types)
     values ($1, $2, $3, $4, 'homework', 'Ch 1', now() + interval '2 days', '{mcq}')
     returning id`,
    [org, section, subject, teacher],
  );
  return rows[0].id;
}

describe('the question bank', () => {
  it('shows a teacher the Qrie library', async () => {
    const { rows } = await asTeacher<{ id: string }>(one.teacherA, `select id from lms.item where id = $1`, [libraryItem]);
    expect(rows).toHaveLength(1);
  });

  it('shows a student no item at all, so no answer key', async () => {
    const { rows } = await asTeacher(one.kid8a, `select correct_index from lms.item`);
    expect(rows).toEqual([]);
  });

  it("approves a teacher's own question for their school the moment they write it", async () => {
    const { rows } = await asTeacher<{ id: string }>(
      one.teacherA,
      `insert into lms.item (org_id, grade, subject, kind, stem, options, correct_index, created_by)
       values ($1, 8, 'Mathematics', 'mcq', 'What is 3 x 3?', '["6","9"]'::jsonb, 1, $2) returning id`,
      [one.org, one.teacherA],
    );
    const approved = await db.query(`select 1 from lms.item_approval where org_id = $1 and item_id = $2`, [
      one.org,
      rows[0].id,
    ]);
    expect(approved.rows).toHaveLength(1);
  });

  it('lets a teacher approve a library item for their own school', async () => {
    await asTeacher(one.teacherA, `insert into lms.item_approval (org_id, item_id, approved_by) values ($1, $2, $3)`, [
      one.org,
      libraryItem,
      one.teacherA,
    ]);
  });

  it('does not let a teacher approve anything for another school', async () => {
    await expect(
      asTeacher(one.teacherA, `insert into lms.item_approval (org_id, item_id, approved_by) values ($1, $2, $3)`, [
        two.org,
        libraryItem,
        one.teacherA,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it('does not let a student approve anything', async () => {
    await expect(
      asTeacher(one.kid8a, `insert into lms.item_approval (org_id, item_id, approved_by) values ($1, $2, $3)`, [
        one.org,
        libraryItem,
        one.kid8a,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it('refuses an MCQ whose correct answer is not one of its options', async () => {
    await expect(
      db.query(
        `insert into lms.item (org_id, grade, subject, kind, stem, options, correct_index)
         values ($1, 8, 'Mathematics', 'mcq', 'x', '["a","b"]'::jsonb, 2)`,
        [one.org],
      ),
    ).rejects.toThrow(/check/);
  });
});

describe('setting homework', () => {
  it('lets a teacher set homework for a section and subject they teach', async () => {
    expect(await draftHomework(one.teacherA, one.s8a, one.maths)).toMatch(/[0-9a-f-]{36}/);
  });

  it('refuses the right section in a subject they do not teach', async () => {
    await expect(draftHomework(one.teacherA, one.s8a, one.science)).rejects.toThrow(/row-level security/);
  });

  it('refuses their subject in a section they do not teach', async () => {
    await expect(draftHomework(one.teacherA, one.s8b, one.maths)).rejects.toThrow(/row-level security/);
  });

  it('refuses an item no teacher of this school has approved', async () => {
    const unreviewed = await id(
      `insert into lms.item (library_ref, grade, subject, kind, stem, options, correct_index)
       values ('probe-unreviewed', 8, 'Mathematics', 'mcq', 'q', '["a","b"]'::jsonb, 0) returning id`,
    );
    const hw = await draftHomework(one.teacherA, one.s8a, one.maths);
    await expect(
      asTeacher(one.teacherA, `insert into lms.assignment_item (assignment_id, item_id, position) values ($1, $2, 1)`, [
        hw,
        unreviewed,
      ]),
    ).rejects.toThrow(/not approved/);
  });

  it('accepts an approved item', async () => {
    const hw = await draftHomework(one.teacherA, one.s8a, one.maths);
    await asTeacher(one.teacherA, `insert into lms.assignment_item (assignment_id, item_id, position) values ($1, $2, 1)`, [
      hw,
      libraryItem,
    ]);
  });

  it('freezes the questions of an assignment once it is published', async () => {
    const hw = await draftHomework(one.teacherA, one.s8a, one.maths);
    await asTeacher(one.teacherA, `insert into lms.assignment_item (assignment_id, item_id, position) values ($1, $2, 1)`, [
      hw,
      libraryItem,
    ]);
    await asTeacher(one.teacherA, `update lms.assignment set published_at = now() where id = $1`, [hw]);
    await expect(
      asTeacher(one.teacherA, `delete from lms.assignment_item where assignment_id = $1`, [hw]),
    ).rejects.toThrow(/published/);
  });
});

describe('what a student receives', () => {
  let published: string;
  let draft: string;
  let otherSection: string;

  beforeAll(async () => {
    published = await draftHomework(one.teacherA, one.s8a, one.maths);
    await asTeacher(one.teacherA, `insert into lms.assignment_item (assignment_id, item_id, position) values ($1, $2, 1)`, [
      published,
      libraryItem,
    ]);
    await asTeacher(one.teacherA, `update lms.assignment set published_at = now() where id = $1`, [published]);
    draft = await draftHomework(one.teacherA, one.s8a, one.maths);
    otherSection = await draftHomework(one.teacherB, one.s8b, one.science);
    await asTeacher(one.teacherB, `update lms.assignment set published_at = now() where id = $1`, [otherSection]);
  });

  it("sees their section's published homework, and not a draft or another section's", async () => {
    const { rows } = await asTeacher<{ id: string }>(one.kid8a, `select id from lms.assignment`);
    const seen = rows.map((r) => r.id);
    expect(seen).toContain(published);
    expect(seen).not.toContain(draft);
    expect(seen).not.toContain(otherSection);
  });

  it('receives the questions of their homework, without the answers', async () => {
    const { rows } = await asTeacher<Record<string, unknown>>(one.kid8a, `select * from lms.assignment_questions($1)`, [
      published,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stem: 'What is 2 + 2?', options: ['3', '4', '5', '22'] });
    expect(Object.keys(rows[0])).not.toContain('correct_index');
    expect(Object.keys(rows[0])).not.toContain('misconceptions');
  });

  it("receives nothing for another section's homework", async () => {
    const { rows } = await asTeacher(one.kid8a, `select * from lms.assignment_questions($1)`, [otherSection]);
    expect(rows).toEqual([]);
  });

  it('receives nothing for a draft', async () => {
    const { rows } = await asTeacher(one.kid8a, `select * from lms.assignment_questions($1)`, [draft]);
    expect(rows).toEqual([]);
  });
});
