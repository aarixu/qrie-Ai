// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * EVERY REPORT, CUT TO ITS OWN SCOPE (migration 0042).
 *
 * 0042 changes how the reports are worked out, not what they say: each asks
 * work_facts for only its own child, class or window of due dates, and the
 * school portal's lists total the facts once. These are the numbers the
 * reports gave before it, worked out by hand for one small school — so a
 * scope cut too wide or too narrow, or a fact worked out differently, shows
 * here:
 *
 *   8A Mathematics (Teacher A): Riya, Meera, Kabir.
 *     W4  MCQ, due 40 days ago   Riya 1/2.
 *     W2  MCQ and paper, 3 days  Riya paper 5/10; Kabir MCQ 1/2 marked 1/4
 *                                yesterday and paper 8/10 two days ago (the
 *                                latest mark counts: 1/4); Meera absent.
 *     W1  MCQ, two tries, 2 days Riya 1/2, then 2/2 once it was due (the
 *                                latest try counts; late, as one try was);
 *                                Meera 1/2 once it was due, marked 3/4.
 *     W3  two tasks, 1 day       Riya ticks both (handed in), Meera one (not);
 *                                Kabir checked by the teacher (not absent).
 *     W5  MCQ, due tomorrow      Riya 2/2.
 *   8A Science (Teacher A): W6, due 12 hours ago, Riya 0/2.
 *   8B Mathematics (Teacher A): W7, due a day ago, Arjun 2/2.
 *   9A Science (Teacher B): Dev, and no work yet.
 *   The brain's beliefs (mastery) for each class's children.
 *   Another school: a child's 0/1, which must count nowhere here.
 */

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

let db: PGlite;
let one: School;
let other: School;
let admin: LmsClient;
let teacherA: LmsClient;
let riya: LmsClient;
let meera: LmsClient;
let kabir: LmsClient;
let arjun: LmsClient;
const kid: Record<string, string> = {};
const w: Record<string, string> = {};
let items: string[];

async function work(
  teacher: LmsClient,
  sectionId: string,
  subjectId: string,
  title: string,
  extra: { answerTypes?: ('mcq' | 'paper' | 'checklist')[]; attemptsAllowed?: number; maxMarks?: number; tasks?: string[] } = {},
): Promise<string> {
  const answerTypes = extra.answerTypes ?? ['mcq'];
  const id = await teacher.createAssignment({
    sectionId, subjectId, kind: 'homework', title, dueAt: inDays(1), answerTypes,
    attemptsAllowed: extra.attemptsAllowed, maxMarks: extra.maxMarks,
  });
  if (answerTypes.includes('mcq')) await teacher.setAssignmentItems(id, items);
  if (extra.tasks) await teacher.setAssignmentTasks(id, extra.tasks);
  await teacher.publishAssignment(id);
  return id;
}

const due = (id: string, interval: string) =>
  db.query(`update lms.assignment set due_at = now() + $2::interval where id = $1`, [id, interval]);
