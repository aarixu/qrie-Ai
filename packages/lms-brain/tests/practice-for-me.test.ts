// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { asUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient, type PracticeForMe } from '../../lms-client/src/index.ts';
import { loadOutcomes, think } from '../src/index.ts';

/**
 * PRACTICE PICKED FROM THE CHILD'S OWN EVIDENCE (lam-one-brain Task 5; truth
 * test D14, D15, D18; review SF14; migration 0064).
 *
 * lms.practice_questions hands out a chapter's questions in a random order,
 * whatever the child has shown. lms.practice_for_me ranks the questions the
 * child may practise by what the brain holds for them: first a question
 * written to catch a wrong idea the brain has confirmed for them, then an
 * outcome whose spaced review is due, then their weakest outcomes on their
 * own, then what they have not met, then the rest; a question they have not
 * practised before goes ahead of one they have, and only then is the order
 * random. An outcome is weak until it is Strong in the student app's own
 * words (standingOf: FEW_ANSWERS answers alone, STRONG or more alone). And
 * practice shows the answer the moment it is tapped, as a closed homework's
 * review does, so an answer to a question the child has met before in
 * practice or on homework is filed as helped (rung 1) and does not raise what
 * they can do on their own.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const ZERO = 'thinks the denominator may be zero';
const DAY = 86_400_000;

let db: PGlite;
let one: School;
let teacher: LmsClient;
let flipped: string; // Kabir: Riya's answers the other way round
let fresh: string; // Meera: no answers at all
let twice: string; // Dev: two closure questions right in practice, nothing else
const item: Record<string, string> = {};

async function bankItem(ref: string, outcome: string, label: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
     values ($1, $2, 8, 'Mathematics', 'mcq', $1, '["right","wrong one","wrong two"]'::jsonb, 0, $3::jsonb)
     returning id`,
    [ref, [outcome], JSON.stringify(['', label, ''])],
  );
  return rows[0].id;
}

async function enrolIn8a(user: string, roll: string): Promise<void> {
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
     values ($1, $2, $3, $4, $5)`,
    [one.org, one.year, one.s8a, user, roll],
  );
}

const as = (user: string) => createLmsClient(pgliteTransport(db, user));
const zeroItems = () => [item.z1, item.z2, item.z3];
const onDefine = () => [item.z1, item.z2, item.z3, item.d1];
const onClosure = () => [item.c1, item.c2, item.c3, item.c4];

beforeAll(async () => {
  db = await freshDatabase();
  await loadOutcomes(db);
  one = await buildSchool(db, 'PFM');
  teacher = as(one.teacherA);
  flipped = await seat(db, one.org, 'student', 'PFM-103', 'Kabir');
  fresh = await seat(db, one.org, 'student', 'PFM-104', 'Meera');
  twice = await seat(db, one.org, 'student', 'PFM-105', 'Dev');
  await enrolIn8a(flipped, '3');
  await enrolIn8a(fresh, '4');
  await enrolIn8a(twice, '5');

  item.z1 = await bankItem('probe-pfm-z1', DEFINE, ZERO);
  item.z2 = await bankItem('probe-pfm-z2', DEFINE, ZERO);
  item.z3 = await bankItem('probe-pfm-z3', DEFINE, ZERO); // never set: practice only
  item.d1 = await bankItem('probe-pfm-d1', DEFINE, '');
  item.c1 = await bankItem('probe-pfm-c1', CLOSURE, '');
  item.c2 = await bankItem('probe-pfm-c2', CLOSURE, '');
  item.c3 = await bankItem('probe-pfm-c3', CLOSURE, '');
  item.c4 = await bankItem('probe-pfm-c4', CLOSURE, '');
  for (const id of Object.values(item)) await teacher.approveItem(id);

  const hw = await teacher.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'homework', title: 'Rational numbers',
    dueAt: new Date(Date.now() + DAY).toISOString(), answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(hw, [item.z1, item.z2, item.c1, item.c2, item.c3]);
  await teacher.publishAssignment(hw);
  // Riya: the zero idea on both questions that catch it, closure right three times.
  await as(one.kid8a).submitMcq(hw, { [item.z1]: 1, [item.z2]: 1, [item.c1]: 0, [item.c2]: 0, [item.c3]: 0 });
  // Kabir: the other way round — defining right twice, closure wrong three times (different options).
  await as(flipped).submitMcq(hw, { [item.z1]: 0, [item.z2]: 0, [item.c1]: 1, [item.c2]: 2, [item.c3]: 1 });
  // The homework closes, so its questions may be practised (and its review shows the answers).
  await db.query(`update lms.assignment set due_at = now() - interval '1 hour' where id = $1`, [hw]);
  // Dev: two closure questions right in practice, the first time he meets them.
  await as(twice).checkPracticeAnswer(crypto.randomUUID(), item.c1, 0);
  await as(twice).checkPracticeAnswer(crypto.randomUUID(), item.c2, 0);
  await think(db, [one.kid8a, flipped, twice]);
});
afterAll(async () => {
  await db.close();
});

const ids = (rows: PracticeForMe[]) => rows.map((r) => r.itemId);

describe('a child weak on an outcome, with a wrong idea the brain confirmed', () => {
  it('gets the questions that catch that idea first, saying what to watch out for', async () => {
    const rows = await as(one.kid8a).practiceForMe('Mathematics', 3);
    expect(new Set(ids(rows))).toEqual(new Set(zeroItems()));
    for (const r of rows) {
      expect(r).toMatchObject({
        reason: 'misconception', watchOut: ZERO, outcomeId: DEFINE, subject: 'Mathematics', chapter: 'rational-numbers',
      });
      expect(r.outcomeTitle.length).toBeGreaterThan(0);
    }
  });

  it('then the rest of that outcome, before the outcome they do well on alone', async () => {
    const rows = await as(one.kid8a).practiceForMe('Mathematics', 20);
    expect(rows).toHaveLength(8);
    expect(new Set(ids(rows).slice(0, 4))).toEqual(new Set(onDefine()));
    expect(rows[3]).toMatchObject({ itemId: item.d1, reason: 'weak', watchOut: null });
    expect(new Set(ids(rows).slice(4))).toEqual(new Set(onClosure()));
    for (const r of rows.slice(4)) expect(r).toMatchObject({ reason: 'more', watchOut: null, outcomeId: CLOSURE });
  });

  it('hands out a question and its options, never its answer', async () => {
    const [r] = await as(one.kid8a).practiceForMe('Mathematics', 1);
    expect(r.options).toEqual(['right', 'wrong one', 'wrong two']);
    expect(Object.keys(r)).not.toContain('correctIndex');
  });
});

describe('the same questions, answered the other way round', () => {
  it('turn the order round: closure first, no wrong idea to watch out for', async () => {
    const rows = await as(flipped).practiceForMe('Mathematics', 20);
    expect(rows).toHaveLength(8);
    expect(new Set(ids(rows).slice(0, 4))).toEqual(new Set(onClosure()));
    for (const r of rows.slice(0, 4)) expect(r).toMatchObject({ reason: 'weak', outcomeId: CLOSURE });
    for (const r of rows) expect(r.reason).not.toBe('misconception');
    for (const r of rows) expect(r.watchOut).toBeNull();
  });

  it('a child with no answers gets every question as new, in no particular order', async () => {
    const rows = await as(fresh).practiceForMe('Mathematics', 20);
    expect(rows).toHaveLength(8);
    for (const r of rows) expect(r).toMatchObject({ reason: 'new', watchOut: null });
  });
});

describe('an outcome is weak until the app calls it Strong', () => {
  it('two right answers alone are not yet Strong: that outcome comes before what is new', async () => {
    const { rows: cs } = await db.query<{ unassisted_observations: number }>(
      `select unassisted_observations from public.concept_state where user_id = $1 and outcome_id = $2`,
      [twice, CLOSURE],
    );
    expect(cs[0].unassisted_observations).toBe(2);
    const rows = await as(twice).practiceForMe('Mathematics', 20);
    expect(new Set(ids(rows).slice(0, 4))).toEqual(new Set(onClosure()));
    for (const r of rows.slice(0, 4)) expect(r).toMatchObject({ reason: 'weak', outcomeId: CLOSURE });
    for (const r of rows.slice(4)) expect(r).toMatchObject({ reason: 'new', outcomeId: DEFINE });
  });
});

describe('a review that has come due', () => {
  it('goes ahead of a weak outcome, behind a confirmed wrong idea', async () => {
    // Kabir's strong outcome comes due for its spaced review.
    await db.query(
      `update public.concept_state set next_review_at = now() - interval '1 hour' where user_id = $1 and outcome_id = $2`,
      [flipped, DEFINE],
    );
    const rows = await as(flipped).practiceForMe('Mathematics', 20);
    expect(new Set(ids(rows).slice(0, 4))).toEqual(new Set(onDefine()));
    for (const r of rows.slice(0, 4)) expect(r).toMatchObject({ reason: 'review', outcomeId: DEFINE });
    expect(rows[4]).toMatchObject({ reason: 'weak', outcomeId: CLOSURE });

    await db.query(
      `update public.concept_state set next_review_at = now() - interval '1 hour' where user_id = $1 and outcome_id = $2`,
      [one.kid8a, CLOSURE],
    );
    const riya = await as(one.kid8a).practiceForMe('Mathematics', 20);
    expect(new Set(ids(riya).slice(0, 3))).toEqual(new Set(zeroItems()));
    expect(riya[3]).toMatchObject({ reason: 'review', outcomeId: CLOSURE });
  });
});

describe('practice after the answer was shown (SF14)', () => {
  const unassisted = async (user: string, outcome: string) =>
    (
      await db.query<{ unassisted_mastery: number; unassisted_observations: number; mastery: number }>(
        `select unassisted_mastery, unassisted_observations, mastery from public.concept_state
          where user_id = $1 and outcome_id = $2`,
        [user, outcome],
      )
    ).rows[0];
  const rungs = async (user: string, itemId: string) =>
    (
      await db.query<{ rung: number }>(
        `select (payload ->> 'assistanceRung')::int as rung from public.ledger_event
          where user_id = $1 and source = 'practice' and payload ->> 'itemId' = $2 order by received_at, seq`,
        [user, itemId],
      )
    ).rows.map((r) => r.rung);

  it('the first answer is cold; the same question again is helped, and adds nothing alone', async () => {
    const meera = as(fresh);
    expect((await meera.checkPracticeAnswer(crypto.randomUUID(), item.d1, 0)).correct).toBe(true);
    await think(db, [fresh]);
    const first = await unassisted(fresh, DEFINE);
    expect(first.unassisted_observations).toBe(1);

    // A new round, the same question: she has seen its answer.
    expect((await meera.checkPracticeAnswer(crypto.randomUUID(), item.d1, 0)).correct).toBe(true);
    await think(db, [fresh]);
    const again = await unassisted(fresh, DEFINE);
    expect(await rungs(fresh, item.d1)).toEqual([0, 1]);
    expect(again.unassisted_observations).toBe(1);
    expect(again.unassisted_mastery).toBeCloseTo(first.unassisted_mastery, 6);
  });

  it('a question met on a closed homework, whose review shows the answer, is helped in practice', async () => {
    const before = await unassisted(one.kid8a, CLOSURE);
    expect((await as(one.kid8a).checkPracticeAnswer(crypto.randomUUID(), item.c1, 0)).correct).toBe(true);
    await think(db, [one.kid8a]);
    expect(await rungs(one.kid8a, item.c1)).toEqual([1]);
    const after = await unassisted(one.kid8a, CLOSURE);
    expect(after.unassisted_observations).toBe(before.unassisted_observations);
    expect(after.unassisted_mastery).toBeCloseTo(before.unassisted_mastery, 6);
  });

  it("another child's practice of the question does not make it seen for this one", async () => {
    await as(one.kid8a).checkPracticeAnswer(crypto.randomUUID(), item.d1, 0);
    expect(await rungs(one.kid8a, item.d1)).toEqual([0]);
  });

  it('a question already practised goes behind one that has not been', async () => {
    const rows = await as(fresh).practiceForMe('Mathematics', 20);
    // Meera met DEFINE only through d1; every other DEFINE question is unpractised.
    const define = rows.filter((r) => r.outcomeId === DEFINE).map((r) => r.itemId);
    expect(define.at(-1)).toBe(item.d1);
  });
});

describe('who may ask', () => {
  it('a teacher, who is in no class as a child, gets nothing', async () => {
    expect(await teacher.practiceForMe('Mathematics', 5)).toEqual([]);
  });

  it('nobody signed out may call it; a signed-in child may', async () => {
    const { rows } = await db.query<{ anon: boolean; signed_in: boolean }>(
      `select has_function_privilege('anon', 'lms.practice_for_me(text, integer)', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'lms.practice_for_me(text, integer)', 'EXECUTE') as signed_in`,
    );
    expect(rows[0]).toEqual({ anon: false, signed_in: true });
    const mine = await asUser(db, one.kid8a, (tx) => tx.query(`select item_id from lms.practice_for_me('Mathematics', 2)`));
    expect(mine.rows).toHaveLength(2);
  });

  it('every subject when none is named, and none of a subject the class is not taught', async () => {
    expect(await as(one.kid8a).practiceForMe(null, 50)).toHaveLength(8);
    expect(await as(one.kid8a).practiceForMe('Science', 5)).toEqual([]);
  });
});

describe('a test the child has not had back (review M1)', () => {
  it('names no wrong idea it showed until the results are out, as their own report does', async () => {
    // Asha shows ZERO on both questions of a test, and on nothing else.
    const asha = await seat(db, one.org, 'student', 'PFM-106', 'Asha');
    await enrolIn8a(asha, '6');
    const t1 = await bankItem('probe-pfm-t1', DEFINE, ZERO);
    const t2 = await bankItem('probe-pfm-t2', DEFINE, ZERO);
    await teacher.approveItem(t1);
    await teacher.approveItem(t2);
    const test = await teacher.createAssignment({
      sectionId: one.s8a, subjectId: one.maths, kind: 'test', title: 'Unit test',
      dueAt: new Date(Date.now() + DAY).toISOString(), timeLimitMinutes: 10, answerTypes: ['mcq'],
    });
    await teacher.setAssignmentItems(test, [t1, t2]);
    await teacher.publishAssignment(test);
    await as(asha).startTest(test);
    await as(asha).submitMcq(test, { [t1]: 1, [t2]: 1 });
    await think(db, [asha]);
    // The brain holds it; the teacher sees it on her report, she does not.
    expect((await teacher.studentMistakes(asha)).map((m) => m.label)).toEqual([ZERO]);
    expect(await as(asha).studentMistakes(asha)).toEqual([]);

    const before = await as(asha).practiceForMe('Mathematics', 20);
    expect(before.length).toBeGreaterThan(0);
    for (const r of before) expect(r).toMatchObject({ watchOut: null });
    for (const r of before) expect(r.reason).not.toBe('misconception');

    await db.query(`update lms.assignment set results_released_at = now() where id = $1`, [test]);
    const after = await as(asha).practiceForMe('Mathematics', 3);
    expect(new Set(ids(after))).toEqual(new Set(zeroItems()));
    for (const r of after) expect(r).toMatchObject({ reason: 'misconception', watchOut: ZERO });
  });
});
