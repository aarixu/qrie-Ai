// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * What the design review found missing (migration 0030). Written first.
 *
 *   - A test's answers are saved as they are tapped, and when a child's time
 *     runs out the server hands in what was saved — so a phone that drops off
 *     the network at the end does not turn the test into a zero.
 *   - Each child gets the test's questions in their own order, the same
 *     every time they open it.
 *   - The teacher's own word on each child's work — Checked, Not done,
 *     Absent — set for many children at once, kept apart from the child's
 *     ticks (which are only the child's word).
 */

const DAY = 86_400_000;
let db: PGlite;
let one: School;
let kabir: string;
let teacher: LmsClient;
let riya: LmsClient;
let items: string[];

async function test(title: string, minutes = 20): Promise<string> {
  const id = await teacher.createAssignment({
    sectionId: one.s8a,
    subjectId: one.maths,
    kind: 'test',
    title,
    dueAt: new Date(Date.now() + DAY).toISOString(),
    timeLimitMinutes: minutes,
    answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(id, items);
  await teacher.publishAssignment(id);
  return id;
}

const timeRunsOut = (assignment: string, minutesAgo: number) =>
  db.query(
    `update lms.test_start set started_at = now() - make_interval(mins => $2) where assignment_id = $1`,
    [assignment, minutesAgo],
  );

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'CHK');
  kabir = await seat(db, one.org, 'student', 'CHK-103', 'Kabir');
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
     values ($1, $2, $3, $4, '3')`,
    [one.org, one.year, one.s8a, kabir],
  );
  teacher = createLmsClient(pgliteTransport(db, one.teacherA));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  items = [];
  for (let n = 1; n <= 6; n++) {
    items.push(
      await teacher.writeItem({ grade: 8, subject: 'Mathematics', stem: `Q${n}`, options: ['right', 'wrong', 'also wrong'], correctIndex: 0 }),
    );
  }
});
afterAll(async () => {
  await db.close();
});

describe('a test survives a dropped connection', () => {
  it('saves each answer as it is tapped, only while the clock runs, and only real options', async () => {
    const t = await test('Saved as you go');
    await expect(riya.saveTestAnswer(t, items[0], 0)).rejects.toThrow(/start the test/);
    await riya.startTest(t);
    await riya.saveTestAnswer(t, items[0], 1);
    await riya.saveTestAnswer(t, items[0], 0); // changed their mind
    await expect(riya.saveTestAnswer(t, items[1], 3)).rejects.toThrow(/has no option/);
    await timeRunsOut(t, 30);
    await expect(riya.saveTestAnswer(t, items[1], 0)).rejects.toThrow(/time is up/);
  });

  it("hands in what was saved when the child's time runs out, without the phone", async () => {
    const t = await test('Phone went offline');
    await riya.startTest(t);
    await riya.saveTestAnswer(t, items[0], 0);
    await riya.saveTestAnswer(t, items[1], 0);
    await riya.saveTestAnswer(t, items[2], 2);
    await timeRunsOut(t, 25);
    await db.query(`select lms.finalize_tests()`);
    const row = (await teacher.assignmentResults(t)).find((r) => r.studentUserId === one.kid8a)!;
    expect(row).toMatchObject({ submitted: true, machineCorrect: 2, machineTotal: 6, late: false });
    // The hand-in is evidence like any other: it reached the ledger.
    const { rows } = await db.query(
      `select 1 from public.ledger_event where user_id = $1 and payload->>'assignmentId' = $2`,
      [one.kid8a, t],
    );
    expect(rows).toHaveLength(6);
  });

  it('leaves a child whose time is still running alone', async () => {
    const t = await test('Still going');
    await riya.startTest(t);
    await riya.saveTestAnswer(t, items[0], 0);
    await db.query(`select lms.finalize_tests()`);
    expect((await teacher.assignmentResults(t)).find((r) => r.studentUserId === one.kid8a)?.submitted).toBe(false);
  });

  it('counts saved answers when the child hands in with only some of them', async () => {
    const t = await test('Hand in the rest');
    await riya.startTest(t);
    await riya.saveTestAnswer(t, items[0], 0);
    await riya.submitMcq(t, { [items[1]]: 0 });
    expect((await teacher.assignmentResults(t)).find((r) => r.studentUserId === one.kid8a)).toMatchObject({
      machineCorrect: 2,
    });
  });

  it('hands in expired attempts before releasing results', async () => {
    const t = await test('Released after the bell');
    await riya.startTest(t);
    await riya.saveTestAnswer(t, items[0], 0);
    await timeRunsOut(t, 40);
    await teacher.releaseResults(t);
    expect((await riya.myAssignments()).find((a) => a.id === t)).toMatchObject({ mcqAttemptsUsed: 1, bestCorrect: 1 });
  });

  it("refuses a save on another child's behalf or another class's test", async () => {
    const t = await test('Not yours');
    const arjun = createLmsClient(pgliteTransport(db, one.kid8b));
    await expect(arjun.saveTestAnswer(t, items[0], 0)).rejects.toThrow(/not your test/);
  });
});

describe("each child's own question order", () => {
  it('shuffles a test per child, and keeps each child’s order', async () => {
    const t = await test('Shuffled');
    const kab = createLmsClient(pgliteTransport(db, kabir));
    await riya.startTest(t);
    await kab.startTest(t);
    const order = async (c: LmsClient) => (await c.assignmentQuestions(t)).map((q) => q.itemId);
    const r1 = await order(riya);
    expect(await order(riya)).toEqual(r1);
    expect(new Set(r1)).toEqual(new Set(items));
    expect(await order(kab)).not.toEqual(r1);
  });

  it('keeps homework in the order the teacher set', async () => {
    const hw = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'homework',
      title: 'In order',
      dueAt: new Date(Date.now() + DAY).toISOString(),
      answerTypes: ['mcq'],
    });
    await teacher.setAssignmentItems(hw, items);
    await teacher.publishAssignment(hw);
    expect((await riya.assignmentQuestions(hw)).map((q) => q.itemId)).toEqual(items);
  });
});

describe("the teacher's word on each child's work", () => {
  let hw: string;

  it('is set for many children at once, and shown beside their ticks', async () => {
    hw = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'homework',
      title: 'Notebook check',
      dueAt: new Date(Date.now() + DAY).toISOString(),
      answerTypes: ['checklist'],
    });
    await teacher.setAssignmentTasks(hw, ['Exercise 3']);
    await teacher.publishAssignment(hw);
    const [task] = await riya.myTasks(hw);
    await riya.tickTask(task.taskId, true);

    await teacher.setWorkStatus(hw, [one.kid8a, kabir], 'checked');
    await teacher.setWorkStatus(hw, [kabir], 'not_done');
    const rows = await teacher.assignmentResults(hw);
    expect(rows.find((r) => r.studentUserId === one.kid8a)).toMatchObject({ tasksDone: 1, teacherStatus: 'checked' });
    expect(rows.find((r) => r.studentUserId === kabir)).toMatchObject({ tasksDone: 0, teacherStatus: 'not_done' });
    expect((await riya.myAssignments()).find((a) => a.id === hw)?.teacherStatus).toBe('checked');
  });

  it('can be cleared', async () => {
    await teacher.setWorkStatus(hw, [kabir], null);
    expect((await teacher.assignmentResults(hw)).find((r) => r.studentUserId === kabir)?.teacherStatus).toBeNull();
  });

  it('comes only from the class teacher, only for children in the class, only as one of the three words', async () => {
    const other = createLmsClient(pgliteTransport(db, one.teacherB));
    await expect(other.setWorkStatus(hw, [kabir], 'checked')).rejects.toThrow(/not your class/);
    await expect(riya.setWorkStatus(hw, [one.kid8a], 'checked')).rejects.toThrow(/not your class/);
    await expect(teacher.setWorkStatus(hw, [one.kid8b], 'checked')).rejects.toThrow(/not in this class/);
    await expect(
      teacher.setWorkStatus(hw, [kabir], 'excellent' as unknown as 'checked'),
    ).rejects.toThrow(/checked, not done or absent/);
  });

  it('marks a child absent from a test on paper, which the gradebook counts as absent, not missing', async () => {
    const paper = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'test',
      title: 'Paper, with an absence',
      dueAt: new Date(Date.now() - DAY).toISOString(),
      answerTypes: ['paper'],
      maxMarks: 10,
    });
    await teacher.publishAssignment(paper);
    await teacher.setWorkStatus(paper, [kabir], 'absent');
    expect((await teacher.assignmentResults(paper)).find((r) => r.studentUserId === kabir)).toMatchObject({
      teacherStatus: 'absent',
      submitted: false,
    });
  });
});

describe('what needs the teacher', () => {
  it('lists photos to mark, paper marks to enter, tests to release and notebooks to check', async () => {
    const past = new Date(Date.now() - DAY).toISOString();
    const notebook = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'homework',
      title: 'Last week, in the notebook',
      dueAt: past,
      answerTypes: ['checklist'],
    });
    await teacher.setAssignmentTasks(notebook, ['Exercise 1']);
    await teacher.publishAssignment(notebook);
    await teacher.setWorkStatus(notebook, [one.kid8a], 'checked');
    const closed = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'test',
      title: 'Closed, not released',
      dueAt: past,
      answerTypes: ['mcq'],
    });
    await teacher.setAssignmentItems(closed, items);
    await teacher.publishAssignment(closed);

    const needs = await teacher.needsAttention();
    const find = (title: string, reason: string) => needs.find((n) => n.title === title && n.reason === reason);
    // Paper, with an absence: Kabir is absent; Riya has no mark yet.
    expect(find('Paper, with an absence', 'marks')).toMatchObject({ count: 1, className: '8A', subjectName: 'Mathematics' });
    expect(find('Paper, with an absence', 'release')).toBeDefined();
    // Kabir's notebook is not checked; Riya's is.
    expect(find('Last week, in the notebook', 'notebooks')?.count).toBe(1);
    expect(find('Closed, not released', 'release')).toBeDefined();
    // Nothing for work still open.
    expect(needs.map((n) => n.title)).not.toContain('Notebook check');
  });

  it('shows another teacher none of it', async () => {
    const other = createLmsClient(pgliteTransport(db, one.teacherB));
    expect((await other.needsAttention()).map((n) => n.title)).not.toContain('Last week, in the notebook');
  });
});