const answers = (...chosen: number[]) => Object.fromEntries(items.map((id, i) => [id, chosen[i]]));

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'BIG');
  other = await buildSchool(db, 'OTB');
  // Teacher A also teaches 8A Science and 8B Mathematics.
  await db.query(
    `insert into lms.teaching_assignment (org_id, section_id, subject_id, teacher_user_id) values ($1, $2, $3, $4), ($1, $5, $6, $4)`,
    [one.org, one.s8a, one.science, one.teacherA, one.s8b, one.maths],
  );
  kid.Riya = one.kid8a;
  kid.Arjun = one.kid8b;
  for (const [roll, name] of [['2', 'Meera'], ['3', 'Kabir']]) {
    kid[name] = await seat(db, one.org, 'student', `BIG-10${Number(roll) + 1}`, name);
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, $5)`,
      [one.org, one.year, one.s8a, kid[name], roll],
    );
  }
  // 9A Science (Teacher B), with Dev and no work yet.
  const s9a = (await db.query<{ id: string }>(
    `insert into lms.section (org_id, academic_year_id, grade, name) values ($1, $2, 9, 'A') returning id`,
    [one.org, one.year],
  )).rows[0].id;
  await db.query(
    `insert into lms.teaching_assignment (org_id, section_id, subject_id, teacher_user_id) values ($1, $2, $3, $4)`,
    [one.org, s9a, one.science, one.teacherB],
  );
  kid.Dev = await seat(db, one.org, 'student', 'BIG-105', 'Dev');
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, '1')`,
    [one.org, one.year, s9a, kid.Dev],
  );
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  riya = createLmsClient(pgliteTransport(db, kid.Riya));
  meera = createLmsClient(pgliteTransport(db, kid.Meera));
  kabir = createLmsClient(pgliteTransport(db, kid.Kabir));
  arjun = createLmsClient(pgliteTransport(db, kid.Arjun));

  items = [];
  for (const n of [0, 1]) {
    const { rows } = await db.query<{ id: string }>(
      `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index)
       values ($1, '{}', 8, 'Mathematics', 'mcq', $1, '["right","wrong"]'::jsonb, 0) returning id`,
      [`probe-big-${n}`],
    );
    items.push(rows[0].id);
    await teacherA.approveItem(rows[0].id);
  }

  w.W1 = await work(teacherA, one.s8a, one.maths, 'W1', { attemptsAllowed: 2 });
  await riya.submitMcq(w.W1, answers(1, 0));
  await due(w.W1, '-2 days');
  await riya.submitMcq(w.W1, answers(0, 0));
  const meeraW1 = await meera.submitMcq(w.W1, answers(0, 1));
  await teacherA.setTeacherMark(meeraW1.submissionId, 3, 4);

  w.W2 = await work(teacherA, one.s8a, one.maths, 'W2', { answerTypes: ['mcq', 'paper'], maxMarks: 10 });
  const kabirW2 = await kabir.submitMcq(w.W2, answers(0, 1));
  await teacherA.setTeacherMark(kabirW2.submissionId, 1, 4);
  await teacherA.recordPaperMark(w.W2, kid.Kabir, 8);
  await teacherA.recordPaperMark(w.W2, kid.Riya, 5);
  await teacherA.setWorkStatus(w.W2, [kid.Meera], 'absent');
  await db.query(`update lms.mark set marked_at = now() - interval '1 day' where submission_id = $1`, [kabirW2.submissionId]);
  await db.query(
    `update lms.mark m set marked_at = now() - interval '2 days' from lms.submission s
      where s.id = m.submission_id and s.assignment_id = $1 and s.student_user_id = $2 and s.kind = 'paper'`,
    [w.W2, kid.Kabir],
  );
  await due(w.W2, '-3 days');

  w.W3 = await work(teacherA, one.s8a, one.maths, 'W3', { answerTypes: ['checklist'], tasks: ['Exercise 1', 'Exercise 2'] });
  const tasks = await riya.myTasks(w.W3);
  for (const t of tasks) await riya.tickTask(t.taskId, true);
  await meera.tickTask(tasks[0].taskId, true);
  await teacherA.setWorkStatus(w.W3, [kid.Kabir], 'checked');
  await due(w.W3, '-1 day');

  w.W4 = await work(teacherA, one.s8a, one.maths, 'W4');
  await riya.submitMcq(w.W4, answers(0, 1));
  await due(w.W4, '-40 days');

  w.W5 = await work(teacherA, one.s8a, one.maths, 'W5');
  await riya.submitMcq(w.W5, answers(0, 0));

  w.W6 = await work(teacherA, one.s8a, one.science, 'W6');
  await riya.submitMcq(w.W6, answers(1, 1));
  await due(w.W6, '-12 hours');

  w.W7 = await work(teacherA, one.s8b, one.maths, 'W7');
  await arjun.submitMcq(w.W7, answers(0, 0));
  await due(w.W7, '-1 day');

  // The brain's beliefs: only answered outcomes of the class's own grade and
  // subject count towards a class's mastery.
  await db.query(
    `insert into lms.outcome (id, grade, subject, chapter, title) values
       ('big-8m1', 8, 'Mathematics', 'one', 'M1'), ('big-8m2', 8, 'Mathematics', 'one', 'M2'),
       ('big-8s1', 8, 'Science', 'one', 'S1'), ('big-9s1', 9, 'Science', 'one', 'S1')`,
  );
  for (const [name, outcome, mastery, answered] of [
    ['Riya', 'big-8m1', 0.5, 2],
    ['Riya', 'big-8m2', 1, 0], // never answered
    ['Riya', 'big-9s1', 1, 3], // not her grade
    ['Meera', 'big-8m1', 0.75, 1],
    ['Meera', 'big-8s1', 0.25, 1],
    ['Kabir', 'big-8m2', 0.25, 1],
    ['Arjun', 'big-8m1', 1, 1],
    ['Dev', 'big-9s1', 0.5, 1],
  ] as const) {
    await db.query(
      `insert into public.concept_state (org_id, user_id, outcome_id, mastery, unassisted_mastery, assisted_performance,
                                         observations, answer_observations)
       values ($1, $2, $3, $4, $4, 0.5, $5, $5)`,
      [one.org, kid[name], outcome, mastery, answered],
    );
  }

  // The other school's 8A Mathematics: its Riya hands in 0/1.
  const otherTeacher = createLmsClient(pgliteTransport(db, other.teacherA));
  const otherItem = (await db.query<{ id: string }>(
    `insert into lms.item (org_id, created_by, outcome_ids, grade, subject, kind, stem, options, correct_index)
     values ($1, $2, '{}', 8, 'Mathematics', 'mcq', 'Elsewhere', '["right","wrong"]'::jsonb, 0) returning id`,
    [other.org, other.teacherA],
  )).rows[0].id;
  const elsewhere = await otherTeacher.createAssignment({
    sectionId: other.s8a, subjectId: other.maths, kind: 'homework', title: 'Elsewhere', dueAt: inDays(1), answerTypes: ['mcq'],
  });
  await otherTeacher.setAssignmentItems(elsewhere, [otherItem]);
  await otherTeacher.publishAssignment(elsewhere);
  await createLmsClient(pgliteTransport(db, other.kid8a)).submitMcq(elsewhere, { [otherItem]: 1 });
  await due(elsewhere, '-1 day');
});
afterAll(async () => {
  await db.close();
});

