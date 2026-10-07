// @vitest-environment node
import fs from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLmsClient, pgliteTransport, type LmsClient } from '../../../packages/lms-client/src/index.ts';
import { applyAfter, freshDatabase } from '../../../supabase/tests/harness.ts';
import { buildLoadSchool, type LoadSchool } from '../src/load-school.ts';

/**
 * A SCHOOL OF 1,500, TIMED (src/load-school.ts builds it). Skipped unless
 * LMS_LOAD=1, so the normal suite stays fast:
 *
 *   LMS_LOAD=1 npx vitest run tools/lms-demo/tests/load.test.ts
 *
 * Times, through the same client the apps use, the reads such a school
 * makes every day, each the median of three runs after one warm-up (or the
 * warm-up alone, if it took over ten seconds), and prints them (and appends them to the file LMS_LOAD_OUT names, if it is
 * set). With LMS_LOAD_FROM=<migration prefix> (e.g. 0041) the school
 * is built on the migrations up to that one and timed, then the later
 * migrations are applied to the same data and it is timed again, and every
 * answer is compared: a migration that only makes things faster must give
 * the same answers.
 */

const RUN = process.env.LMS_LOAD === '1';
const FROM = process.env.LMS_LOAD_FROM;
const OUT = process.env.LMS_LOAD_OUT;

interface Timing {
  name: string;
  ms: number;
  answer: unknown;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timed(name: string, call: () => Promise<unknown>): Promise<Timing> {
  const warm = performance.now();
  const answer = await call();
  const first = performance.now() - warm;
  // A read that takes more than ten seconds is timed by that one call.
  if (first > 10_000) return { name, ms: first, answer };
  const runs: number[] = [];
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    await call();
    runs.push(performance.now() - t0);
  }
  return { name, ms: median(runs), answer };
}

// The reads are made as the admin, a child of 7B, and the teacher of 7B
// Mathematics.
let db: PGlite;
let school: LoadSchool;
let admin: LmsClient;
let child: LmsClient;
let teacher: LmsClient;

async function readsOfADay(): Promise<Timing[]> {
  // What the student app's Home asks for.
  const home = async () => [
    await child.myAssignments(),
    await child.studentSubjects(school.child),
    await child.practiceChapters(),
    await child.upcomingEvents(30),
    await child.myNotices(),
  ];
  return [
    await timed('school_overview (admin)', () => admin.schoolOverview()),
    await timed('school_students (admin, whole school)', () => admin.schoolStudents()),
    await timed('school_students (admin, one section)', () => admin.schoolStudents(school.section7b)),
    await timed('school_classes (admin)', () => admin.schoolClasses()),
    await timed('school_teachers (admin)', () => admin.schoolTeachers()),
    await timed('student_card (admin)', () => admin.studentCard(school.child)),
    await timed('student_subjects (admin)', () => admin.studentSubjects(school.child)),
    await timed('student_timeline (admin)', () => admin.studentTimeline(school.child)),
    await timed('student_chapters (admin)', () => admin.studentChapters(school.child)),
    await timed('student_misconceptions (admin)', () => admin.studentMistakes(school.child)),
    await timed('student_subjects (teacher)', () => teacher.studentSubjects(school.child)),
    await timed('class_trend (teacher)', () => teacher.classTrend(school.section7b, school.maths)),
    await timed('my_assignments (child)', () => child.myAssignments()),
    await timed('student_subjects (child)', () => child.studentSubjects(school.child)),
    await timed('home: all five reads (child)', home),
  ];
}

// Answers compared with floats to nine places: an average summed in a
// different order may differ in its last bits.
function steady(x: unknown): unknown {
  if (typeof x === 'number') return Number.isInteger(x) ? x : Math.round(x * 1e9) / 1e9;
  if (Array.isArray(x)) return x.map(steady);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, steady(v)]));
  return x;
}

describe.skipIf(!RUN)('a school of 1,500', () => {
  let before: Timing[] | undefined;

  beforeAll(async () => {
    db = await freshDatabase(FROM ? { through: FROM } : {});
    school = await buildLoadSchool(db);
    admin = createLmsClient(pgliteTransport(db, school.admin));
    child = createLmsClient(pgliteTransport(db, school.child));
    teacher = createLmsClient(pgliteTransport(db, school.teacher));
    if (FROM) before = await readsOfADay();
  }, 3_600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('is the size it says', async () => {
    const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);
    expect(await count(`select count(*) as n from lms.enrolment where left_on is null`)).toBe(1500);
    expect(await count(`select count(*) as n from lms.account where kind = 'teacher'`)).toBe(60);
    expect(await count(`select count(*) as n from lms.assignment where published_at is not null`)).toBe(2055);
    expect(await count(`select count(*) as n from lms.submission`)).toBeGreaterThan(40_000);
  });

  it('answers the reads of a day, and says how long each took', async () => {
    if (FROM) await applyAfter(db, FROM);
    const after = await readsOfADay();
    const rows = after.map((t, i) =>
      before
        ? `${t.name.padEnd(40)} ${before[i].ms.toFixed(0).padStart(9)} ms  ->  ${t.ms.toFixed(0).padStart(7)} ms`
        : `${t.name.padEnd(40)} ${t.ms.toFixed(0).padStart(7)} ms`,
    );
    const report = [before ? `Through ${FROM}, then every later migration:` : 'Every migration:', ...rows].join('\n');
    console.log(report);
    if (OUT) fs.appendFileSync(OUT, `${report}\n`);

    const answer = (name: string) => after.find((t) => t.name === name)!.answer as unknown[];
    expect(answer('school_students (admin, whole school)')).toHaveLength(1500);
    expect(answer('school_students (admin, one section)')).toHaveLength(30);
    expect(answer('school_classes (admin)')).toHaveLength(250);
    expect(answer('my_assignments (child)')).toHaveLength(40);
    expect(answer('class_trend (teacher)')).toHaveLength(8);
    if (before) for (const [i, t] of after.entries()) expect(steady(t.answer), t.name).toEqual(steady(before[i].answer));
  }, 3_600_000);
});
