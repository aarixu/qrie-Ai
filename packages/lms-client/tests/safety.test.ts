// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { asUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport, type LmsClient } from '../src/index.ts';

/**
 * WHO STOPS SEEING WHAT (migration 0034). Written first.
 *
 *   - A student who leaves, or a teacher who leaves, stops seeing the
 *     school's children at once; the admin can undo it.
 *   - The admin moves classes between teachers; the old teacher stops seeing
 *     the class.
 *   - Last year's classes give a teacher nothing this year.
 *   - Homework, test and practice evidence is written by the school's own
 *     functions only; a phone cannot add its own.
 *   - Every one of these is in the school's activity log.
 */

let db: PGlite;
let one: School;
let admin: LmsClient;
let teacherA: LmsClient;
let teacherB: LmsClient;
let riya: LmsClient;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'SAF');
  admin = createLmsClient(pgliteTransport(db, one.admin));
  teacherA = createLmsClient(pgliteTransport(db, one.teacherA));
  teacherB = createLmsClient(pgliteTransport(db, one.teacherB));
  riya = createLmsClient(pgliteTransport(db, one.kid8a));
  const hw = await teacherA.createAssignment({
    sectionId: one.s8a,
    subjectId: one.maths,
    kind: 'homework',
    title: 'Before she left',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    answerTypes: ['checklist'],
  });
  await teacherA.setAssignmentTasks(hw, ['Exercise 1']);
  await teacherA.publishAssignment(hw);
});
afterAll(async () => {
  await db.close();
});

describe('a student who leaves', () => {
  it('drops out of every teacher’s sight and out of the school lists, and sees no work', async () => {
    expect(await teacherA.studentCard(one.kid8a)).not.toBeNull();
    await admin.markLeft('SAF-101');
    await expect(teacherA.studentCard(one.kid8a)).rejects.toThrow(/not yours to see/);
    expect((await admin.schoolStudents()).map((s) => s.displayName)).toEqual(['Arjun']);
    expect((await admin.schoolOverview())?.students).toBe(1);
    expect(await riya.myAssignments()).toEqual([]);
    // The admin keeps the record.
    expect((await admin.studentCard(one.kid8a))?.displayName).toBe('Riya');
  });

  it("is on the admin's list of people who have left, until restored", async () => {
    expect((await admin.schoolLeft()).map((p) => [p.loginId, p.kind])).toEqual([['SAF-101', 'student']]);
    await expect(teacherA.schoolLeft()).rejects.toThrow(/only the school admin/);
  });

  it('comes back when the admin undoes it', async () => {
    await admin.restoreAccount('SAF-101');
    expect(await admin.schoolLeft()).toEqual([]);
    expect((await teacherA.studentCard(one.kid8a))?.className).toBe('8A');
    expect((await riya.myAssignments()).map((a) => a.title)).toEqual(['Before she left']);
  });
});

describe('a teacher who leaves', () => {
  it('loses every class and every child at once, and leaves the staff list', async () => {
    await admin.markLeft('SAF-T1');
    expect(await teacherA.myClasses()).toEqual([]);
    await expect(teacherA.studentCard(one.kid8a)).rejects.toThrow(/not yours to see/);
    expect((await admin.schoolTeachers()).map((t) => t.displayName)).not.toContain('Teacher A');
    // No longer staff anywhere: cannot write the school's questions either.
    await expect(
      teacherA.writeItem({ grade: 8, subject: 'Mathematics', stem: 'After leaving', options: ['a', 'b'], correctIndex: 0 }),
    ).rejects.toThrow();
    await admin.restoreAccount('SAF-T1');
    await admin.setTeaching(one.s8a, one.maths, 'SAF-T1', true);
    expect((await teacherA.myClasses()).map((c) => c.subjectName)).toEqual(['Mathematics']);
  });

  it('is never the admin themselves, and is the admin’s to decide', async () => {
    await expect(admin.markLeft('SAF-A1')).rejects.toThrow(/yourself/);
    await expect(teacherA.markLeft('SAF-101')).rejects.toThrow(/only the school admin/);
    await expect(admin.markLeft('NOPE-1')).rejects.toThrow(/no one in your school/);
  });
});

