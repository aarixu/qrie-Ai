// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * DAILY ATTENDANCE (migration 0036). Written first.
 *
 * A teacher of a class marks each child present, absent, late or on leave
 * for a day — never a day still to come, never a child not in the class.
 * The child sees their own; their teachers and the admin see the class's;
 * the admin sees the whole school's today.
 */

let db: PGlite;
let one: School;
let admin: LmsClient;
let teacherA: LmsClient;
let teacherB: LmsClient;
let riya: LmsClient;
let arjun: LmsClient;
// "Today" is India's date, as the database decides it (0036: now() at time zone 'Asia/Kolkata').
// A UTC date is a day behind between 00:00 and 05:30 IST, which failed this file at night.
const indiaDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(ms));
const today = indiaDate(Date.now());
const daysAgo = (n: number) => indiaDate(Date.now() - n * 86_400_000);

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'ATT');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  teacherB = createLmsClient(pgliteTransport(db, one.teacherB));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  arjun = createLmsClient(pgliteTransport(db, one.kid8b));
});
afterAll(async () => {
  await db.close();
});

describe('marking a class', () => {
  it("lists the class for a day, each child's mark empty until marked", async () => {
    const sheet = await teacherA.attendanceSheet(one.s8a, today);
    expect(sheet).toEqual([expect.objectContaining({ studentUserId: one.kid8a, displayName: 'Riya', status: null })]);
  });

  it('keeps the marks a teacher of the class gives, and changes them when marked again', async () => {
    await teacherA.markAttendance(one.s8a, today, { [one.kid8a]: 'late' });
    await teacherA.markAttendance(one.s8a, today, { [one.kid8a]: 'present' });
    await teacherA.markAttendance(one.s8a, daysAgo(1), { [one.kid8a]: 'absent' });
    await teacherA.markAttendance(one.s8a, daysAgo(2), { [one.kid8a]: 'leave' });
    expect((await teacherA.attendanceSheet(one.s8a, today))[0]).toMatchObject({ status: 'present', markedByName: 'Teacher A' });
  });

  it('refuses another class’s teacher, a student, a child not in the class, a day to come, and a word not on the list', async () => {
    await expect(teacherB.markAttendance(one.s8a, today, { [one.kid8a]: 'present' })).rejects.toThrow(/not your class/);
    await expect(riya.markAttendance(one.s8a, today, { [one.kid8a]: 'present' })).rejects.toThrow(/not your class/);
    await expect(teacherA.markAttendance(one.s8a, today, { [one.kid8b]: 'present' })).rejects.toThrow(/not in this class/);
    await expect(teacherA.markAttendance(one.s8a, daysAgo(-1), { [one.kid8a]: 'present' })).rejects.toThrow(/has not come yet/);
    await expect(
      teacherA.markAttendance(one.s8a, today, { [one.kid8a]: 'bunked' as unknown as 'present' }),
    ).rejects.toThrow(/present, absent, late or leave/);
    await expect(teacherB.attendanceSheet(one.s8a, today)).rejects.toThrow(/not your class/);
  });
});

describe('what each person sees', () => {
  it('gives the child their own days and their rate, and nobody else’s', async () => {
    const mine = await riya.myAttendance(30);
    expect(mine.days.map((d) => [d.onDate, d.status])).toEqual([
      [today, 'present'],
      [daysAgo(1), 'absent'],
      [daysAgo(2), 'leave'],
    ]);
    // Present or late count as present; leave is left out of the rate.
    expect(mine.rate).toBe(0.5);
    expect((await arjun.myAttendance(30)).days).toEqual([]);
  });

  it("sums a class over a span for its teachers and the admin, and a student's rate for their report", async () => {
    const sum = await teacherA.attendanceSummary(one.s8a, daysAgo(30), today);
    expect(sum).toEqual([
      expect.objectContaining({ displayName: 'Riya', present: 1, late: 0, absent: 1, leave: 1, rate: 0.5 }),
    ]);
    expect((await admin.attendanceSummary(one.s8a, daysAgo(30), today))[0]?.rate).toBe(0.5);
    expect(await teacherA.studentAttendance(one.kid8a)).toMatchObject({ marked: 3, rate: 0.5 });
    await expect(arjun.studentAttendance(one.kid8a)).rejects.toThrow(/not yours to see/);
  });

  it("gives the admin today's picture: which classes are marked, and how many came", async () => {
    const todayAll = await admin.schoolAttendanceToday();
    expect(todayAll).toEqual([
      expect.objectContaining({ className: '8A', students: 1, marked: 1, present: 1 }),
      expect.objectContaining({ className: '8B', students: 1, marked: 0, present: 0 }),
    ]);
    await expect(teacherA.schoolAttendanceToday()).rejects.toThrow(/only the school admin/);
  });
});
