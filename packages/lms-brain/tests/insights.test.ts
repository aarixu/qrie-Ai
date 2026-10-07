// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../../lms-client/src/index.ts';
import { loadOutcomes, think } from '../src/index.ts';

/**
 * What a teacher is shown from the brain (migration 0027): each student's
 * standing per chapter, from concept_state, and the misconceptions their own
 * wrong answers point to. Only the class's teacher (or the school's admin)
 * sees it. Written first.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const LABEL = 'thinks the denominator may be zero';

let db: PGlite;
let one: School;
let kabir: string;
let teacher: LmsClient;

beforeAll(async () => {
  db = await freshDatabase();
  await loadOutcomes(db);
  one = await buildSchool(db, 'INS');
  kabir = await seat(db, one.org, 'student', 'INS-103', 'Kabir');
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
     values ($1, $2, $3, $4, '3')`,
    [one.org, one.year, one.s8a, kabir],
  );
  const ids: string[] = [];
  for (const [n, outcome] of [DEFINE, DEFINE, CLOSURE].entries()) {
    const { rows } = await db.query<{ id: string }>(
      `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
       values ($1, $2, 8, 'Mathematics', 'mcq', $3, '["a","b","c"]'::jsonb, 0, $4::jsonb) returning id`,
      [`probe-ins-${n}`, [outcome], `Question ${n}`, JSON.stringify(['', LABEL, ''])],
    );
    ids.push(rows[0].id);
  }
  teacher = createLmsClient(pgliteTransport(db, one.teacherA));
  for (const id of ids) await teacher.approveItem(id);
  const hw = await teacher.createAssignment({
    sectionId: one.s8a,
    subjectId: one.maths,
    kind: 'homework',
    title: 'Rational numbers',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(hw, ids);
  await teacher.publishAssignment(hw);
  // Riya falls for the same labelled distractor on both definition questions.
  await createLmsClient(pgliteTransport(db, one.kid8a)).submitMcq(hw, { [ids[0]]: 1, [ids[1]]: 1, [ids[2]]: 0 });
  await think(db, [one.kid8a, kabir]);
});
afterAll(async () => {
  await db.close();
});

describe("a teacher's view of what the brain believes", () => {
  it('knows which chapter each outcome belongs to', async () => {
    const { rows } = await db.query<{ chapter: string; grade: number; subject: string }>(
      `select chapter, grade, subject from lms.outcome where id = $1`,
      [DEFINE],
    );
    expect(rows).toEqual([{ chapter: 'rational-numbers', grade: 8, subject: 'Mathematics' }]);
  });

  it("shows each student's standing per chapter, only where there is evidence", async () => {
    const rows = await teacher.classInsights(one.s8a, one.maths);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentUserId: one.kid8a,
      displayName: 'Riya',
      chapter: 'rational-numbers',
      outcomesSeen: 2,
      answers: 3,
    });
    // Two wrong on the definition, one right on closure: well short of mastery.
    expect(rows[0].mastery).toBeLessThan(0.5);
  });

  it('names the misconception a student keeps choosing, and how often', async () => {
    expect(await teacher.classMisconceptions(one.s8a, one.maths)).toEqual([
      expect.objectContaining({ studentUserId: one.kid8a, label: LABEL, chapter: 'rational-numbers', times: 2 }),
    ]);
  });

  it('shows none of it to another teacher, or to a student', async () => {
    const other = createLmsClient(pgliteTransport(db, one.teacherB));
    await expect(other.classInsights(one.s8a, one.maths)).rejects.toThrow(/not your class/);
    await expect(other.classMisconceptions(one.s8a, one.maths)).rejects.toThrow(/not your class/);
    const riya = createLmsClient(pgliteTransport(db, one.kid8a));
    await expect(riya.classInsights(one.s8a, one.maths)).rejects.toThrow(/not your class/);
  });

  it("gives a student their own standing, and nobody else's", async () => {
    const mine = await createLmsClient(pgliteTransport(db, one.kid8a)).myProgress();
    expect(mine).toEqual([
      expect.objectContaining({ subject: 'Mathematics', chapter: 'rational-numbers', outcomesSeen: 2, answers: 3 }),
    ]);
    expect(await createLmsClient(pgliteTransport(db, kabir)).myProgress()).toEqual([]);
  });
});
