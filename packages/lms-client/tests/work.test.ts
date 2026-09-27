// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * MORE KINDS OF WORK, AND EVENTS (migration 0029). Written first.
 *
 *   - Written work in the notebook, shown to the student as a checklist they
 *     tick as they finish each task. A tick is the child's own word, not
 *     evidence of learning: it never reaches the ledger.
 *   - Tests: they open at a set time, run against a time limit the server
 *     keeps (not the phone), allow one attempt, and show a child their score
 *     and answers only once the teacher releases the results.
 *   - Tests on paper: the teacher enters each child's marks.
 *   - Events: PTMs, exams, functions — for one class, or the whole school.
 */

const DAY = 86_400_000;
const soon = () => new Date(Date.now() + DAY).toISOString();

let db: PGlite;
let one: School;
let teacher: LmsClient;
let riya: LmsClient;
let arjun: LmsClient; // in 8B
let items: string[];

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'WRK');
  teacher = createLmsClient(pgliteTransport(db, one.teacherA));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  arjun = createLmsClient(pgliteTransport(db, one.kid8b));
  items = [];
  for (const n of [1, 2]) {
    items.push(
      await teacher.writeItem({ grade: 8, subject: 'Mathematics', stem: `Q${n}`, options: ['right', 'wrong'], correctIndex: 0 }),
    );
  }
});
afterAll(async () => {
  await db.close();
});

describe('written work in the notebook, as a checklist', () => {
  let hw: string;

  it('is set as a list of tasks, and cannot be published without one', async () => {
    hw = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'homework',
      title: 'Exercise 2.1',
      dueAt: soon(),
      answerTypes: ['checklist'],
    });
    await expect(teacher.publishAssignment(hw)).rejects.toThrow(/at least one task/);
    await teacher.setAssignmentTasks(hw, ['Exercise 2.1, questions 1 to 5', 'Learn the table of 12']);
    await teacher.publishAssignment(hw);
    expect((await teacher.assignmentTasks(hw)).map((t) => t.text)).toEqual([
      'Exercise 2.1, questions 1 to 5',
      'Learn the table of 12',
    ]);
  });

  it('shows the student each task to tick, and counts what they have ticked', async () => {
    const tasks = await riya.myTasks(hw);
    expect(tasks.map((t) => [t.text, t.done])).toEqual([
      ['Exercise 2.1, questions 1 to 5', false],
      ['Learn the table of 12', false],
    ]);
    await riya.tickTask(tasks[0].taskId, true);
    expect((await riya.myAssignments()).find((a) => a.id === hw)).toMatchObject({ tasksTotal: 2, tasksDone: 1 });
    await riya.tickTask(tasks[0].taskId, false);
    expect((await riya.myAssignments()).find((a) => a.id === hw)).toMatchObject({ tasksDone: 0 });
    for (const t of tasks) await riya.tickTask(t.taskId, true);
    expect((await riya.myAssignments()).find((a) => a.id === hw)).toMatchObject({ tasksDone: 2 });
  });

  it('lets the teacher see who has ticked how much', async () => {
    const rows = await teacher.assignmentResults(hw);
    expect(rows.find((r) => r.studentUserId === one.kid8a)).toMatchObject({ tasksDone: 2, submitted: true });
  });

  it("tells nobody but the student, their teacher and the admin whether a child has handed in", async () => {
    const ask = (user: string) =>
      pgliteTransport(db, user).value('handed_in', { p_assignment: hw, p_student: one.kid8a });
    expect(await ask(one.kid8a)).toBe(true);
    expect(await ask(one.teacherA)).toBe(true);
    expect(await ask(one.kid8b)).toBe(false);
    expect(await ask(one.teacherB)).toBe(false);
  });

  it("refuses a tick on another class's work", async () => {
    const [task] = await teacher.assignmentTasks(hw);
    await expect(arjun.tickTask(task.taskId, true)).rejects.toThrow(/not your homework/);
  });

  it('keeps ticks out of the ledger: a tick is not evidence of learning', async () => {
    const { rows } = await db.query(`select 1 from public.ledger_event where user_id = $1`, [one.kid8a]);
    expect(rows).toEqual([]);
  });
});

