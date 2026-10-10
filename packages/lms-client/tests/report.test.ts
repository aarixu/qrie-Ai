// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, seat, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { aal2, makeStaff } from '../../../supabase/tests/admin-fixtures.ts';
import { healthOf, signalOf } from '../../../supabase/tests/admin-school-fixtures.ts';
import { createLmsClient, pgliteTransport, type ProblemReport } from '../src/index.ts';

/**
 * A STUDENT'S REPORT FROM THE STUDENT APP (migration 0067, lms.report_problem).
 * Written first.
 *
 * The student app's Help sheet files a report into the same queue the tutor's
 * report button fills (public.student_report), through keep_student_report:
 * the place in the app travels in lesson_id as 'student-app/<place>', the
 * homework's id in beat_id, and a retry with the same `at` is the same report.
 * Students only; at most 10 a day; the note is at most 500 characters.
 */

const ITEM = '0b7e6a52-6d7e-4c55-9a8f-3c1f2e9d4a10';

let db: PGlite;
let school: School;

beforeAll(async () => {
  db = await freshDatabase();
  school = await buildSchool(db, 'REP');
});
afterAll(async () => {
  await db.close();
});

const as = (user: string) => createLmsClient(pgliteTransport(db, user));
let tick = 0;
const problem = (over: Partial<ProblemReport> = {}): ProblemReport => ({
  kind: 'wrong',
  note: 'the answer key says 7 but it is 8',
  where: 'homework',
  itemId: ITEM,
  platform: 'web',
  release: 'test-build',
  at: new Date(Date.UTC(2026, 9, 8, 5, 0, ++tick)).toISOString(),
  ...over,
});

describe('reportProblem', () => {
  it("a student's report reaches the queue with its place and homework, and a retry is the same report", async () => {
    const r = problem();
    const id = await as(school.kid8a).reportProblem(r);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const { rows } = await db.query<{ lesson_id: string; beat_id: string; org_id: string; kind: string; note: string; platform: string; status: string }>(
      `select lesson_id, beat_id, org_id, kind, note, platform, status from public.student_report where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      lesson_id: 'student-app/homework',
      beat_id: ITEM,
      org_id: school.org,
      kind: 'wrong',
      note: 'the answer key says 7 but it is 8',
      platform: 'web',
      status: 'new',
    });
    expect(await as(school.kid8a).reportProblem(r)).toBe(id);
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.student_report where user_id = $1`, [school.kid8a]);
    expect(n.rows[0].n).toBe(1);
  });

  it('a teacher, a parent and a student who has left cannot send one', async () => {
    const parent = await seat(db, school.org, 'parent', 'REP-P1', 'A parent');
    await db.query(`update lms.account set left_at = now() where user_id = $1`, [school.kid8b]);
    for (const who of [school.teacherA, parent, school.kid8b]) {
      await expect(as(who).reportProblem(problem())).rejects.toThrow(/only a student can send a report from here/);
    }
    await db.query(`update lms.account set left_at = null where user_id = $1`, [school.kid8b]);
  });

  it("the kind, the place, the platform and the note's length are checked", async () => {
    const kid = as(school.kid8a);
    await expect(kid.reportProblem(problem({ kind: 'scary' as never }))).rejects.toThrow(/a report is wrong, rude, unsafe or other/);
    await expect(kid.reportProblem(problem({ where: 'kitchen' as never }))).rejects.toThrow(/say where in the app this happened/);
    await expect(kid.reportProblem(problem({ platform: 'ios' as never }))).rejects.toThrow(
      /say whether this is the web app or the Android app/,
    );
    await expect(kid.reportProblem(problem({ note: 'x'.repeat(501) }))).rejects.toThrow(/a report is at most 500 characters/);
    // An empty note and no homework are fine.
    expect(await kid.reportProblem(problem({ note: '', where: 'home', itemId: null }))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('the eleventh report of the day is refused with the helpline', async () => {
    const kid = as(school.kid8b);
    for (let i = 0; i < 10; i++) await kid.reportProblem(problem({ where: 'learn', itemId: null }));
    await expect(kid.reportProblem(problem())).rejects.toThrow(
      /You have sent 10 reports today\. Please tell a teacher, or call Childline on 1098 if you need help now\./,
    );
  });

  it('nobody signed out can call it', async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'lms.report_problem(text, text, text, uuid, text, text, timestamptz)', 'execute') as ok`,
    );
    expect(rows[0].ok).toBe(false);
    const signedIn = await db.query<{ ok: boolean }>(
      `select has_function_privilege('authenticated', 'lms.report_problem(text, text, text, uuid, text, text, timestamptz)', 'execute') as ok`,
    );
    expect(signedIn.rows[0].ok).toBe(true);
  });

  it("the health card's grey safety sentence no longer says the tutor is where the report button is", async () => {
    const owner = await makeStaff(db, 'owner', 'Aarav');
    await buildSchool(db, 'REPQ');
    expect(signalOf(await healthOf(db, aal2(owner), 'REPQ'), 'safety')).toMatchObject({
      level: 'grey',
      reason: 'No unread reports, and nobody at this school has used the tutor yet.',
    });
  });
});
