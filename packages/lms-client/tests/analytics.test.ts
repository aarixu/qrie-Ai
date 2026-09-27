// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadOutcomes, think } from '../../lms-brain/src/index.ts';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * ANALYTICS, THE SCHOOL PORTAL, AND LEARN (migration 0031). Written first.
 *
 *   - A student's report — card, subjects, timeline, chapters — for the
 *     student themselves, their teachers (only the subjects they teach) and
 *     the school's admin; nobody else. A test's score stays hidden from the
 *     student until it is released, even here.
 *   - The school portal's numbers, for the admin only.
 *   - A class's trend, work by work, for its teacher.
 *   - Learn: chapter-wise practice from questions the school has approved,
 *     with the answer shown at once, written to the ledger as 'practice' so
 *     the brain learns from it — and never a question that is on open work.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const DAY = 86_400_000;

let db: PGlite;
let one: School;
let teacher: LmsClient;
let admin: LmsClient;
let riya: LmsClient;
let arjun: LmsClient;
let items: string[];
let homework: string;
let test: string;

beforeAll(async () => {
  db = await freshDatabase();
  await loadOutcomes(db);
  one = await buildSchool(db, 'ANA');
  teacher = createLmsClient(pgliteTransport(db, one.teacherA));
  admin = createLmsClient(pgliteTransport(db, one.admin));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  arjun = createLmsClient(pgliteTransport(db, one.kid8b));
  items = [];
  for (let n = 0; n < 8; n++) {
    const { rows } = await db.query<{ id: string }>(
      `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
       values ($1, $2, 8, 'Mathematics', 'mcq', $3, '["right","wrong"]'::jsonb, 0, '["", "mixes up p and q"]'::jsonb) returning id`,
      [`probe-ana-${n}`, [n % 2 ? CLOSURE : DEFINE], `Q${n}`],
    );
    items.push(rows[0].id);
  }
  // Homework, handed in and scored; a test, handed in but not released.
  for (const id of items.slice(0, 4)) await teacher.approveItem(id);
  homework = await teacher.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'homework', title: 'Past homework',
    dueAt: new Date(Date.now() + DAY).toISOString(), answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(homework, items.slice(0, 2));
  await teacher.publishAssignment(homework);
  await riya.submitMcq(homework, { [items[0]]: 0, [items[1]]: 1 });
  await db.query(`update lms.assignment set due_at = now() - interval '1 hour' where id = $1`, [homework]);
  test = await teacher.createAssignment({
    sectionId: one.s8a, subjectId: one.maths, kind: 'test', title: 'Unreleased test',
    dueAt: new Date(Date.now() + DAY).toISOString(), timeLimitMinutes: 10, answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(test, items.slice(2, 4));
  await teacher.publishAssignment(test);
  await riya.startTest(test);
  await riya.submitMcq(test, { [items[2]]: 0, [items[3]]: 0 });
  await db.query(`update lms.assignment set due_at = now() - interval '1 hour' where id = $1`, [test]);
  await think(db, [one.kid8a]);
});
afterAll(async () => {
  await db.close();
});

describe("a student's report", () => {
  it('gives the student their own card, subjects and timeline — without a test score before release', async () => {
    expect(await riya.studentCard(one.kid8a)).toMatchObject({ displayName: 'Riya', className: '8A', grade: 8 });
    const subjects = await riya.studentSubjects(one.kid8a);
    expect(subjects.find((s) => s.subjectName === 'Mathematics')).toMatchObject({ workDue: 2, handedIn: 2 });
    const timeline = await riya.studentTimeline(one.kid8a);
    expect(timeline.find((t) => t.title === 'Past homework')).toMatchObject({ handedIn: true, score: 0.5 });
    expect(timeline.find((t) => t.title === 'Unreleased test')).toMatchObject({ handedIn: true, score: null });
  });

  it("shows the teacher the score the student cannot yet see, and the student's chapters", async () => {
    const timeline = await teacher.studentTimeline(one.kid8a);
    expect(timeline.find((t) => t.title === 'Unreleased test')?.score).toBe(1);
    const chapters = await teacher.studentChapters(one.kid8a);
    expect(chapters.find((c) => c.chapter === 'rational-numbers')).toMatchObject({ subject: 'Mathematics' });
  });

  it("shows a teacher only the subjects they teach the child", async () => {
    const science = createLmsClient(pgliteTransport(db, one.teacherB)); // teaches 8B Science only
    await expect(science.studentCard(one.kid8a)).rejects.toThrow(/not yours to see/);
  });

  it('refuses another student', async () => {
    await expect(arjun.studentCard(one.kid8a)).rejects.toThrow(/not yours to see/);
    await expect(arjun.studentTimeline(one.kid8a)).rejects.toThrow(/not yours to see/);
  });

  it('gives the admin everything', async () => {
    expect((await admin.studentSubjects(one.kid8a)).length).toBeGreaterThan(0);
  });
});

describe('the school portal', () => {
  it("gives the admin the school's numbers, classes, students and teachers", async () => {
    expect(await admin.schoolOverview()).toMatchObject({
      students: 2,
      teachers: 2,
      classes: 2,
      workSet30d: 2,
      handinRate30d: 1,
      activeStudents7d: 1,
    });
    const classes = await admin.schoolClasses();
    expect(classes.find((c) => c.className === '8A' && c.subjectName === 'Mathematics')).toMatchObject({
      teacherName: 'Teacher A',
      students: 1,
      workSet: 2,
    });
    const students = await admin.schoolStudents();
    expect(students.map((s) => s.displayName).sort()).toEqual(['Arjun', 'Riya']);
    expect(students.find((s) => s.displayName === 'Riya')).toMatchObject({ className: '8A', handinRate: 1 });
    expect((await admin.schoolStudents(one.s8b)).map((s) => s.displayName)).toEqual(['Arjun']);
    const teachers = await admin.schoolTeachers();
    expect(teachers.find((t) => t.displayName === 'Teacher A')).toMatchObject({ classes: 1, workSet: 2 });
  });

  it('is closed to teachers and students', async () => {
    await expect(teacher.schoolOverview()).rejects.toThrow(/only the school admin/);
    await expect(riya.schoolStudents()).rejects.toThrow(/only the school admin/);
  });

  it("lets the admin set the school's colour, which the student app wears", async () => {
    await admin.setSchoolBrand({ primary: '#0e7490' });
    expect((await riya.me())?.brand).toMatchObject({ primary: '#0e7490' });
    await expect(admin.setSchoolBrand({ primary: 'red; background:url(x)' })).rejects.toThrow(/#rrggbb/);
    await expect(teacher.setSchoolBrand({ primary: '#000000' })).rejects.toThrow(/only the school admin/);
  });
});

describe("a class's trend", () => {
  it('gives its teacher each piece of work with hand-ins and the average', async () => {
    const trend = await teacher.classTrend(one.s8a, one.maths);
    expect(trend.find((t) => t.title === 'Past homework')).toMatchObject({ students: 1, handedIn: 1, averageScore: 0.5 });
    const other = createLmsClient(pgliteTransport(db, one.teacherB));
    await expect(other.classTrend(one.s8a, one.maths)).rejects.toThrow(/not your class/);
  });
});

describe('learn: chapter-wise practice', () => {
  it('offers the chapters of the student’s subjects, counting only approved questions not on open work', async () => {
    // items 0-3 approved (0-1 on closed homework, 2-3 on a closed test); 4-7 not.
    let chapters = await riya.practiceChapters();
    expect(chapters.find((c) => c.chapter === 'rational-numbers')).toMatchObject({ subjectName: 'Mathematics', questions: 4 });
    const added = await teacher.approveChapter(8, 'Mathematics', 'rational-numbers');
    expect(added).toBe(4);
    chapters = await riya.practiceChapters();
    expect(chapters.find((c) => c.chapter === 'rational-numbers')?.questions).toBe(8);
  });

  it('never offers a question that is on open work', async () => {
    const open = await teacher.createAssignment({
      sectionId: one.s8a, subjectId: one.maths, kind: 'homework', title: 'Open homework',
      dueAt: new Date(Date.now() + DAY).toISOString(), answerTypes: ['mcq'],
    });
    await teacher.setAssignmentItems(open, [items[5]]);
    await teacher.publishAssignment(open);
    const qs = await riya.practiceQuestions('Mathematics', 'rational-numbers', 20);
    expect(qs.map((q) => q.itemId)).not.toContain(items[5]);
    expect(qs).toHaveLength(7);
    expect(JSON.stringify(qs)).not.toMatch(/correct/i);
  });

  it('marks each answer at once, shows the right one, and tells the brain', async () => {
    const session = crypto.randomUUID();
    const wrong = await riya.checkPracticeAnswer(session, items[6], 1);
    expect(wrong).toMatchObject({ correct: false, correctIndex: 0, misconception: 'mixes up p and q' });
    const right = await riya.checkPracticeAnswer(session, items[7], 0);
    expect(right).toMatchObject({ correct: true, correctIndex: 0, misconception: null });
    const { rows } = await db.query<{ source: string; rung: string }>(
      `select source, payload->>'assistanceRung' as rung from public.ledger_event where session_id = $1 order by seq`,
      [session],
    );
    expect(rows).toEqual([
      { source: 'practice', rung: '0' },
      { source: 'practice', rung: '0' },
    ]);
  });

  it("refuses another child's session, a question on open work, and one the school has not approved", async () => {
    const session = crypto.randomUUID();
    await riya.checkPracticeAnswer(session, items[0], 0);
    const kabir = createLmsClient(pgliteTransport(db, one.kid8b));
    await expect(kabir.checkPracticeAnswer(session, items[0], 0)).rejects.toThrow(/not your practice/);
    await expect(riya.checkPracticeAnswer(crypto.randomUUID(), items[5], 0)).rejects.toThrow(/not a practice question/);
    const { rows } = await db.query<{ id: string }>(
      `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index)
       values ('probe-ana-unapproved', $1, 8, 'Mathematics', 'mcq', 'Unapproved', '["a","b"]'::jsonb, 0) returning id`,
      [[DEFINE]],
    );
    await expect(riya.checkPracticeAnswer(crypto.randomUUID(), rows[0].id, 0)).rejects.toThrow(/not a practice question/);
  });
});
