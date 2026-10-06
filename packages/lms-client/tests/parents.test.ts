// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * PARENTS (migration 0045). Written first.
 *
 * A parent signs in to the school's app with their own ID and PIN and sees
 * their own children — the same report the child's teachers and the admin
 * see, read-only: the card, subjects, recent work, attendance, the
 * teacher's remark, the photo — and the notices sent to their child's class
 * and to the whole school. The admin links a parent to a child (a second
 * child too, for brothers and sisters) and can unlink them. A parent sees
 * nobody else's child, does nothing a teacher or the admin does, and loses
 * the child when either of them leaves the school.
 */

let db: PGlite;
let one: School;
let other: School;
let admin: LmsClient;
let teacherA: LmsClient;
let riya: LmsClient;
let sunita: LmsClient; // Riya's mother, and later Arjun's
let sunitaId: string;
let rakesh: LmsClient; // a parent with no child linked
let elsewhereAdmin: LmsClient;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'PAR');
  other = await buildSchool(db, 'OTH');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  elsewhereAdmin = createLmsClient(pgliteTransport(db, other.admin));
  sunitaId = await seat(db, one.org, 'parent', 'PAR-P1', 'Sunita Sharma');
  sunita = createLmsClient(pgliteTransport(db, sunitaId));
  rakesh = createLmsClient(pgliteTransport(db, await seat(db, one.org, 'parent', 'PAR-P2', 'Rakesh Mehta')));
});
afterAll(async () => {
  await db.close();
});

describe('linking a parent to a child', () => {
  it("is the admin's, and gives the parent their child", async () => {
    expect(await sunita.myChildren()).toEqual([]);
    await admin.linkParent('PAR-P1', 'PAR-101');
    expect(await sunita.myChildren()).toEqual([
      { userId: one.kid8a, loginId: 'PAR-101', displayName: 'Riya', className: '8A', rollNumber: '1' },
    ]);
    expect(await admin.studentParents(one.kid8a)).toEqual([{ loginId: 'PAR-P1', displayName: 'Sunita Sharma' }]);
  });

  it('is refused to a teacher, a child, a parent and another school, and for anyone but a parent and a child', async () => {
    await expect(teacherA.linkParent('PAR-P2', 'PAR-101')).rejects.toThrow(/only the school admin/);
    await expect(riya.linkParent('PAR-P2', 'PAR-101')).rejects.toThrow(/only the school admin/);
    await expect(sunita.linkParent('PAR-P1', 'PAR-102')).rejects.toThrow(/only the school admin/);
    await expect(elsewhereAdmin.linkParent('PAR-P2', 'PAR-101')).rejects.toThrow(/no one in your school/);
    await expect(admin.linkParent('PAR-T1', 'PAR-101')).rejects.toThrow(/PAR-T1 is not a parent/);
    await expect(admin.linkParent('PAR-P2', 'PAR-T1')).rejects.toThrow(/PAR-T1 is not a student/);
    expect(await rakesh.myChildren()).toEqual([]);
    await expect(teacherA.studentParents(one.kid8a)).rejects.toThrow(/only the school admin/);
  });

  it('gives a second child to the same parent, for brothers and sisters', async () => {
    await admin.linkParent('PAR-P1', 'PAR-102');
    expect((await sunita.myChildren()).map((c) => [c.loginId, c.className])).toEqual([
      ['PAR-101', '8A'],
      ['PAR-102', '8B'],
    ]);
    // Linking twice changes nothing.
    await admin.linkParent('PAR-P1', 'PAR-102');
    expect(await sunita.myChildren()).toHaveLength(2);
  });

  it('is in the activity log', async () => {
    const log = (await admin.auditLog()).filter((e) => e.action === 'parent-linked').map((e) => e.target);
    expect(log).toEqual(['PAR-P1 PAR-102', 'PAR-P1 PAR-101']);
  });
});

