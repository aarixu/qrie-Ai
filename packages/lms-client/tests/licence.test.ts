// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { asService, asUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, licenceWarnings, pgliteTransport, type LmsClient, type SchoolLicence } from '../src/index.ts';

/**
 * A LICENCE PER SCHOOL, AND THE FOUNDER'S LIST (migration 0041). Written first.
 *
 * Qrie — the service role, nobody signed in — gives a school a plan, a number
 * of seats and a last day. The school's admin reads it with the seats in
 * use: one for each student in a class of this year who has not left. A
 * school with no licence reads as "no licence set", with nothing limited.
 * No function a signed-in person can call writes it. The founder lists every
 * school with its licence, its people and the day it was last active.
 */

let db: PGlite;
let one: School;
let two: School;
let admin: LmsClient;
let teacherA: LmsClient;
let riya: LmsClient;
let otherAdmin: LmsClient;
let today: string;
const addDays = (ymd: string, n: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const asFounder = <R>(sql: string, params: unknown[] = []) =>
  asService(db, async (tx) => (await tx.query<R>(sql, params)).rows);
const setLicence = (code: string, plan: string | null, seats: number | null, until: string | null) =>
  asFounder(`select lms.set_licence($1, $2, $3, $4::date)`, [code, plan, seats, until]);

interface FounderRow {
  code: string;
  school_name: string;
  plan: string | null;
  seats: number | null;
  seats_used: number;
  valid_until: string | null;
  days_left: number | null;
  students: number;
  teachers: number;
  last_active: string | null;
  days_since_active: number | null;
}
const founderList = () => asFounder<FounderRow>(`select * from lms.founder_schools()`);

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'LIC');
  two = await buildSchool(db, 'OTH');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  otherAdmin = createLmsClient(pgliteTransport(db, two.admin));
  today = (await db.query<{ d: string }>(`select lms.india_today()::text as d`)).rows[0].d;
});
afterAll(async () => {
  await db.close();
});

describe('a school with no licence', () => {
  it('reads as no licence set: no plan, seats or last day, its seats in use still counted, and no warning', async () => {
    const l = await admin.schoolLicence();
    expect(l).toEqual({ plan: null, seats: null, seatsUsed: 2, validUntil: null, daysLeft: null });
    expect(licenceWarnings(l)).toEqual([]);
  });
});