describe('classes moving between teachers', () => {
  it('gives a class to another teacher and takes it away again', async () => {
    await admin.setTeaching(one.s8a, one.maths, 'SAF-T2', true);
    expect((await teacherB.myClasses()).map((c) => `${c.grade}${c.sectionName} ${c.subjectName}`).sort()).toEqual([
      '8A Mathematics',
      '8B Science',
    ]);
    expect((await teacherB.studentCard(one.kid8a))?.displayName).toBe('Riya');
    await admin.setTeaching(one.s8a, one.maths, 'SAF-T2', false);
    await expect(teacherB.studentCard(one.kid8a)).rejects.toThrow(/not yours to see/);
  });

  it("names each class's teacher by school ID too, so the portal can change them", async () => {
    const maths8a = (await admin.schoolClasses()).find((c) => c.className === '8A' && c.subjectName === 'Mathematics');
    expect(maths8a).toMatchObject({ teacherName: 'Teacher A', teacherLoginId: 'SAF-T1' });
  });

  it('only to a teacher of this school, by the admin', async () => {
    await expect(admin.setTeaching(one.s8a, one.maths, 'SAF-101', true)).rejects.toThrow(/not a teacher/);
    await expect(teacherA.setTeaching(one.s8a, one.maths, 'SAF-T2', true)).rejects.toThrow(/only the school admin/);
  });
});

describe('last year', () => {
  it('gives a teacher no sight of a child they taught only in an earlier year', async () => {
    const q = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]?.id;
    const old = await q(
      `insert into lms.academic_year (org_id, label, starts_on, ends_on) values ($1, '2025-26', '2025-04-01', '2026-03-31') returning id`,
      [one.org],
    );
    const s7b = await q(`insert into lms.section (org_id, academic_year_id, grade, name) values ($1, $2, 7, 'B') returning id`, [
      one.org,
      old,
    ]);
    await db.query(`insert into lms.teaching_assignment (org_id, section_id, subject_id, teacher_user_id) values ($1, $2, $3, $4)`, [
      one.org,
      s7b,
      one.science,
      one.teacherB,
    ]);
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, '9')`,
      [one.org, old, s7b, one.kid8a],
    );
    await expect(teacherB.studentCard(one.kid8a)).rejects.toThrow(/not yours to see/);
    expect((await teacherB.myClasses()).map((c) => `${c.grade}${c.sectionName}`)).toEqual(['8B']);
  });
});

describe("the school's evidence", () => {
  const insert = (source: string) =>
    asUser(db, one.kid8a, async (tx) => {
      const session = crypto.randomUUID();
      await tx.query(
        `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, $4, now())`,
        [session, one.org, one.kid8a, source],
      );
      await tx.query(
        `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, payload)
         values ($1, $2, $3, $4, 1, now(), 'answered', $5, 'tap', '{"correct": true}'::jsonb)`,
        [crypto.randomUUID(), one.org, one.kid8a, session, source],
      );
    });

  it('cannot be written from a phone as homework, test or practice: neither a session nor an event', async () => {
    for (const source of ['homework', 'test', 'practice']) {
      await expect(insert(source)).rejects.toThrow(/row-level security/);
      // An event of that source, even into a session the school's own functions opened.
      const session = crypto.randomUUID();
      await db.query(
        `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, $4, now())`,
        [session, one.org, one.kid8a, source],
      );
      await expect(
        asUser(db, one.kid8a, (tx) =>
          tx.query(
            `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, payload)
             values ($1, $2, $3, $4, 1, now(), 'answered', $5, 'tap', '{"correct": true}'::jsonb)`,
            [crypto.randomUUID(), one.org, one.kid8a, session, source],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
      // And a session alone.
      await expect(
        asUser(db, one.kid8a, (tx) =>
          tx.query(
            `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, $4, now())`,
            [crypto.randomUUID(), one.org, one.kid8a, source],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    }
  });

  it("still takes the tutor's own evidence", async () => {
    await expect(insert('quiz')).resolves.toBeUndefined();
  });
});

describe("the school's activity log", () => {
  it('lists who left, who came back and which classes moved, newest first, for the admin only', async () => {
    const log = await admin.auditLog();
    const seen = log.map((e) => `${e.action} ${e.target}`);
    expect(seen).toContain('left SAF-101');
    expect(seen).toContain('restored SAF-101');
    expect(seen).toContain('teaching-added SAF-T2 8A Mathematics');
    expect(seen).toContain('teaching-removed SAF-T2 8A Mathematics');
    expect(log[0]!.actorName).toBe('Admin');
    expect(new Date(log[0]!.at).getTime()).toBeGreaterThanOrEqual(new Date(log[log.length - 1]!.at).getTime());
    await expect(teacherA.auditLog()).rejects.toThrow(/only the school admin/);
  });
});