describe('what a parent sees', () => {
  it("is their child's report, as the child's teachers see it", async () => {
    expect(await sunita.studentCard(one.kid8a)).toMatchObject({ displayName: 'Riya', className: '8A' });
    // Every subject and piece of work, as the child sees them.
    const subjects = await riya.studentSubjects(one.kid8a);
    expect(subjects.map((s) => s.subjectName)).toEqual(['Mathematics']);
    expect(await sunita.studentSubjects(one.kid8a)).toEqual(subjects);
    expect(await sunita.studentTimeline(one.kid8a)).toEqual(await riya.studentTimeline(one.kid8a));
    expect(await sunita.studentAttendance(one.kid8a)).toMatchObject({ marked: 0 });
    await teacherA.setReportRemark(one.kid8a, 'A careful worker.');
    expect(await sunita.reportRemark(one.kid8a)).toMatchObject({ text: 'A careful worker.' });
    expect(await sunita.accountPhotos([one.kid8a])).toEqual([]);
  });

  it("is nobody else's child", async () => {
    const kavya = await seat(db, one.org, 'student', 'PAR-103', 'Kavya');
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, '3')`,
      [one.org, one.year, one.s8a, kavya],
    );
    await expect(sunita.studentCard(kavya)).rejects.toThrow(/not yours to see/);
    await expect(sunita.studentAttendance(kavya)).rejects.toThrow(/not yours to see/);
    await expect(rakesh.studentCard(one.kid8a)).rejects.toThrow(/not yours to see/);
    await expect(sunita.studentCard(other.kid8a)).rejects.toThrow(/not yours to see/);
  });

  it("is the notices for their child's class and the whole school, and no others", async () => {
    const for8a = await teacherA.sendNotice({ title: 'Bring a geometry box', body: 'Tomorrow.', sectionIds: [one.s8a] });
    const forAll = await admin.sendNotice({ title: 'School closed on Friday', body: 'For the election.', sectionIds: null });
    const forOther = await admin.sendNotice({ title: '8B only', body: 'Not for 8A.', sectionIds: [one.s8b] });
    await admin.unlinkParent('PAR-P1', 'PAR-102');
    const seen = (await sunita.myNotices()).map((n) => n.noticeId);
    expect(seen).toEqual(expect.arrayContaining([for8a, forAll]));
    expect(seen).not.toContain(forOther);
    expect((await rakesh.myNotices()).map((n) => n.noticeId)).toEqual([forAll]);
    await sunita.readNotice(for8a);
    // A parent's read is not counted among the class's (8A: Riya and Kavya).
    expect((await teacherA.myNotices()).find((n) => n.noticeId === for8a)).toMatchObject({ readers: 0, audience: 2 });
  });

  it('is nothing a teacher or the admin does', async () => {
    await expect(sunita.schoolOverview()).rejects.toThrow(/only the school admin/);
    await expect(sunita.sendNotice({ title: 'Hi', body: 'Hello.', sectionIds: [one.s8a] })).rejects.toThrow(/only a teacher or the school admin/);
    await expect(sunita.setReportRemark(one.kid8a, 'Lovely.')).rejects.toThrow(/only a teacher of their class/);
    await expect(sunita.classRoster(one.s8a)).resolves.toEqual([]);
    expect(await sunita.myClasses()).toEqual([]);
  });
});

describe('a parent losing a child', () => {
  it('happens when the admin unlinks them', async () => {
    expect((await sunita.myChildren()).map((c) => c.loginId)).toEqual(['PAR-101']);
    await expect(sunita.studentCard(one.kid8b)).rejects.toThrow(/not yours to see/);
    expect((await admin.auditLog()).some((e) => e.action === 'parent-unlinked' && e.target === 'PAR-P1 PAR-102')).toBe(true);
  });

  it('happens when the child leaves, and comes back if the child is brought back', async () => {
    await admin.markLeft('PAR-101');
    expect(await sunita.myChildren()).toEqual([]);
    await expect(sunita.studentCard(one.kid8a)).rejects.toThrow(/not yours to see/);
    await admin.restoreAccount('PAR-101');
    expect((await sunita.myChildren()).map((c) => c.loginId)).toEqual(['PAR-101']);
  });

  it('happens when the parent leaves', async () => {
    await admin.markLeft('PAR-P1');
    expect(await sunita.myChildren()).toEqual([]);
    await expect(sunita.studentCard(one.kid8a)).rejects.toThrow(/not yours to see/);
    expect(await admin.studentParents(one.kid8a)).toEqual([]);
  });
});

describe('the database', () => {
  it('keeps the links away from browsers', async () => {
    const { rows } = await db.query<{ r: boolean; rls: boolean }>(
      `select has_table_privilege('authenticated', 'lms.guardian', 'select') r,
              (select relrowsecurity from pg_class where oid = 'lms.guardian'::regclass) rls`,
    );
    expect(rows[0]).toEqual({ r: false, rls: true });
  });
});
