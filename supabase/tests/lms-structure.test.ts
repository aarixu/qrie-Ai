// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, SCHOOL_CREATED, seat, type School } from './fixtures';
import { asUser, createUser, freshDatabase } from './harness';

/**
 * L1 of the LMS build: the school's structure, in the `lms` schema (final
 * plan, decision 15), and who may see which part of it.
 *
 * Written first and watched failing before 0022 existed. The fixture is one
 * school with two sections and two subjects, each taught by a different
 * teacher, plus a second school that must stay invisible to the first.
 */

let db: PGlite;
let one: School;
let two: School;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'DPSONE');
  two = await buildSchool(db, 'DPSTWO');
});
afterAll(async () => {
  await db.close();
});

async function ids(user: string, sql: string): Promise<string[]> {
  const { rows } = await asUser(db, user, (tx) => tx.query<{ id: string }>(sql));
  return rows.map((r) => r.id).sort();
}

describe('what a teacher can see', () => {
  it('sees the sections they teach and no other', async () => {
    expect(await ids(one.teacherA, `select id from lms.section`)).toEqual([one.s8a]);
  });

  it("sees the roster of their own sections only", async () => {
    expect(await ids(one.teacherA, `select student_user_id as id from lms.enrolment`)).toEqual([one.kid8a]);
  });

  it('sees the names of their own students and no other child', async () => {
    const seen = await ids(one.teacherA, `select user_id as id from lms.account where kind = 'student'`);
    expect(seen).toEqual([one.kid8a]);
  });

  it('sees nothing at all of another school', async () => {
    const sections = await ids(one.teacherA, `select id from lms.section where org_id = '${two.org}'`);
    const roster = await ids(one.teacherA, `select id from lms.enrolment where org_id = '${two.org}'`);
    expect([...sections, ...roster]).toEqual([]);
  });

  it('teaches a student only in the subject they are assigned, in that section', async () => {
    const ask = (student: string, subject: string) =>
      asUser(db, one.teacherA, (tx) =>
        tx.query<{ ok: boolean }>(`select lms.i_teach($1, $2) as ok`, [student, subject]),
      ).then((r) => r.rows[0].ok);
    expect(await ask(one.kid8a, one.maths)).toBe(true);
    expect(await ask(one.kid8a, one.science)).toBe(false);
    expect(await ask(one.kid8b, one.maths)).toBe(false);
  });

  it('no longer lists a student who has left the section', async () => {
    const leaver = await seat(db, one.org, 'student', 'DPSONE-199', 'Leaver');
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, joined_on, left_on)
       values ($1, $2, $3, $4, '2026-04-01', '2026-06-30')`,
      [one.org, one.year, one.s8a, leaver],
    );
    const roster = await ids(one.teacherA, `select student_user_id as id from lms.enrolment`);
    expect(roster).not.toContain(leaver);
  });
});

describe('what a student can see', () => {
  it('sees their own section and no other', async () => {
    expect(await ids(one.kid8a, `select id from lms.section`)).toEqual([one.s8a]);
  });

  it("sees their own enrolment and nobody else's", async () => {
    expect(await ids(one.kid8a, `select student_user_id as id from lms.enrolment`)).toEqual([one.kid8a]);
  });

  it("sees their own account and no other child's", async () => {
    expect(await ids(one.kid8a, `select user_id as id from lms.account`)).toEqual([one.kid8a]);
  });

  it("reads their own school's name and branding, and not another school's", async () => {
    expect(await ids(one.kid8a, `select org_id as id from lms.school`)).toEqual([one.org]);
  });
});

describe('what an admin can see', () => {
  it('sees every section of their school, and none of another', async () => {
    expect(await ids(one.admin, `select id from lms.section`)).toEqual([one.s8a, one.s8b].sort());
  });
});

describe('what nobody outside a school can see', () => {
  it('shows a student with no school nothing of the lms schema', async () => {
    const outsider = await createUser(db);
    const seen = [
      ...(await ids(outsider, `select org_id as id from lms.school`)),
      ...(await ids(outsider, `select id from lms.section`)),
      ...(await ids(outsider, `select id from lms.enrolment`)),
    ];
    expect(seen).toEqual([]);
  });
});

describe('who can change the structure', () => {
  it('lets no one change it from a browser, not even a teacher', async () => {
    await expect(
      asUser(db, one.teacherA, (tx) =>
        tx.query(
          `insert into lms.section (org_id, academic_year_id, grade, name) values ($1, $2, 8, 'Z')`,
          [one.org, one.year],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
  });
});

describe('what the structure itself refuses', () => {
  it('refuses to join one school’s section to another school’s subject', async () => {
    await expect(
      db.query(
        `insert into lms.teaching_assignment (org_id, section_id, subject_id, teacher_user_id)
         values ($1, $2, $3, $4)`,
        [one.org, one.s8a, two.maths, one.teacherA],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('refuses a second active enrolment for a student in the same year', async () => {
    await expect(
      db.query(
        `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id) values ($1, $2, $3, $4)`,
        [one.org, one.year, one.s8b, one.kid8a],
      ),
    ).rejects.toThrow(/unique|duplicate/);
  });

  it('refuses a login id used twice in one school', async () => {
    const user = await createUser(db, { appMeta: SCHOOL_CREATED });
    await expect(
      db.query(
        `insert into lms.account (org_id, user_id, login_id, kind, display_name) values ($1, $2, 'DPSONE-101', 'student', 'Dup')`,
        [one.org, user],
      ),
    ).rejects.toThrow(/unique|duplicate/);
  });

  it('refuses a school row for an org that is not a school', async () => {
    const solo = await createUser(db);
    const { rows } = await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [solo]);
    await expect(
      db.query(`insert into lms.school (org_id, code, display_name, board) values ($1, 'SOLOX', 'x', 'CBSE')`, [
        rows[0].org_id,
      ]),
    ).rejects.toThrow(/not a school/);
  });
});