describe('setting a licence', () => {
  it('is refused to everyone signed in, and no browser reads or writes the table itself', async () => {
    for (const who of [one.admin, one.teacherA, one.kid8a]) {
      await expect(
        pgliteTransport(db, who).value('set_licence', { p_code: 'LIC', p_plan: 'standard', p_seats: 9999, p_until: '2030-01-01' }),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      asUser(db, one.admin, (tx) =>
        tx.query(`insert into lms.licence (org_id, plan, seats, valid_until) values ($1, 'standard', 9999, '2030-01-01')`, [one.org]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, one.admin, (tx) => tx.query(`select * from lms.licence`))).rejects.toThrow(/permission denied/);
  });

  it('is written by no function a signed-in person can call', async () => {
    const writers = async (onlyOpen: boolean) =>
      (
        await db.query<{ name: string }>(
          `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'lms'
              and p.prosrc ~* '(insert\\s+into|update|delete\\s+from)\\s+lms\\.licence\\M'
              and (not $1 or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
            order by 1`,
          [onlyOpen],
        )
      ).rows.map((r) => r.name);
    expect(await writers(false)).toEqual(['set_licence']);
    expect(await writers(true)).toEqual([]);
  });

  it('sets the plan, seats and last day by school code, and setting it again replaces them', async () => {
    await setLicence('LIC', 'trial', 10, addDays(today, 10));
    await setLicence(' lic ', 'Pilot', 3, addDays(today, 150));
    expect(await admin.schoolLicence()).toEqual({
      plan: 'pilot',
      seats: 3,
      seatsUsed: 2,
      validUntil: addDays(today, 150),
      daysLeft: 150,
    });
  });

  it('refuses a school that does not exist, a plan that is not one short word, no seats, and no last day', async () => {
    await expect(setLicence('NOPE', 'pilot', 3, today)).rejects.toThrow(/no school with the code NOPE/);
    await expect(setLicence('LIC', 'gold plan', 3, today)).rejects.toThrow(/a plan is one word/);
    await expect(setLicence('LIC', null, 3, today)).rejects.toThrow(/a plan is one word/);
    await expect(setLicence('LIC', 'pilot', 0, today)).rejects.toThrow(/seats are 1 to 100000/);
    await expect(setLicence('LIC', 'pilot', null, today)).rejects.toThrow(/seats are 1 to 100000/);
    await expect(setLicence('LIC', 'pilot', 3, null)).rejects.toThrow(/give the last day/);
    expect((await admin.schoolLicence()).plan).toBe('pilot');
  });

  it("is in the school's activity log, set by nobody in the school", async () => {
    const log = (await admin.auditLog()).filter((e) => e.action === 'licence-set');
    expect(log.map((e) => [e.actorName, e.target, e.details])).toEqual([
      [null, 'pilot', { seats: 3, validUntil: addDays(today, 150) }],
      [null, 'trial', { seats: 10, validUntil: addDays(today, 10) }],
    ]);
    expect((await otherAdmin.auditLog()).some((e) => e.action === 'licence-set')).toBe(false);
  });
});

describe("reading the school's licence", () => {
  it("is for the school's admin only; another school's admin reads their own", async () => {
    await expect(teacherA.schoolLicence()).rejects.toThrow(/only the school admin/);
    await expect(riya.schoolLicence()).rejects.toThrow(/only the school admin/);
    expect(await otherAdmin.schoolLicence()).toEqual({ plan: null, seats: null, seatsUsed: 2, validUntil: null, daysLeft: null });
  });

  it('counts a seat for each student in a class of this year who has not left — not staff, last year, a leaver or another school', async () => {
    const used = async () => (await admin.schoolLicence()).seatsUsed;
    expect(await used()).toBe(2);

    // A child in last year's class only.
    const lastYear = (
      await db.query<{ id: string }>(
        `insert into lms.academic_year (org_id, label, starts_on, ends_on) values ($1, '2025-26', '2025-04-01', '2026-03-31') returning id`,
        [one.org],
      )
    ).rows[0].id;
    const old7a = (
      await db.query<{ id: string }>(
        `insert into lms.section (org_id, academic_year_id, grade, name) values ($1, $2, 7, 'A') returning id`,
        [one.org, lastYear],
      )
    ).rows[0].id;
    const oldKid = await seat(db, one.org, 'student', 'LIC-OLD1', 'Old Kid');
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number, joined_on)
       values ($1, $2, $3, $4, '9', '2025-04-01')`,
      [one.org, lastYear, old7a, oldKid],
    );
    expect(await used()).toBe(2);

    // A new child in this year's 8A.
    const kavya = await seat(db, one.org, 'student', 'LIC-103', 'Kavya');
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, '3')`,
      [one.org, one.year, one.s8a, kavya],
    );
    expect(await used()).toBe(3);

    // A leaver gives their seat back, and takes it again if restored.
    await admin.markLeft('LIC-101');
    expect(await used()).toBe(2);
    await admin.restoreAccount('LIC-101');
    expect(await used()).toBe(3);
    // Left, even should an enrolment of theirs have been left open.
    await db.query(`update lms.account set left_at = now() where user_id = $1`, [one.kid8b]);
    expect(await used()).toBe(2);
    await db.query(`update lms.account set left_at = null where user_id = $1`, [one.kid8b]);
    expect(await used()).toBe(3);

    // A child whose class this year was closed, and who is in no other.
    await db.query(`update lms.enrolment set left_on = joined_on where student_user_id = $1`, [kavya]);
    expect(await used()).toBe(2);

    // Another school's children are not counted here, nor ours there.
    expect((await otherAdmin.schoolLicence()).seatsUsed).toBe(2);
  });

  it('gives the days left: 0 on the last day, below 0 once it has ended', async () => {
    await setLicence('LIC', 'pilot', 3, today);
    expect(await admin.schoolLicence()).toMatchObject({ validUntil: today, daysLeft: 0 });
    await setLicence('LIC', 'pilot', 3, addDays(today, -1));
    expect(await admin.schoolLicence()).toMatchObject({ validUntil: addDays(today, -1), daysLeft: -1 });
    await setLicence('LIC', 'pilot', 3, addDays(today, 150));
  });
});

describe("the portal's warnings", () => {
  const licence = (l: Partial<SchoolLicence>): SchoolLicence => ({
    plan: 'pilot',
    seats: 100,
    seatsUsed: 40,
    validUntil: '2027-03-31',
    daysLeft: 120,
    ...l,
  });

  it('say nothing while the licence runs more than 30 days and has seats free, nor when no licence is set', () => {
    expect(licenceWarnings(licence({}))).toEqual([]);
    expect(licenceWarnings(licence({ daysLeft: 31, seatsUsed: 99 }))).toEqual([]);
    expect(licenceWarnings({ plan: null, seats: null, seatsUsed: 500, validUntil: null, daysLeft: null })).toEqual([]);
  });

  it('say when it ends within 30 days, when it has ended, and when every seat is in use', () => {
    expect(licenceWarnings(licence({ daysLeft: 30 }))).toEqual(['ending']);
    expect(licenceWarnings(licence({ daysLeft: 0 }))).toEqual(['ending']);
    expect(licenceWarnings(licence({ daysLeft: -1 }))).toEqual(['ended']);
    expect(licenceWarnings(licence({ seatsUsed: 100 }))).toEqual(['full']);
    expect(licenceWarnings(licence({ seatsUsed: 120, daysLeft: -5 }))).toEqual(['ended', 'full']);
  });
});

