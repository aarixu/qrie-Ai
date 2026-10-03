// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * A NEW SCHOOL YEAR, AND MOVING A CHILD (migration 0037). Written first.
 *
 * On the first days of the new session the admin starts the year: every
 * child goes up a class in the same section, Class 12 leaves the school,
 * and each teacher keeps teaching the same classes — now to the children
 * moving up into them. Last year stays for the record; nobody sees it
 * through this year's classes. A child kept back, or put in the wrong
 * section, is moved by the admin.
 */

let db: PGlite;
let one: School;
let admin: LmsClient;
let teacherA: LmsClient;
let riya: LmsClient;
let senior: string;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const today = ymd(new Date());
const inDays = (n: number) => ymd(new Date(Date.now() + n * 86_400_000));

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'NEW');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  const s12a = (
    await db.query<{ id: string }>(
      `insert into lms.section (org_id, academic_year_id, grade, name) values ($1, $2, 12, 'A') returning id`,
      [one.org, one.year],
    )
  ).rows[0].id;
  senior = await seat(db, one.org, 'student', 'NEW-1201', 'Kabir Senior');
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, '1')`,
    [one.org, one.year, s12a, senior],
  );
});
afterAll(async () => {
  await db.close();
});

describe('starting a new year', () => {
  it('is refused to anyone but the admin, too far ahead, backwards, or twice', async () => {
    await expect(teacherA.startNewYear('2027-28', today, inDays(364))).rejects.toThrow(/only the school admin/);
    await expect(admin.startNewYear('2027-28', inDays(30), inDays(394))).rejects.toThrow(/week it begins/);
    await expect(admin.startNewYear('2027-28', today, inDays(-1))).rejects.toThrow(/ends before it starts/);
    await expect(admin.startNewYear('2026-27', today, inDays(364))).rejects.toThrow(/already/);
    await expect(admin.startNewYear('2025-26', '2025-04-01', '2026-03-31')).rejects.toThrow(/must start after 2026-27/);
  });

  it('moves every child up a class in the same section, and Class 12 out of the school', async () => {
    // Three days early: this year at once.
    const r = await admin.startNewYear('2027-28', inDays(3), inDays(367));
    expect(r).toEqual({ promoted: 2, graduated: 1, sections: 5 });
    expect((await admin.studentCard(one.kid8a))?.className).toBe('9A');
    expect((await admin.studentCard(one.kid8b))?.className).toBe('9B');
    expect((await admin.schoolLeft()).map((p) => p.loginId)).toEqual(['NEW-1201']);
    expect((await admin.schoolOverview())?.students).toBe(2);
    const count = async (sql: string, params: unknown[]) =>
      Number((await db.query<{ n: number }>(sql, params)).rows[0].n);
    expect(await count(`select count(*) n from public.membership where user_id = $1`, [senior])).toBe(0);
    expect(
      await count(`select count(*) n from lms.enrolment where academic_year_id = $1 and left_on is null`, [one.year]),
    ).toBe(0);
  });

  it('keeps each teacher on the same classes, now with the children moving up into them', async () => {
    expect((await teacherA.myClasses()).map((c) => `${c.grade}${c.sectionName} ${c.subjectName} ${c.students}`)).toEqual([
      '8A Mathematics 0',
    ]);
    // Last year's 8A is not this year's: Riya is in 9A now, which nobody teaches yet.
    await expect(teacherA.studentCard(one.kid8a)).rejects.toThrow(/not yours to see/);
  });

  it("gives the child this year's class", async () => {
    expect((await riya.studentCard(one.kid8a))?.className).toBe('9A');
  });

  it("lists this year's sections for the admin, with their children", async () => {
    const sections = await admin.schoolSections();
    expect(sections.map((s) => `${s.className} ${s.students}`)).toEqual(['8A 0', '8B 0', '9A 1', '9B 1', '12A 0']);
    await expect(teacherA.schoolSections()).rejects.toThrow(/only the school admin/);
  });
});

describe('moving a child', () => {
  it('to another section of this year, keeping or changing the roll number', async () => {
    const s9b = (await admin.schoolSections()).find((s) => s.className === '9B')!;
    await admin.moveStudent('NEW-101', s9b.sectionId, '7');
    expect(await admin.studentCard(one.kid8a)).toMatchObject({ className: '9B', rollNumber: '7' });
    const s8a = (await admin.schoolSections()).find((s) => s.className === '8A')!;
    await admin.moveStudent('NEW-101', s8a.sectionId, null);
    expect(await admin.studentCard(one.kid8a)).toMatchObject({ className: '8A', rollNumber: '7' });
  });

  it('never onto a roll number already taken, never into another school, and only by the admin', async () => {
    const s8a = (await admin.schoolSections()).find((s) => s.className === '8A')!;
    const s9b = (await admin.schoolSections()).find((s) => s.className === '9B')!;
    await expect(admin.moveStudent('NEW-102', s8a.sectionId, '7')).rejects.toThrow(/roll 7 in 8A is taken/);
    const other = await buildSchool(db, 'OTH');
    const elsewhere = createLmsClient(pgliteTransport(db, other.admin));
    await expect(elsewhere.moveStudent('NEW-101', s9b.sectionId, null)).rejects.toThrow(/no one in your school/);
    await expect(admin.moveStudent('NEW-101', other.s8a, null)).rejects.toThrow(/not a class of this year/);
    await expect(teacherA.moveStudent('NEW-101', s9b.sectionId, null)).rejects.toThrow(/only the school admin/);
  });

  it('is in the activity log', async () => {
    const seen = (await admin.auditLog()).map((e) => `${e.action} ${e.target}`);
    expect(seen).toContain('year-started 2027-28');
    expect(seen).toContain('moved NEW-101 9B');
  });
});