describe('an online test', () => {
  let test: string;

  it('cannot be started before it opens, and shows no questions until then', async () => {
    test = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'test',
      title: 'Unit test 1',
      dueAt: new Date(Date.now() + 2 * DAY).toISOString(),
      opensAt: new Date(Date.now() + DAY).toISOString(),
      timeLimitMinutes: 20,
      answerTypes: ['mcq'],
    });
    await teacher.setAssignmentItems(test, items);
    await teacher.publishAssignment(test);
    expect((await riya.myAssignments()).find((a) => a.id === test)).toMatchObject({ timeLimitMinutes: 20 });
    await expect(riya.startTest(test)).rejects.toThrow(/has not started yet/);
    expect(await riya.assignmentQuestions(test)).toEqual([]);
  });

  it('runs on a clock the server keeps: starting twice does not reset it', async () => {
    await db.query(`update lms.assignment set opens_at = now() - interval '1 minute' where id = $1`, [test]);
    expect(await riya.assignmentQuestions(test)).toEqual([]); // not before the child starts
    const first = await riya.startTest(test);
    const again = await riya.startTest(test);
    expect(again.endsAt).toBe(first.endsAt);
    expect(new Date(first.endsAt).getTime() - new Date(first.startedAt).getTime()).toBe(20 * 60_000);
    expect(await riya.assignmentQuestions(test)).toHaveLength(2);
  });

  it('keeps the score and answers from the child until the teacher releases them', async () => {
    // Not even the hand-in itself tells the child their score.
    expect(await riya.submitMcq(test, { [items[0]]: 0, [items[1]]: 1 })).toMatchObject({ correct: null, total: null });
    expect((await teacher.assignmentResults(test)).find((r) => r.studentUserId === one.kid8a)).toMatchObject({
      machineCorrect: 1,
    });
    expect((await riya.myAssignments()).find((a) => a.id === test)).toMatchObject({
      mcqAttemptsUsed: 1,
      bestCorrect: null,
      resultsReleased: false,
    });
    expect(await riya.myReview(test)).toEqual([]);
    await teacher.releaseResults(test);
    expect((await riya.myAssignments()).find((a) => a.id === test)).toMatchObject({ bestCorrect: 1, resultsReleased: true });
    expect(await riya.myReview(test)).toHaveLength(2);
  });

  it('refuses answers once the time is up', async () => {
    const late = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'test',
      title: 'Short test',
      dueAt: new Date(Date.now() + DAY).toISOString(),
      timeLimitMinutes: 10,
      answerTypes: ['mcq'],
    });
    await teacher.setAssignmentItems(late, items);
    await teacher.publishAssignment(late);
    await riya.startTest(late);
    await db.query(
      `update lms.test_start set started_at = now() - interval '15 minutes' where assignment_id = $1`,
      [late],
    );
    await expect(riya.submitMcq(late, { [items[0]]: 0 })).rejects.toThrow(/time is up/);
  });

  it('must be started before it is answered', async () => {
    const unstarted = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'test',
      title: 'Unstarted',
      dueAt: new Date(Date.now() + DAY).toISOString(),
      timeLimitMinutes: 10,
      answerTypes: ['mcq'],
    });
    await teacher.setAssignmentItems(unstarted, items);
    await teacher.publishAssignment(unstarted);
    await expect(riya.submitMcq(unstarted, { [items[0]]: 0 })).rejects.toThrow(/start the test/);
  });
});