describe("a class's trend", () => {
  it('has every published piece of its own section and subject, with its children’s hand-ins, lates and average', async () => {
    const trend = await teacherA.classTrend(one.s8a, one.maths);
    expect(trend.map((t) => [t.title, t.students, t.handedIn, t.late])).toEqual([
      ['W4', 3, 1, 0],
      ['W2', 2, 2, 0],
      ['W1', 3, 2, 2],
      ['W3', 3, 1, 0],
      ['W5', 3, 1, 0],
    ]);
    expect(trend.map((t) => t.averageScore)).toEqual([0.5, 0.375, 0.875, null, 1]);
    expect((await teacherA.classTrend(one.s8a, one.science)).map((t) => [t.title, t.students, t.handedIn])).toEqual([
      ['W6', 3, 1],
    ]);
    expect((await teacherA.classTrend(one.s8b, one.maths)).map((t) => [t.title, t.students, t.averageScore])).toEqual([
      ['W7', 1, 1],
    ]);
  });
});

describe("a student's report", () => {
  it("has the child's own work only, newest first, with what they handed in, late, absent and their mark", async () => {
    const row = (t: { title: string; handedIn: boolean; late: boolean; absent: boolean; score: number | null }) =>
      [t.title, t.handedIn, t.late, t.absent, t.score];
    expect((await teacherA.studentTimeline(kid.Riya)).map(row)).toEqual([
      ['W5', true, false, false, 1],
      ['W6', true, false, false, 0],
      ['W3', true, false, false, null],
      ['W1', true, true, false, 1],
      ['W2', true, false, false, 0.5],
      ['W4', true, false, false, 0.5],
    ]);
    expect((await teacherA.studentTimeline(kid.Meera)).map(row)).toEqual([
      ['W5', false, false, false, null],
      ['W6', false, false, false, null],
      ['W3', false, false, false, null],
      ['W1', true, true, false, 0.75],
      ['W2', false, false, true, null],
      ['W4', false, false, false, null],
    ]);
    expect((await teacherA.studentTimeline(kid.Kabir)).find((t) => t.title === 'W2')?.score).toBe(0.25);
    expect((await arjun.studentTimeline(kid.Arjun)).map((t) => t.title)).toEqual(['W7']);
  });

  it("counts each subject's work due so far, leaving out work the child was absent for", async () => {
    const subject = (list: { subjectName: string; workDue: number; handedIn: number; handinRate: number | null; averageScore: number | null }[]) =>
      list.map((s) => [s.subjectName, s.workDue, s.handedIn, s.handinRate, s.averageScore]);
    const riyas = subject(await riya.studentSubjects(kid.Riya));
    expect(riyas.map((s) => s.slice(0, 4))).toEqual([
      ['Mathematics', 4, 4, 1],
      ['Science', 1, 1, 1],
    ]);
    expect(riyas[0][4]).toBeCloseTo(2 / 3, 12);
    expect(riyas[1][4]).toBe(0);
    const meeras = subject(await admin.studentSubjects(kid.Meera));
    expect(meeras[0].slice(0, 3)).toEqual(['Mathematics', 3, 1]);
    expect(meeras[0][3]).toBeCloseTo(1 / 3, 12);
    expect(meeras[0][4]).toBe(0.75);
    expect(subject(await admin.studentSubjects(kid.Kabir))).toEqual([
      ['Mathematics', 4, 1, 0.25, 0.25],
      ['Science', 1, 0, 0, null],
    ]);
    expect(subject(await arjun.studentSubjects(kid.Arjun))).toEqual([
      ['Mathematics', 1, 1, 1, 1],
      ['Science', 0, 0, null, null],
    ]);
  });
});

