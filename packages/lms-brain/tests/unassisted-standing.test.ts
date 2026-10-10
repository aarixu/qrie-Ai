// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../../lms-client/src/index.ts';
import { loadOutcomes, think } from '../src/index.ts';

/**
 * WHAT A CHILD CAN DO ON THEIR OWN, SHOWN FIRST (lam-one-brain Task 3; truth
 * test D08, D26; migration 0105).
 *
 * concept_state.mastery counts an answer given after hints (at a discount),
 * so a child carried by help reads as knowing it. Every report the school
 * apps read now returns, beside mastery, the belief from answers given alone
 * (unassisted_mastery, null when there is none), how many those were, and
 * how the child does with help. And when a child has answered but the brain
 * has not yet folded it, the apps can say so instead of "no answers yet".
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';

let db: PGlite;
let one: School;
let helped: string; // 30 right answers, every one on the tutor's rung 7; none alone
let waiting: string; // handed in homework the brain has not read yet
let mixed: string; // one outcome answered alone, another only with help
let teacher: LmsClient;
let hw: string;
let items: string[];

const orgOf = async (user: string): Promise<string> =>
  (await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [user])).rows[0]
    .org_id;

/** One tutor sitting written straight into the ledger, as the database owner. */
async function tutorSitting(user: string, answers: { outcome: string; rung: number; correct: boolean }[]): Promise<void> {
  const org = await orgOf(user);
  const session = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'class', now())`,
    [session, org, user],
  );
  for (const [n, a] of answers.entries()) {
    await db.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
       values ($1, $2, $3, $4, $5, now(), 'answered', 'class', 'tap', $6, $7::jsonb)`,
      [
        crypto.randomUUID(), org, user, session, n + 1, [a.outcome],
        JSON.stringify({
          correct: a.correct, chosenIndex: a.correct ? 0 : 1, probeId: `probe-helped-${session}-${n}`,
          attempt: 1, assistanceRung: a.rung,
        }),
      ],
    );
  }
}

