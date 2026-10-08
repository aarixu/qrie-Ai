import type { PGlite } from '@electric-sql/pglite';
import type { JwtClaims } from './harness.ts';
import { asClaims, asService, createSchool } from './harness.ts';
import { seat, type School } from './fixtures.ts';

/**
 * Activity at a school, dated in the past, the way the LMS writes it, for the
 * health thresholds. Written as the database owner, as a migration would.
 */

export const ago = (days: number) => `now() - make_interval(days => ${Math.trunc(days)})`;

/** A school with a year and nothing else: no classes, no people. */
export async function bareSchool(db: PGlite, code: string): Promise<string> {
  const org = await createSchool(db, `${code} School`);
  await db.query(`insert into lms.school (org_id, code, display_name, board) values ($1, $2, $3, 'CBSE')`, [org, code, `${code} Public School`]);
  await db.query(
    `insert into lms.academic_year (org_id, label, starts_on, ends_on) values ($1, '2026-27', '2026-04-01', '2027-03-31')`,
    [org],
  );
  return org;
}

/**
 * n more students in 8A, with login IDs CODE-<first>, CODE-<first+1>, ... named
 * "Child <first-200+i>", rolls from <first-190> (so two calls with different
 * `first` never collide).
 */
export async function addStudents(db: PGlite, s: School, code: string, n: number, first = 200): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await seat(db, s.org, 'student', `${code}-${first + i}`, `Child ${first - 200 + i}`);
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, $5)`,
      [s.org, s.year, s.s8a, id, String(first - 190 + i)],
    );
    ids.push(id);
  }
  return ids;
}

/** Every student account of the school was created `days` ago. */
export async function ageStudents(db: PGlite, org: string, days: number): Promise<void> {
  await db.query(`update lms.account set created_at = ${ago(days)} where org_id = $1 and kind = 'student'`, [org]);
}

/** A homework in 8A Maths, published and due the given number of days ago (negative = in the future). */
export async function publish(db: PGlite, s: School, publishedDaysAgo: number, dueDaysAgo = publishedDaysAgo - 3): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into lms.assignment (org_id, section_id, subject_id, created_by, kind, title, due_at, answer_types, published_at)
     values ($1, $2, $3, $4, 'homework', 'Fractions', ${ago(dueDaysAgo)}, '{photo}', ${ago(publishedDaysAgo)}) returning id`,
    [s.org, s.s8a, s.maths, s.teacherA],
  );
  return rows[0].id;
}

export async function handIn(db: PGlite, org: string, assignment: string, student: string, daysAgo = 1): Promise<void> {
  await db.query(
    `insert into lms.submission (org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)
     values ($1, $2, $3, 'photo', 1, ${ago(daysAgo)}, false)`,
    [org, assignment, student],
  );
}

export async function markAttendance(db: PGlite, s: School, student: string, daysAgo: number): Promise<void> {
  await db.query(
    `insert into lms.attendance (student_user_id, on_date, org_id, section_id, status, marked_by, marked_at)
     values ($1, lms.india_today() - $2::int, $3, $4, 'present', $5, ${ago(daysAgo)})`,
    [student, daysAgo, s.org, s.s8a, s.teacherA],
  );
}

/** A tutor sitting at this school (the tutor has a report button; the student app has one too, plan 5). */
export async function tutorSession(db: PGlite, org: string, user: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'class', now())`,
    [id, org, user],
  );
  return id;
}

/** A ledger event received `daysAgo` days back (the column list of school-safe-tenancy.test.ts). */
export async function ledgerEvent(db: PGlite, org: string, user: string, daysAgo = 1): Promise<void> {
  const session = await tutorSession(db, org, user);
  await db.query(
    `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface)
     values ($1, $2, $3, $4, 0, ${ago(daysAgo)}, ${ago(daysAgo)}, 'answered', 'class', 'tap')`,
    [crypto.randomUUID(), org, user, session],
  );
}

/** A child's report; its org is filled by 0019's trigger. The note must never come back out. */
export async function fileReport(db: PGlite, user: string, kind: 'wrong' | 'unsafe' = 'wrong'): Promise<void> {
  await db.query(
    `insert into public.student_report (user_id, kind, note, lesson_id, at) values ($1, $2, 'a private note', 'L1', now())`,
    [user, kind],
  );
}

export async function setLicence(db: PGlite, code: string, seats: number, daysFromToday: number): Promise<void> {
  await asService(db, (tx) =>
    tx.query(`select lms.set_licence($1, 'pilot', $2, lms.india_today() + $3::int)`, [code, seats, daysFromToday]),
  );
}

export interface Signal { key: string; level: 'green' | 'amber' | 'red' | 'grey'; reason: string }
export interface Health { code: string; level: string; label: string; quietUntil: string | null; lastActiveOn: string | null; signals: Signal[] }

export const healthOf = (db: PGlite, claims: JwtClaims, code: string) =>
  asClaims(db, claims, async (tx) => (await tx.query<{ h: Health }>(`select admin.school_health($1) as h`, [code])).rows[0].h);

export const signalOf = (h: Health, key: string): Signal => {
  const s = h.signals.find((x) => x.key === key);
  if (!s) throw new Error(`no signal ${key}`);
  return s;
};
