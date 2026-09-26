// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { applyPlan, loginEmail } from '../src/apply.ts';
import { planImport, type SchoolConfig } from '../src/plan.ts';
import { readStudents, readTeachers } from '../src/sheet.ts';
import { pgliteStore } from '../src/pgliteStore.ts';

const SCHOOL: SchoolConfig = {
  code: 'DPS',
  displayName: 'Delhi Public School',
  board: 'CBSE',
  year: { label: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31' },
};
const STUDENTS = 'grade,section,roll,name,admission_no\n8,A,1,Riya,SR001\n8,A,2,Arjun,SR002\n8,B,1,Meera,SR003\n';
const TEACHERS = 'name,teaches,role,staff_id\nMrs Gupta,8A Mathematics,teacher,E1\nMr Rao,8B Science,teacher,E2\nPrincipal,,admin,E0\n';

const plan = () => planImport(SCHOOL, readStudents(STUDENTS).students, readTeachers(TEACHERS).teachers);

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

const count = async (sql: string): Promise<number> =>
  (await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0].n;

describe('applyPlan', () => {
  let first: Awaited<ReturnType<typeof applyPlan>>;

  it('creates the school, its sections, subjects, people, teaching and enrolments', async () => {
    first = await applyPlan(plan(), pgliteStore(db));
    expect(await count('lms.school')).toBe(1);
    expect(await count('lms.section')).toBe(2);
    expect(await count('lms.subject')).toBe(2);
    expect(await count('lms.account')).toBe(6);
    expect(await count('lms.teaching_assignment')).toBe(2);
    expect(await count('lms.enrolment where left_on is null')).toBe(3);
  });

  it('hands every new account a PIN of the right length, once', () => {
    expect(first.created).toHaveLength(6);
    for (const c of first.created) expect(c.pin).toMatch(c.kind === 'student' ? /^\d{6}$/ : /^\d{8}$/);
    expect(first.existing).toEqual([]);
  });

  it('gives school-created accounts no private solo org (0021)', async () => {
    expect(await count(`public.organization where kind = 'solo'`)).toBe(0);
  });

  it('never stores a PIN anywhere in the database', async () => {
    const pins = first.created.map((c) => c.pin);
    const { rows } = await db.query<{ blob: string }>(
      `select (select string_agg(t::text, ' ') from lms.account t) ||
              (select string_agg(u.raw_app_meta_data::text || coalesce(u.email, ''), ' ') from auth.users u) as blob`,
    );
    for (const pin of pins) expect(rows[0].blob).not.toContain(pin);
  });

  it('creates nothing and hands out no PIN when the same sheets are imported again', async () => {
    const again = await applyPlan(plan(), pgliteStore(db));
    expect(again.created).toEqual([]);
    expect(again.existing).toHaveLength(6);
    expect(await count('lms.account')).toBe(6);
    expect(await count('lms.enrolment')).toBe(3);
    expect(await count('lms.teaching_assignment')).toBe(2);
  });

  it('seats each teacher so they see exactly their own section’s children', async () => {
    const gupta = first.created.find((c) => c.loginId === 'DPS-E1')!.userId;
    const { rows } = await asUser(db, gupta, (tx) =>
      tx.query<{ name: string }>(`select display_name as name from lms.account where kind = 'student' order by 1`),
    );
    expect(rows.map((r) => r.name)).toEqual(['Arjun', 'Riya']);
  });

  it('reports, and does not silently move, a student already in another section this year', async () => {
    const moved = 'grade,section,roll,name,admission_no\n8,B,9,Riya,SR001\n';
    const result = await applyPlan(
      planImport(SCHOOL, readStudents(moved).students, readTeachers('name,teaches\n').teachers),
      pgliteStore(db),
    );
    expect(result.conflicts).toEqual(['DPS-SR001 (Riya) is already in 8A this year; the sheet says 8B. Not moved.']);
    expect(await count(`lms.enrolment where left_on is null`)).toBe(3);
  });
});

describe('loginEmail', () => {
  it('is an address on a reserved domain that can never receive mail', () => {
    expect(loginEmail('DPS-SR001')).toBe('dps-sr001@login.qrie.invalid');
  });
});