describe('changing a draft', () => {
  it('moves its opening time, time limit and maximum marks', async () => {
    const draft = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'test',
      title: 'Draft test',
      dueAt: new Date(Date.now() + 3 * DAY).toISOString(),
      timeLimitMinutes: 30,
      answerTypes: ['mcq'],
    });
    const opens = new Date(Date.now() + 2 * DAY).toISOString();
    await teacher.updateAssignment(draft, { opensAt: opens, timeLimitMinutes: 45, maxMarks: 25 });
    const o = (await teacher.assignmentOverview(draft))!;
    expect(new Date(o.opensAt!).toISOString()).toBe(opens);
    expect(o).toMatchObject({ timeLimitMinutes: 45, maxMarks: 25 });
  });
});

describe('a test on paper', () => {
  let paper: string;

  it("records the marks the teacher enters, out of the test's maximum", async () => {
    paper = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'test',
      title: 'Class test: fractions',
      dueAt: soon(),
      answerTypes: ['paper'],
      maxMarks: 20,
    });
    await teacher.publishAssignment(paper);
    await teacher.recordPaperMark(paper, one.kid8a, 15);
    const row = (await teacher.assignmentResults(paper)).find((r) => r.studentUserId === one.kid8a)!;
    expect(row).toMatchObject({ submitted: true, paperScore: 15, paperMax: 20 });
    await teacher.recordPaperMark(paper, one.kid8a, 16);
    expect((await teacher.assignmentResults(paper)).find((r) => r.studentUserId === one.kid8a)).toMatchObject({
      paperScore: 16,
    });
  });

  it('refuses a mark above the maximum, and marks from anyone but the class teacher', async () => {
    await expect(teacher.recordPaperMark(paper, one.kid8a, 21)).rejects.toThrow(/out of 20/);
    const other = createLmsClient(pgliteTransport(db, one.teacherB));
    await expect(other.recordPaperMark(paper, one.kid8a, 10)).rejects.toThrow(/not your class/);
  });

  it('shows the student their mark once released', async () => {
    await teacher.releaseResults(paper);
    expect((await riya.myAssignments()).find((a) => a.id === paper)).toMatchObject({ teacherScore: 16, teacherMax: 20 });
  });
});

describe('events', () => {
  it("puts a class's event in front of that class only", async () => {
    await teacher.createEvent({ sectionId: one.s8a, title: 'PTM', startsAt: soon(), kind: 'ptm' });
    expect((await riya.upcomingEvents()).map((e) => e.title)).toContain('PTM');
    expect((await arjun.upcomingEvents()).map((e) => e.title)).not.toContain('PTM');
  });

  it('lets only a teacher of the class, or the admin, create one for it', async () => {
    const other = createLmsClient(pgliteTransport(db, one.teacherB));
    await expect(
      other.createEvent({ sectionId: one.s8a, title: 'Not mine', startsAt: soon(), kind: 'event' }),
    ).rejects.toThrow(/not your class/);
    await expect(
      riya.createEvent({ sectionId: one.s8a, title: 'Party', startsAt: soon(), kind: 'event' }),
    ).rejects.toThrow(/not your class/);
  });

  it('lets the admin tell the whole school, and only the admin', async () => {
    await expect(
      teacher.createEvent({ sectionId: null, title: 'Annual day', startsAt: soon(), kind: 'event' }),
    ).rejects.toThrow(/only the school admin/);
    const admin = createLmsClient(pgliteTransport(db, one.admin));
    await admin.createEvent({ sectionId: null, title: 'Annual day', startsAt: soon(), kind: 'event' });
    expect((await arjun.upcomingEvents()).map((e) => e.title)).toContain('Annual day');
    expect((await riya.upcomingEvents()).map((e) => e.title)).toContain('Annual day');
  });

  it('lets its author delete it', async () => {
    const id = await teacher.createEvent({ sectionId: one.s8a, title: 'Quiz club', startsAt: soon(), kind: 'event' });
    await teacher.deleteEvent(id);
    expect((await riya.upcomingEvents()).map((e) => e.title)).not.toContain('Quiz club');
  });

  it('lists upcoming tests alongside events for the student', async () => {
    const titles = (await riya.upcomingEvents()).map((e) => e.title);
    expect(titles).toContain('Unit test 1');
  });
});
