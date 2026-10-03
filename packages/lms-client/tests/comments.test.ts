// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * A TEACHER'S COMMENT ON WORK, AND A REMARK ON THE REPORT CARD (migration
 * 0038). Written first.
 *
 * "A mark on its own does not tell a child what to fix." A teacher of the
 * class writes one short comment on a child's work for a piece of work they
 * set; the child reads it there — on a test, once its results are out. Once
 * a year each child's report card carries a remark from a teacher of their
 * class or the admin, whoever wrote last.
 */

let db: PGlite;
let one: School;
let other: School;
let admin: LmsClient;
let teacherA: LmsClient; // 8A Mathematics
let teacherB: LmsClient; // 8B Science
let teacherC: LmsClient; // 8A Mathematics too, and leaves
let riya: LmsClient; // 8A
let arjun: LmsClient; // 8B
let kabir: LmsClient; // 8A, and leaves
let kabirId: string;
let elsewhere: LmsClient; // the other school's teacher
let elsewhereAdmin: LmsClient;
let hw: string;
let test: string;
let draft: string;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const ymd = (n: number) => inDays(n).slice(0, 10);

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'REM');
  other = await buildSchool(db, 'OTH');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  teacherB = createLmsClient(pgliteTransport(db, one.teacherB));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  arjun = createLmsClient(pgliteTransport(db, one.kid8b));
  elsewhere = createLmsClient(pgliteTransport(db, other.teacherA));
  elsewhereAdmin = createLmsClient(pgliteTransport(db, other.admin));

  kabirId = await seat(db, one.org, 'student', 'REM-103', 'Kabir');
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, '3')`,
    [one.org, one.year, one.s8a, kabirId],
  );
  kabir = createLmsClient(pgliteTransport(db, kabirId));
  const c = await seat(db, one.org, 'teacher', 'REM-T3', 'Teacher C');
  await admin.setTeaching(one.s8a, one.maths, 'REM-T3', true);
  teacherC = createLmsClient(pgliteTransport(db, c));

  hw = await teacherA.createAssignment({
    sectionId: one.s8a,
    subjectId: one.maths,
    kind: 'homework',
    title: 'Draw a number line',
    dueAt: inDays(2),
    answerTypes: ['photo'],
  });
  await teacherA.publishAssignment(hw);
  test = await teacherA.createAssignment({
    sectionId: one.s8a,
    subjectId: one.maths,
    kind: 'test',
    title: 'Class test on paper',
    dueAt: inDays(-1),
    answerTypes: ['paper'],
    maxMarks: 20,
  });
  await teacherA.publishAssignment(test);
  draft = await teacherA.createAssignment({
    sectionId: one.s8a,
    subjectId: one.maths,
    kind: 'homework',
    title: 'Not yet set',
    dueAt: inDays(5),
    answerTypes: ['photo'],
  });
});
afterAll(async () => {
  await db.close();
});

describe('a comment on a piece of work', () => {
  it('is written by a teacher of the class and read by the child on that work', async () => {
    await teacherA.setWorkComment(hw, one.kid8a, '  Label both ends of the line, and mark zero.  ');
    expect(await riya.myWorkComment(hw)).toMatchObject({
      text: 'Label both ends of the line, and mark zero.',
      writtenByName: 'Teacher A',
    });
    expect((await riya.myWorkComment(hw))?.writtenAt).toEqual(expect.any(String));
  });

  it('is seen by the class’s teachers and the admin beside the child it is for', async () => {
    const want = [expect.objectContaining({ studentUserId: one.kid8a, text: 'Label both ends of the line, and mark zero.', writtenByName: 'Teacher A' })];
    expect(await teacherA.workComments(hw)).toEqual(want);
    expect(await teacherC.workComments(hw)).toEqual(want);
    expect(await admin.workComments(hw)).toEqual(want);
  });

  it('is changed by writing again — by any teacher of the class — and removed by writing nothing', async () => {
    await teacherC.setWorkComment(hw, one.kid8a, 'Good. Now put the fractions on it too.');
    expect(await riya.myWorkComment(hw)).toMatchObject({ text: 'Good. Now put the fractions on it too.', writtenByName: 'Teacher C' });
    expect(await teacherA.workComments(hw)).toHaveLength(1);
    await teacherA.setWorkComment(hw, one.kid8a, '   ');
    expect(await riya.myWorkComment(hw)).toBeNull();
    // Blank is blank however it is typed: line breaks, tabs, no-break and zero-width spaces.
    await teacherA.setWorkComment(hw, one.kid8a, 'Label both ends.');
    await teacherA.setWorkComment(hw, one.kid8a, '\n\t\r\n \u00a0\u200b\u3000\n');
    expect(await riya.myWorkComment(hw)).toBeNull();
    await teacherA.setWorkComment(hw, one.kid8a, '\n\tLabel both ends.\u00a0\n');
    expect(await riya.myWorkComment(hw)).toMatchObject({ text: 'Label both ends.' });
    await teacherA.setWorkComment(hw, one.kid8a, 'Label both ends.');
    await teacherA.setWorkComment(hw, one.kid8a, null);
    expect(await teacherA.workComments(hw)).toEqual([]);
    await teacherA.setWorkComment(hw, one.kid8a, 'Label both ends.');
  });

  it('is 1 to 1000 characters', async () => {
    await teacherA.setWorkComment(hw, one.kid8a, 'x'.repeat(1000));
    await expect(teacherA.setWorkComment(hw, one.kid8a, 'x'.repeat(1001))).rejects.toThrow(/1 to 1000 characters/);
    await teacherA.setWorkComment(hw, one.kid8a, 'Label both ends.');
  });

  it('is refused to another class’s teacher, a student, the admin, another school, and on a draft', async () => {
    await expect(teacherB.setWorkComment(hw, one.kid8a, 'Hello')).rejects.toThrow(/not your class/);
    await expect(riya.setWorkComment(hw, one.kid8a, 'Hello')).rejects.toThrow(/not your class/);
    await expect(admin.setWorkComment(hw, one.kid8a, 'Hello')).rejects.toThrow(/not your class/);
    await expect(elsewhere.setWorkComment(hw, one.kid8a, 'Hello')).rejects.toThrow(/not your class/);
    await expect(teacherA.setWorkComment(draft, one.kid8a, 'Hello')).rejects.toThrow(/not published/);
  });

  it('is never written for a child who is not in the class', async () => {
    await expect(teacherA.setWorkComment(hw, one.kid8b, 'Hello')).rejects.toThrow(/not in this class/);
    await expect(teacherA.setWorkComment(hw, other.kid8a, 'Hello')).rejects.toThrow(/not in this class/);
  });

  it("shows no child another child's comment, and no one outside the class the class's", async () => {
    expect(await arjun.myWorkComment(hw)).toBeNull();
    expect(await kabir.myWorkComment(hw)).toBeNull();
    await expect(teacherB.workComments(hw)).rejects.toThrow(/not your class/);
    await expect(riya.workComments(hw)).rejects.toThrow(/not your class/);
    await expect(elsewhere.workComments(hw)).rejects.toThrow(/not your class/);
    await expect(elsewhereAdmin.workComments(hw)).rejects.toThrow(/not your class/);
  });

  it("waits on a test until its results are released, as the test's marks do", async () => {
    await teacherA.setWorkComment(test, one.kid8a, 'Revise the sign rules before the next one.');
    expect(await riya.myWorkComment(test)).toBeNull();
    expect((await teacherA.workComments(test)).map((c) => c.text)).toEqual(['Revise the sign rules before the next one.']);
    await teacherA.releaseResults(test);
    expect(await riya.myWorkComment(test)).toMatchObject({ text: 'Revise the sign rules before the next one.' });
  });

  it('stops for a child who has left: none written, none listed, none read', async () => {
    await teacherA.setWorkComment(hw, kabirId, 'Neat work.');
    expect(await kabir.myWorkComment(hw)).toMatchObject({ text: 'Neat work.' });
    expect((await teacherA.workComments(hw)).map((c) => c.studentUserId).sort()).toEqual([one.kid8a, kabirId].sort());
    await admin.markLeft('REM-103');
    await expect(teacherA.setWorkComment(hw, kabirId, 'Neat work again.')).rejects.toThrow(/not in this class/);
    expect((await teacherA.workComments(hw)).map((c) => c.studentUserId)).toEqual([one.kid8a]);
    expect(await kabir.myWorkComment(hw)).toBeNull();
  });

  it('stops for a teacher who has left', async () => {
    await admin.markLeft('REM-T3');
    await expect(teacherC.setWorkComment(hw, one.kid8a, 'Hello')).rejects.toThrow(/not your class/);
    await expect(teacherC.workComments(hw)).rejects.toThrow(/not your class/);
  });
});

describe('a remark on the report card', () => {
  it('is written by a teacher of the child’s class and read on the child’s report', async () => {
    await teacherA.setReportRemark(one.kid8a, '  Riya asks good questions. She should show her working.  ');
    expect(await riya.reportRemark(one.kid8a)).toMatchObject({
      text: 'Riya asks good questions. She should show her working.',
      writtenByName: 'Teacher A',
      canEdit: false,
    });
    expect(await teacherA.reportRemark(one.kid8a)).toMatchObject({ writtenByName: 'Teacher A', canEdit: true });
    expect(await admin.reportRemark(one.kid8a)).toMatchObject({ writtenByName: 'Teacher A', canEdit: true });
  });

  it('is empty, and editable by those allowed, before anyone writes it', async () => {
    expect(await admin.reportRemark(one.kid8b)).toEqual({ text: null, writtenByName: null, writtenAt: null, canEdit: true });
    expect(await teacherB.reportRemark(one.kid8b)).toMatchObject({ text: null, canEdit: true });
    expect(await arjun.reportRemark(one.kid8b)).toMatchObject({ text: null, canEdit: false });
  });

  it('is one per child: the latest write wins and says who wrote it', async () => {
    await admin.setReportRemark(one.kid8a, 'A steady term. Keep practising fractions.');
    expect(await teacherA.reportRemark(one.kid8a)).toMatchObject({
      text: 'A steady term. Keep practising fractions.',
      writtenByName: 'Admin',
    });
    const { rows } = await db.query<{ n: number }>(`select count(*)::int n from lms.report_remark where student_user_id = $1`, [one.kid8a]);
    expect(rows[0].n).toBe(1);
  });

  it('is 1 to 600 characters, and writing nothing removes it', async () => {
    await expect(teacherA.setReportRemark(one.kid8a, 'x'.repeat(601))).rejects.toThrow(/1 to 600 characters/);
    await teacherA.setReportRemark(one.kid8a, 'x'.repeat(600));
    await teacherA.setReportRemark(one.kid8a, '');
    expect(await riya.reportRemark(one.kid8a)).toMatchObject({ text: null });
    await teacherA.setReportRemark(one.kid8a, 'x');
    await teacherA.setReportRemark(one.kid8a, '\n\n\t\u00a0\n');
    expect(await riya.reportRemark(one.kid8a)).toMatchObject({ text: null });
    await teacherA.setReportRemark(one.kid8a, 'A steady term. Keep practising fractions.');
  });

  it('is refused to a teacher of another class, the child, another child, and another school', async () => {
    await expect(teacherB.setReportRemark(one.kid8a, 'Hello')).rejects.toThrow(/only a teacher of their class/);
    await expect(riya.setReportRemark(one.kid8a, 'I am great')).rejects.toThrow(/only a teacher of their class/);
    await expect(arjun.setReportRemark(one.kid8a, 'Hello')).rejects.toThrow(/only a teacher of their class/);
    await expect(elsewhere.setReportRemark(one.kid8a, 'Hello')).rejects.toThrow(/only a teacher of their class/);
    await expect(elsewhereAdmin.setReportRemark(one.kid8a, 'Hello')).rejects.toThrow(/only a teacher of their class/);
    await expect(admin.setReportRemark(one.teacherA, 'Hello')).rejects.toThrow(/only a teacher of their class/);
  });

  it('is never written for a child who has left, by the teacher or the admin', async () => {
    await expect(teacherA.setReportRemark(kabirId, 'Hello')).rejects.toThrow(/only a teacher of their class/);
    await expect(admin.setReportRemark(kabirId, 'Hello')).rejects.toThrow(/only a teacher of their class/);
    expect(await admin.reportRemark(kabirId)).toMatchObject({ canEdit: false });
  });

  it('is read by nobody who may not see the child', async () => {
    await expect(teacherB.reportRemark(one.kid8a)).rejects.toThrow(/not yours to see/);
    await expect(arjun.reportRemark(one.kid8a)).rejects.toThrow(/not yours to see/);
    await expect(elsewhereAdmin.reportRemark(one.kid8a)).rejects.toThrow(/not yours to see/);
  });

  it('keeps its check away from browsers', async () => {
    await expect(pgliteTransport(db, one.admin).value('may_remark', { p_student: one.kid8a })).rejects.toThrow(
      /permission denied/,
    );
  });

  it('is in the activity log', async () => {
    const seen = (await admin.auditLog()).map((e) => `${e.action} ${e.target} ${e.actorName}`);
    expect(seen).toContain('remark-set REM-101 Teacher A');
    expect(seen).toContain('remark-set REM-101 Admin');
    expect(seen).toContain('remark-removed REM-101 Teacher A');
  });
});

describe('a new school year', () => {
  it('leaves last year’s comments and remark with last year', async () => {
    await admin.startNewYear('2027-28', ymd(3), ymd(367));
    // Riya is in 9A now; last year's 8A is nobody's class this year.
    await expect(teacherA.setWorkComment(hw, one.kid8a, 'Hello')).rejects.toThrow(/not your class/);
    expect(await riya.myWorkComment(hw)).toBeNull();
    expect(await riya.reportRemark(one.kid8a)).toMatchObject({ text: null, canEdit: false });
    expect(await admin.reportRemark(one.kid8a)).toMatchObject({ text: null, canEdit: true });
    await expect(teacherA.setReportRemark(one.kid8a, 'Hello')).rejects.toThrow(/only a teacher of their class/);
    await admin.setReportRemark(one.kid8a, 'A good start in Class 9.');
    expect(await riya.reportRemark(one.kid8a)).toMatchObject({ text: 'A good start in Class 9.' });
    const { rows } = await db.query<{ n: number }>(`select count(*)::int n from lms.report_remark where student_user_id = $1`, [one.kid8a]);
    expect(rows[0].n).toBe(2);
  });
});
