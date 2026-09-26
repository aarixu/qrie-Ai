// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { asUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, loginEmail, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * The teacher app and the student app, joined end to end through the one API
 * both of them use (migration 0026), on the real migrations and as the real
 * roles. Written first and watched failing.
 *
 * One story, in order: a teacher sets homework from the library and from
 * their own question, a student finds it, answers it without ever seeing the
 * key, and the teacher sees who handed in, marks it, and the student sees
 * the mark.
 */

let db: PGlite;
let one: School;
let libraryItem: string;
let kid2: string;
let teacher: LmsClient;
let student: LmsClient;
let homeworkId: string;
let ownItem: string;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'API');
  kid2 = await seat(db, one.org, 'student', 'API-103', 'Kabir');
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number)
     values ($1, $2, $3, $4, '3')`,
    [one.org, one.year, one.s8a, kid2],
  );
  libraryItem = (
    await db.query<{ id: string }>(
      `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index)
       values ('probe-api-1', '{m8-frac}', 8, 'Mathematics', 'mcq', 'What is 1/2 + 1/4?',
               '["2/6","3/4","1/8"]'::jsonb, 1) returning id`,
    )
  ).rows[0].id;
  teacher = createLmsClient(pgliteTransport(db, one.teacherA));
  student = createLmsClient(pgliteTransport(db, one.kid8a));
});
afterAll(async () => {
  await db.close();
});

describe('signing in', () => {
  it('turns a login id into the address its account is stored under', () => {
    expect(loginEmail('API-T1')).toBe('api-t1@login.qrie.invalid');
  });

  it('tells a teacher who they are and which school they are in', async () => {
    expect(await teacher.me()).toMatchObject({
      userId: one.teacherA,
      orgId: one.org,
      kind: 'teacher',
      displayName: 'Teacher A',
      loginId: 'API-T1',
      schoolCode: 'API',
      schoolName: 'API Public School',
    });
  });
});

describe('a teacher setting homework', () => {
  it('sees only the classes they teach, with how many students are in each', async () => {
    expect(await teacher.myClasses()).toEqual([
      {
        sectionId: one.s8a,
        grade: 8,
        sectionName: 'A',
        subjectId: one.maths,
        subjectName: 'Mathematics',
        students: 2,
      },
    ]);
  });

  it("sees their class's roster, in roll order", async () => {
    const roster = await teacher.classRoster(one.s8a);
    expect(roster.map((r) => [r.displayName, r.rollNumber])).toEqual([
      ['Riya', '1'],
      ['Kabir', '3'],
    ]);
  });

  it('finds library questions for their grade and subject, not yet approved', async () => {
    const found = await teacher.library({ grade: 8, subject: 'Mathematics' });
    expect(found.find((i) => i.id === libraryItem)).toMatchObject({ approved: false, source: 'library' });
  });

  it('approves a library question for the school', async () => {
    await teacher.approveItem(libraryItem);
    const found = await teacher.library({ grade: 8, subject: 'Mathematics' });
    expect(found.find((i) => i.id === libraryItem)?.approved).toBe(true);
  });

  it('writes their own question, which is approved as it is written', async () => {
    ownItem = await teacher.writeItem({
      grade: 8,
      subject: 'Mathematics',
      stem: 'What is 3/4 - 1/4?',
      options: ['1/2', '2/4', '1'],
      correctIndex: 0,
    });
    const found = await teacher.library({ grade: 8, subject: 'Mathematics' });
    expect(found.find((i) => i.id === ownItem)).toMatchObject({ approved: true, source: 'school' });
  });

  it("cannot approve another school's own question, through the API or around it", async () => {
    const two = await buildSchool(db, 'TWO');
    const theirs = await createLmsClient(pgliteTransport(db, two.teacherA)).writeItem({
      grade: 8,
      subject: 'Mathematics',
      stem: 'A question only TWO school may set',
      options: ['a', 'b'],
      correctIndex: 0,
    });
    await expect(teacher.approveItem(theirs)).rejects.toThrow(/no such question/);
    await expect(
      asUser(db, one.teacherA, (tx) =>
        tx.query(`insert into lms.item_approval (org_id, item_id, approved_by) values ($1, $2, $3)`, [
          one.org,
          theirs,
          one.teacherA,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('refuses to publish MCQ homework that has no questions yet', async () => {
    const empty = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'homework',
      title: 'Empty',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      answerTypes: ['mcq'],
    });
    await expect(teacher.publishAssignment(empty)).rejects.toThrow(/at least one question/);
  });

  it('creates homework, puts two questions on it, and publishes it', async () => {
    homeworkId = await teacher.createAssignment({
      sectionId: one.s8a,
      subjectId: one.maths,
      kind: 'homework',
      title: 'Fractions 1',
      instructions: 'Try each one before checking.',
      dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      answerTypes: ['mcq'],
    });
    await teacher.setAssignmentItems(homeworkId, [libraryItem, ownItem]);
    await teacher.publishAssignment(homeworkId);
    const list = await teacher.classAssignments(one.s8a, one.maths);
    expect(list.find((a) => a.id === homeworkId)).toMatchObject({ title: 'Fractions 1', items: 2, submitted: 0, published: true });
  });

  it('cannot set homework for a class they do not teach', async () => {
    await expect(
      teacher.createAssignment({
        sectionId: one.s8b,
        subjectId: one.maths,
        kind: 'homework',
        title: 'Not mine',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        answerTypes: ['mcq'],
      }),
    ).rejects.toThrow(/row-level security|not your class/);
  });
});

describe('a student doing it', () => {
  it('finds the homework, with no attempt used yet', async () => {
    const mine = await student.myAssignments();
    expect(mine.find((a) => a.id === homeworkId)).toMatchObject({
      title: 'Fractions 1',
      subjectName: 'Mathematics',
      mcqAttemptsUsed: 0,
      attemptsAllowed: 1,
    });
  });

  it('receives the questions in order, without a key', async () => {
    const qs = await student.assignmentQuestions(homeworkId);
    expect(qs.map((q) => q.stem)).toEqual(['What is 1/2 + 1/4?', 'What is 3/4 - 1/4?']);
    expect(JSON.stringify(qs)).not.toMatch(/correct/i);
  });

  it('hands it in and gets the score the database worked out', async () => {
    const r = await student.submitMcq(homeworkId, { [libraryItem]: 1, [ownItem]: 2 });
    expect(r).toMatchObject({ correct: 1, total: 2 });
  });

  it('sees the attempt used and the score on the homework list', async () => {
    const mine = await student.myAssignments();
    expect(mine.find((a) => a.id === homeworkId)).toMatchObject({ mcqAttemptsUsed: 1, bestCorrect: 1, bestTotal: 2 });
  });
});

describe('the teacher reading the results', () => {
  it('sees who handed in and who did not', async () => {
    const results = await teacher.assignmentResults(homeworkId);
    expect(results.map((r) => [r.displayName, r.submitted, r.machineCorrect])).toEqual([
      ['Riya', true, 1],
      ['Kabir', false, null],
    ]);
  });

  it("marks Riya's work, and she sees the teacher's mark", async () => {
    const [riya] = await teacher.assignmentResults(homeworkId);
    await teacher.setTeacherMark(riya.submissionId!, 1.5, 2);
    const mine = await student.myAssignments();
    expect(mine.find((a) => a.id === homeworkId)).toMatchObject({ teacherScore: 1.5, teacherMax: 2 });
  });

  it('leaves another teacher unable to see any of it', async () => {
    const other = createLmsClient(pgliteTransport(db, one.teacherB));
    expect(await other.classAssignments(one.s8a, one.maths)).toEqual([]);
    expect(await other.assignmentResults(homeworkId)).toEqual([]);
  });

  it('leaves Kabir unable to see Riya’s score', async () => {
    const kabir = createLmsClient(pgliteTransport(db, kid2));
    const mine = await kabir.myAssignments();
    expect(mine.find((a) => a.id === homeworkId)).toMatchObject({ mcqAttemptsUsed: 0, bestCorrect: null });
  });
});