async function enrolIn8a(user: string, roll: string): Promise<void> {
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
     values ($1, $2, $3, $4, $5)`,
    [one.org, one.year, one.s8a, user, roll],
  );
}

beforeAll(async () => {
  db = await freshDatabase();
  await loadOutcomes(db);
  one = await buildSchool(db, 'UNA');
  helped = await seat(db, one.org, 'student', 'UNA-103', 'Kabir');
  waiting = await seat(db, one.org, 'student', 'UNA-104', 'Meera');
  mixed = await seat(db, one.org, 'student', 'UNA-105', 'Asha');
  await enrolIn8a(helped, '3');
  await enrolIn8a(waiting, '4');
  await enrolIn8a(mixed, '5');

  items = [];
  for (const [n, outcome] of [DEFINE, DEFINE, CLOSURE].entries()) {
    const { rows } = await db.query<{ id: string }>(
      `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
       values ($1, $2, 8, 'Mathematics', 'mcq', $3, '["a","b","c"]'::jsonb, 0, '[]'::jsonb) returning id`,
      [`probe-una-${n}`, [outcome], `Question ${n}`],
    );
    items.push(rows[0].id);
  }
  teacher = createLmsClient(pgliteTransport(db, one.teacherA));
  for (const id of items) await teacher.approveItem(id);
  hw = await teacher.createAssignment({
    sectionId: one.s8a,
    subjectId: one.maths,
    kind: 'homework',
    title: 'Rational numbers',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(hw, items);
  await teacher.publishAssignment(hw);

  // Riya answers alone, as homework always is: right, right, wrong.
  await createLmsClient(pgliteTransport(db, one.kid8a)).submitMcq(hw, { [items[0]]: 0, [items[1]]: 0, [items[2]]: 1 });
  // Kabir: thirty right answers across three sittings, every one after the tutor walked him to it.
  for (let s = 0; s < 3; s++) {
    await tutorSitting(helped, Array.from({ length: 10 }, () => ({ outcome: DEFINE, rung: 7, correct: true })));
  }
  // Asha: two cold rights on one outcome, two helped rights on the other, one chapter.
  await tutorSitting(mixed, [
    { outcome: DEFINE, rung: 0, correct: true },
    { outcome: DEFINE, rung: 0, correct: true },
    { outcome: CLOSURE, rung: 7, correct: true },
    { outcome: CLOSURE, rung: 7, correct: true },
  ]);
  await think(db, [one.kid8a, helped, mixed]);
  // Meera hands in after the brain ran.
  await createLmsClient(pgliteTransport(db, waiting)).submitMcq(hw, { [items[0]]: 0, [items[1]]: 1, [items[2]]: 0 });
});
afterAll(async () => {
  await db.close();
});

/** What concept_state holds, averaged the way the reports must: alone only where answered alone. */
async function truth(user: string): Promise<{ unassisted: number | null; observations: number; assisted: number | null }> {
  const { rows } = await db.query<{ unassisted: number | null; observations: number; assisted: number | null }>(
    `select avg(unassisted_mastery) filter (where unassisted_observations > 0)::float8 as unassisted,
            coalesce(sum(unassisted_observations), 0)::int as observations,
            avg(assisted_performance) filter (where answer_observations > unassisted_observations)::float8 as assisted
       from public.concept_state where user_id = $1 and answer_observations > 0`,
    [user],
  );
  return rows[0];
}

describe('a child carried by help does not read as knowing it', () => {
  it('the fold itself: thirty helped rights, no answer alone', async () => {
    const t = await truth(helped);
    expect(t.observations).toBe(0);
    expect(t.unassisted).toBeNull();
    expect(t.assisted!).toBeGreaterThanOrEqual(0.7);
  });

  it('their own progress says so: nothing alone, high with help', async () => {
    const [row] = await createLmsClient(pgliteTransport(db, helped)).myProgress();
    expect(row).toMatchObject({
      chapter: 'rational-numbers',
      answers: 30,
      unassistedMastery: null,
      unassistedObservations: 0,
    });
    expect(row.assistedPerformance!).toBeGreaterThanOrEqual(0.7);
    expect(row).toHaveProperty('mastery');
  });

  it('the teacher sees the same: no figure alone, the help figure beside it', async () => {
    const rows = await teacher.classInsights(one.s8a, one.maths);
    const kabir = rows.find((r) => r.studentUserId === helped)!;
    expect(kabir).toMatchObject({ unassistedMastery: null, unassistedObservations: 0, answers: 30 });
    expect(kabir.assistedPerformance!).toBeGreaterThanOrEqual(0.7);
  });

  it("the teacher's figure for a child who answered alone is the fold's unassisted belief", async () => {
    const t = await truth(one.kid8a);
    const riya = (await teacher.classInsights(one.s8a, one.maths)).find((r) => r.studentUserId === one.kid8a)!;
    expect(riya.unassistedObservations).toBe(3);
    expect(riya.unassistedMastery).toBeCloseTo(t.unassisted!, 6);
    expect(riya.assistedPerformance).toBeNull();
  });

  it('a chapter answered partly alone: the figure alone is over what was answered alone, the help figure over what had help', async () => {
    const { rows } = await db.query<{ outcome_id: string; unassisted_mastery: number; assisted_performance: number }>(
      `select outcome_id, unassisted_mastery, assisted_performance from public.concept_state
        where user_id = $1 and answer_observations > 0`,
      [mixed],
    );
    const define = rows.find((r) => r.outcome_id === DEFINE)!;
    const closure = rows.find((r) => r.outcome_id === CLOSURE)!;
    const asha = (await teacher.classInsights(one.s8a, one.maths)).find((r) => r.studentUserId === mixed)!;
    expect(asha).toMatchObject({ unassistedObservations: 2, answers: 4, outcomesSeen: 2 });
    expect(asha.unassistedMastery).toBeCloseTo(define.unassisted_mastery, 6);
    expect(asha.assistedPerformance).toBeCloseTo(closure.assisted_performance, 6);
    const [mine] = await createLmsClient(pgliteTransport(db, mixed)).myProgress();
    expect(mine.unassistedMastery).toBeCloseTo(define.unassisted_mastery, 6);
    expect(mine.assistedPerformance).toBeCloseTo(closure.assisted_performance, 6);
  });

  it("the child's report, for the teacher and for the child, carries the same three figures", async () => {
    const t = await truth(one.kid8a);
    for (const who of [one.teacherA, one.kid8a]) {
      const c = createLmsClient(pgliteTransport(db, who));
      const [chapter] = await c.studentChapters(one.kid8a);
      expect(chapter.unassistedMastery).toBeCloseTo(t.unassisted!, 6);
      expect(chapter).toMatchObject({ unassistedObservations: 3, assistedPerformance: null });
      const maths = (await c.studentSubjects(one.kid8a)).find((s) => s.subjectId === one.maths)!;
      expect(maths.unassistedMastery).toBeCloseTo(t.unassisted!, 6);
      expect(maths).toMatchObject({ unassistedObservations: 3, assistedPerformance: null });
    }
    const kabir = (await teacher.studentSubjects(helped)).find((s) => s.subjectId === one.maths)!;
    expect(kabir).toMatchObject({ unassistedMastery: null, unassistedObservations: 0 });
    expect(kabir.assistedPerformance!).toBeGreaterThanOrEqual(0.7);
  });

  it("Learn's chapters carry them too", async () => {
    const chapters = await createLmsClient(pgliteTransport(db, helped)).practiceChapters();
    const rational = chapters.find((c) => c.chapter === 'rational-numbers')!;
    expect(rational).toMatchObject({ unassistedMastery: null, unassistedObservations: 0 });
    expect(rational.assistedPerformance!).toBeGreaterThanOrEqual(0.7);
  });

  it("the school portal's figures are the figures alone", async () => {
    const admin = createLmsClient(pgliteTransport(db, one.admin));
    const students = await admin.schoolStudents(one.s8a);
    const kabir = students.find((s) => s.userId === helped)!;
    expect(kabir).toMatchObject({ unassistedMastery: null });
    expect(kabir.assistedPerformance!).toBeGreaterThanOrEqual(0.7);
    const riya = students.find((s) => s.userId === one.kid8a)!;
    expect(riya.unassistedMastery).toBeCloseTo((await truth(one.kid8a)).unassisted!, 6);
    const maths8a = (await admin.schoolClasses()).find((c) => c.sectionId === one.s8a && c.subjectId === one.maths)!;
    expect(maths8a.unassistedMastery).not.toBeNull();
    expect(maths8a.assistedPerformance!).toBeGreaterThanOrEqual(0.7);
    const overview = (await admin.schoolOverview())!;
    expect(overview.unassistedMastery).not.toBeNull();
  });
});

describe('answered, but not yet worked out (D26)', () => {
  it('a child whose answers the brain has not read has no standing, and is told why', async () => {
    const me = createLmsClient(pgliteTransport(db, waiting));
    expect(await me.myProgress()).toEqual([]);
    const status = (await me.brainStatus(waiting))!;
    expect(status.lastAnswerAt).not.toBeNull();
    expect(status.waitingSince).not.toBeNull();
    expect(status.updatedAt).toBeNull();
  });

  it('a child the brain is up to date with is waiting on nothing', async () => {
    const status = (await createLmsClient(pgliteTransport(db, one.kid8a)).brainStatus(one.kid8a))!;
    expect(status.lastAnswerAt).not.toBeNull();
    expect(status.waitingSince).toBeNull();
    expect(status.updatedAt).not.toBeNull();
  });

  it('a child with no answers at all is waiting on nothing and has no answer time', async () => {
    const status = (await createLmsClient(pgliteTransport(db, one.kid8b)).brainStatus(one.kid8b))!;
    expect(status).toMatchObject({ lastAnswerAt: null, waitingSince: null, updatedAt: null });
  });

  it("the class's teacher sees when it was last worked out and how many children wait", async () => {
    const status = (await teacher.classBrainStatus(one.s8a, one.maths))!;
    expect(status.updatedAt).not.toBeNull();
    expect(status.waitingSince).not.toBeNull();
    expect(status.studentsWaiting).toBe(1);
  });

  it('once the brain has run, nobody waits', async () => {
    await think(db, [waiting]);
    expect((await teacher.classBrainStatus(one.s8a, one.maths))!).toMatchObject({ waitingSince: null, studentsWaiting: 0 });
    expect((await createLmsClient(pgliteTransport(db, waiting)).myProgress()).length).toBe(1);
  });

  it('nobody else may ask', async () => {
    const other = createLmsClient(pgliteTransport(db, one.teacherB));
    await expect(other.classBrainStatus(one.s8a, one.maths)).rejects.toThrow(/not your class/);
    await expect(other.brainStatus(one.kid8a)).rejects.toThrow(/not yours to see/);
    const kid = createLmsClient(pgliteTransport(db, one.kid8b));
    await expect(kid.brainStatus(one.kid8a)).rejects.toThrow(/not yours to see/);
    await expect(kid.classBrainStatus(one.s8a, one.maths)).rejects.toThrow(/not your class/);
  });
});