describe('the school portal', () => {
  const student = (s: { displayName: string; workDue: number; handinRate: number | null; averageScore: number | null }) =>
    [s.displayName, s.workDue, s.handinRate, s.averageScore];

  it("totals each child's work due so far, for the school or one section", async () => {
    expect((await admin.schoolStudents()).map(student)).toEqual([
      ['Riya', 5, 1, 0.5],
      ['Meera', 4, 0.25, 0.75],
      ['Kabir', 5, 0.2, 0.25],
      ['Arjun', 1, 1, 1],
      ['Dev', 0, null, null],
    ]);
    expect((await admin.schoolStudents(one.s8a)).map(student)).toEqual([
      ['Riya', 5, 1, 0.5],
      ['Meera', 4, 0.25, 0.75],
      ['Kabir', 5, 0.2, 0.25],
    ]);
  });

  it("totals each class's work due so far, and its children's mastery", async () => {
    const classes = await admin.schoolClasses();
    expect(classes.map((c) => [c.className, c.subjectName, c.students, c.workSet])).toEqual([
      ['8A', 'Mathematics', 3, 5],
      ['8A', 'Science', 3, 1],
      ['8B', 'Mathematics', 1, 1],
      ['8B', 'Science', 1, 0],
      ['9A', 'Science', 1, 0],
    ]);
    expect(classes[0].handinRate).toBeCloseTo(6 / 11, 12);
    expect(classes[0].averageScore).toBeCloseTo(0.6, 12);
    expect(classes[1].handinRate).toBeCloseTo(1 / 3, 12);
    expect(classes.slice(1).map((c) => c.averageScore)).toEqual([0, 1, null, null]);
    expect(classes.slice(2).map((c) => c.handinRate)).toEqual([1, null, null]);
    expect(classes.map((c) => c.mastery)).toEqual([0.5, 0.25, 1, null, 0.5]);
  });

  it("counts the last 30 days' work for the school's numbers, and no other school's", async () => {
    const overview = await admin.schoolOverview();
    expect(overview?.handinRate30d).toBeCloseTo(7 / 12, 12);
    expect(overview?.averageScore30d).toBeCloseTo(3.5 / 6, 12);
    const elsewhere = await createLmsClient(pgliteTransport(db, other.admin)).schoolOverview();
    expect(elsewhere).toMatchObject({ handinRate30d: 1, averageScore30d: 0 });
  });
});

describe('who is left out', () => {
  it('refuses another child, another class’s teacher and another school', async () => {
    await expect(meera.studentSubjects(kid.Riya)).rejects.toThrow(/not yours to see/);
    await expect(createLmsClient(pgliteTransport(db, one.teacherB)).classTrend(one.s8a, one.maths)).rejects.toThrow(
      /not your class/,
    );
    await expect(createLmsClient(pgliteTransport(db, other.admin)).studentTimeline(kid.Riya)).rejects.toThrow(
      /not yours to see/,
    );
    expect((await createLmsClient(pgliteTransport(db, other.admin)).schoolStudents(one.s8a)).length).toBe(0);
  });

  it('drops a child who leaves from every count', async () => {
    await admin.markLeft('BIG-104');
    expect((await teacherA.classTrend(one.s8a, one.maths)).map((t) => t.students)).toEqual([2, 1, 2, 2, 2]);
    expect((await admin.schoolStudents()).map((s) => s.displayName)).toEqual(['Riya', 'Meera', 'Arjun', 'Dev']);
    const maths8a = (await admin.schoolClasses())[0];
    expect(maths8a.handinRate).toBeCloseTo(5 / 7, 12);
    expect(maths8a.averageScore).toBeCloseTo(2.75 / 4, 12);
    expect(maths8a.mastery).toBe(0.625);
    const overview = await admin.schoolOverview();
    expect(overview?.handinRate30d).toBeCloseTo(0.75, 12);
    expect(overview?.averageScore30d).toBeCloseTo(0.65, 12);
  });
});
