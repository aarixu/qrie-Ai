import type { PGlite } from '@electric-sql/pglite';
import { createSchool, createUser, enrol } from './harness';

/**
 * One school as the LMS tests need it: a year, sections 8A and 8B, Maths and
 * Science, a teacher for each (8A Maths, 8B Science), an admin, and one child
 * in each section. Written with the service role's powers, as the import does.
 */

export const SCHOOL_CREATED = { provisioned_by: 'school' };

export interface School {
  org: string;
  year: string;
  s8a: string;
  s8b: string;
  maths: string;
  science: string;
  teacherA: string; // teaches 8A Maths
  teacherB: string; // teaches 8B Science
  admin: string;
  kid8a: string;
  kid8b: string;
}

export async function seat(
  db: PGlite,
  org: string,
  role: 'student' | 'teacher' | 'admin',
  loginId: string,
  name: string,
): Promise<string> {
  const user = await createUser(db, { appMeta: SCHOOL_CREATED });
  await enrol(db, org, user, role);
  await db.query(
    `insert into lms.account (org_id, user_id, login_id, kind, display_name) values ($1, $2, $3, $4, $5)`,
    [org, user, loginId, role, name],
  );
  return user;
}

export async function buildSchool(db: PGlite, code: string): Promise<School> {
  const org = await createSchool(db, `${code} School`);
  await db.query(`insert into lms.school (org_id, code, display_name, board) values ($1, $2, $3, 'CBSE')`, [
    org,
    code,
    `${code} Public School`,
  ]);
  const id = async (sql: string, params: unknown[]): Promise<string> =>
    (await db.query<{ id: string }>(sql, params)).rows[0].id;
  const year = await id(
    `insert into lms.academic_year (org_id, label, starts_on, ends_on)
     values ($1, '2026-27', '2026-04-01', '2027-03-31') returning id`,
    [org],
  );
  const s8a = await id(
    `insert into lms.section (org_id, academic_year_id, grade, name) values ($1, $2, 8, 'A') returning id`,
    [org, year],
  );
  const s8b = await id(
    `insert into lms.section (org_id, academic_year_id, grade, name) values ($1, $2, 8, 'B') returning id`,
    [org, year],
  );
  const maths = await id(`insert into lms.subject (org_id, name) values ($1, 'Mathematics') returning id`, [org]);
  const science = await id(`insert into lms.subject (org_id, name) values ($1, 'Science') returning id`, [org]);
  const teacherA = await seat(db, org, 'teacher', `${code}-T1`, 'Teacher A');
  const teacherB = await seat(db, org, 'teacher', `${code}-T2`, 'Teacher B');
  const admin = await seat(db, org, 'admin', `${code}-A1`, 'Admin');
  const kid8a = await seat(db, org, 'student', `${code}-101`, 'Riya');
  const kid8b = await seat(db, org, 'student', `${code}-102`, 'Arjun');
  await db.query(
    `insert into lms.teaching_assignment (org_id, section_id, subject_id, teacher_user_id) values
       ($1, $2, $3, $4), ($1, $5, $6, $7)`,
    [org, s8a, maths, teacherA, s8b, science, teacherB],
  );
  await db.query(
    `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values
       ($1, $2, $3, $4, '1'), ($1, $2, $5, $6, '2')`,
    [org, year, s8a, kid8a, s8b, kid8b],
  );
  return { org, year, s8a, s8b, maths, science, teacherA, teacherB, admin, kid8a, kid8b };
}