describe("the founder's list", () => {
  it('is for the service role only', async () => {
    for (const who of [one.admin, one.teacherA, one.kid8a]) {
      await expect(pgliteTransport(db, who).rows('founder_schools')).rejects.toThrow(/permission denied/);
    }
  });

  it('lists every school with its licence, seats in use, students and teachers who have not left', async () => {
    // Students: Riya, Arjun, Kavya (in no class now) and last year's child; seats: Riya and Arjun.
    await admin.markLeft('LIC-T2');
    const rows = await founderList();
    expect(rows.map((r) => r.code)).toEqual(['LIC', 'OTH']);
    expect(rows[0]).toMatchObject({
      school_name: 'LIC Public School',
      plan: 'pilot',
      seats: 3,
      seats_used: 2,
      valid_until: addDays(today, 150),
      days_left: 150,
      students: 4,
      teachers: 1,
    });
    expect(rows[1]).toMatchObject({
      plan: null,
      seats: null,
      seats_used: 2,
      valid_until: null,
      days_left: null,
      students: 2,
      teachers: 2,
      last_active: null,
      days_since_active: null,
    });
  });

  it("gives each school's last activity: the latest attendance mark, hand-in, ledger event or work published", async () => {
    expect((await founderList())[0]).toMatchObject({ last_active: null, days_since_active: null });

    // A ledger event the server received three days ago.
    await db.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface)
       values (gen_random_uuid(), $1, $2, gen_random_uuid(), 0, now(), now() - interval '3 days', 'answered', 'practice', 'tap')`,
      [two.org, two.kid8a],
    );
    expect((await founderList())[1]).toMatchObject({ last_active: addDays(today, -3), days_since_active: 3 });

    // Attendance marked today.
    await teacherA.markAttendance(one.s8a, today, { [one.kid8a]: 'present' });
    expect((await founderList())[0]).toMatchObject({ last_active: today, days_since_active: 0 });
  });

  it('counts a hand-in and work published as activity too', async () => {
    const t2 = createLmsClient(pgliteTransport(db, two.teacherA));
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const hw = await t2.createAssignment({
      sectionId: two.s8a,
      subjectId: two.maths,
      kind: 'homework',
      title: 'Notebook page',
      dueAt: due,
      answerTypes: ['checklist'],
    });
    await t2.setAssignmentTasks(hw, ['Exercise 1']);
    await t2.publishAssignment(hw);
    expect((await founderList())[1]).toMatchObject({ last_active: today, days_since_active: 0 });

    // Back three days, then a hand-in brings it to today.
    await db.query(`update lms.assignment set published_at = now() - interval '3 days' where id = $1`, [hw]);
    expect((await founderList())[1]).toMatchObject({ days_since_active: 3 });
    await db.query(
      `insert into lms.submission (org_id, assignment_id, student_user_id, kind, attempt, late) values ($1, $2, $3, 'photo', 1, false)`,
      [two.org, hw, two.kid8a],
    );
    expect((await founderList())[1]).toMatchObject({ last_active: today, days_since_active: 0 });
  });
});

describe('the seats of the licence', () => {
  it('are never gone past by bringing a child back, or by moving one in who has no class this year', async () => {
    const used = async () => (await admin.schoolLicence()).seatsUsed;
    // Every seat in use: Riya, Arjun and Neel, of 3. Kavya is in no class this year.
    const neel = await seat(db, one.org, 'student', 'LIC-104', 'Neel');
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, '4')`,
      [one.org, one.year, one.s8a, neel],
    );
    expect(await used()).toBe(3);
    await expect(admin.moveStudent('LIC-103', one.s8b, '7')).rejects.toThrow(/all 3 seats of your licence are in use/);
    // A child already in a class of this year moves however full the school is.
    await admin.moveStudent('LIC-104', one.s8b, '4');
    expect(await used()).toBe(3);

    // Riya leaves and Kavya takes her seat: Riya cannot then be brought back.
    await admin.markLeft('LIC-101');
    await admin.moveStudent('LIC-103', one.s8b, '7');
    expect(await used()).toBe(3);
    await expect(admin.restoreAccount('LIC-101')).rejects.toThrow(/all 3 seats of your licence are in use/);
    expect((await admin.schoolLeft()).map((p) => p.loginId)).toContain('LIC-101');

    // With a seat more, she comes back.
    await setLicence('LIC', 'pilot', 4, addDays(today, 150));
    await admin.restoreAccount('LIC-101');
    expect(await used()).toBe(4);
  });

  it('are not limited for a school with no licence', async () => {
    await seat(db, two.org, 'student', 'OTH-109', 'Free');
    await otherAdmin.moveStudent('OTH-109', two.s8a, '9');
    expect((await otherAdmin.schoolLicence()).seatsUsed).toBe(3);
  });
});
