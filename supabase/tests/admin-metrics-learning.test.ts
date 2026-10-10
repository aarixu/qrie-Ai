// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { addStudents, publish } from './admin-school-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { freshDatabase } from './harness.ts';
import { answer, atIst, compute, figures, istDay, metricOf, nightly, series, sitting, soloOrg } from './metrics-fixtures.ts';

/**
 * LEARNING IN AGGREGATE AND THE CONTEST FUNNEL (0073). Written first.
 *
 * Outcomes answered in the 30 days ending each day, by class and subject;
 * misconceptions from wrong options of library questions only; practice
 * answers per day. Every one of them is a figure about children's learning,
 * hidden for fewer than 10 children. The funnel is cohorts by entry day,
 * returned only as window totals.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let lrn: School;
let kids: string[];
let i1: string;
let i2: string;
const day = (n: number) => istDay(db, n);

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  lrn = await buildSchool(db, 'LRN');
  kids = [lrn.kid8a, ...(await addStudents(db, lrn, 'LRN', 10)), lrn.kid8b];
  await db.query(
    `insert into lms.outcome (id, grade, subject, chapter, title, position) values
       ('o1', 8, 'Mathematics', 'Fractions', 'Adds fractions', 1),
       ('o2', 8, 'Mathematics', 'Fractions', 'Compares fractions', 2),
       ('o3', 8, 'Mathematics', 'Decimals', 'Reads decimals', 3),
       ('o4', 7, 'Science', 'Plants', 'Names the parts of a plant', 1)`,
  );
  i1 = (
    await db.query<{ id: string }>(
      `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
       values ('lib-1', '{o1}', 8, 'Mathematics', 'mcq', 'What is 1/2 + 1/3?', '["5/6","2/5","1/6","2/6"]', 0,
               '["", "adds denominators", "", ""]') returning id`,
    )
  ).rows[0].id;
  i2 = (
    await db.query<{ id: string }>(
      `insert into lms.item (org_id, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
       values ($1, '{o2}', 8, 'Mathematics', 'mcq', 'Which is larger?', '["1/2","1/3","1/4","1/5"]', 0,
               '["", "a teacher''s own label", "", ""]') returning id`,
      [lrn.org],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await db.close();
});

/** An entrant to the contest: a child who came on their own, who signed up at `createdSql`. */
async function entrant(createdSql: string): Promise<{ user: string; org: string }> {
  const user = await anonymousChild(db);
  await db.query(
    `insert into public.contest_signup (user_id, student_name, klass, city, created_at) values ($1, 'An entrant', 8, 'Pune', ${createdSql})`,
    [user],
  );
  return { user, org: await soloOrg(db, user) };
}

describe('learning in aggregate', () => {
  it('outcomes answered in 30 days, by class and subject, with the children who answered', async () => {
    for (const kid of kids.slice(0, 10)) {
      await answer(db, { org: lrn.org, user: kid, receivedSql: atIst(1), outcomes: ['o1'] });
    }
    await answer(db, { org: lrn.org, user: kids[10], receivedSql: atIst(1), outcomes: ['o2'] });
    await compute(db, 1);
    const y = await day(1);
    const { rows } = await db.query<{ org: string | null; dim: string; value: string; children: number }>(
      `select org_id as org, dim, value, children from admin.metric_daily
        where metric = 'learn.outcomes_covered_30d' and day = $1::date and dim = '8|Mathematics' order by org_id nulls first`,
      [y],
    );
    expect(rows.map((r) => [r.org, Number(r.value), r.children])).toEqual([
      [null, 2, 11],
      [lrn.org, 2, 11],
    ]);
    expect(await figures(db, 'learn.outcomes_total', y)).toEqual({ '7|Science': 1, '8|Mathematics': 3 });
  });

  it('nine children are suppressed and ten are shown, at the platform and in one school', async () => {
    for (const kid of kids.slice(0, 9)) {
      await answer(db, { org: lrn.org, user: kid, receivedSql: atIst(1), outcomes: ['o4'] });
    }
    await compute(db, 1);
    const y = await day(1);
    const science = async (school?: string) =>
      metricOf(await series(db, aal2(owner), 'learning', 7, school), 'learn.outcomes_covered_30d').points.find(
        (p) => p.day === y && p.dim === '7|Science',
      );
    expect(await science()).toMatchObject({ value: null, suppressed: true });
    expect(await science('LRN')).toMatchObject({ value: null, suppressed: true, school: 'LRN' });
    await answer(db, { org: lrn.org, user: kids[9], receivedSql: atIst(1), outcomes: ['o4'] });
    await compute(db, 1);
    expect(await science()).toMatchObject({ value: 1, suppressed: false });
    expect(await science('LRN')).toMatchObject({ value: 1, suppressed: false, school: 'LRN' });
  });

  it('misconceptions come from wrong options of library questions only', async () => {
    const hw = await publish(db, lrn, 2);
    for (const kid of kids.slice(0, 10)) {
      const sub = (
        await db.query<{ id: string }>(
          `insert into lms.submission (org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)
           values ($1, $2, $3, 'mcq', 1, ${atIst(1)}, false) returning id`,
          [lrn.org, hw, kid],
        )
      ).rows[0].id;
      await db.query(
        `insert into lms.submission_answer (submission_id, item_id, chosen_index, correct) values ($1, $2, 1, false), ($1, $3, 1, false)`,
        [sub, i1, i2],
      );
    }
    await compute(db, 1);
    const all = await figures(db, 'learn.misconceptions_30d', await day(1));
    expect(all).toEqual({ '8|Mathematics|adds denominators': 10 });
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from admin.metric_daily where dim like '%teacher%'`);
    expect(rows[0].n).toBe(0);
  });

  it('a practice answer counts on the day the server received it', async () => {
    for (const kid of kids.slice(0, 10)) {
      await answer(db, {
        org: lrn.org,
        user: kid,
        source: 'practice',
        receivedSql: atIst(1, '18:00'),
        outcomes: ['o1'],
        payload: { correct: true, chosenIndex: 0, itemId: i1, assistanceRung: 0 },
      });
    }
    await compute(db, 1);
    const y = await day(1);
    expect(await figures(db, 'learn.practice_answers', y)).toEqual({ '': 10 });
    expect(await figures(db, 'learn.practice_answers', y, lrn.org)).toEqual({ '': 10 });
  });
});

describe('the contest funnel', () => {
  it('contest entries by India day', async () => {
    for (let n = 0; n < 3; n++) await entrant(atIst(3, '12:00'));
    await compute(db, 3);
    expect(await figures(db, 'funnel.entries', await day(3))).toEqual({ '': 3 });
  });

  it('a cohort counts entrants who had a parent verified, a first class, and a second day', async () => {
    const people = [];
    for (let n = 0; n < 10; n++) people.push(await entrant(atIst(1, '09:00')));
    for (const p of people.slice(0, 4)) {
      await db.query(
        `insert into public.consent_record (user_id, parent_name, parent_phone, source, otp_verified_at) values ($1, 'A parent', '+919800000000', 'contest', now())`,
        [p.user],
      );
    }
    for (const p of people.slice(0, 3)) await sitting(db, { org: p.org, user: p.user, source: 'class', receivedSql: atIst(1, '10:00') });
    for (const p of people.slice(0, 2)) await sitting(db, { org: p.org, user: p.user, source: 'doubt', receivedSql: atIst(0, '00:30') });
    await compute(db, 1);
    const { rows } = await db.query<{ metric: string; value: string; children: number }>(
      `select metric, value, children from admin.metric_daily where day = $1::date and metric like 'funnel.%' and metric <> 'funnel.entries' order by metric`,
      [await day(1)],
    );
    expect(rows.map((r) => [r.metric, Number(r.value), r.children])).toEqual([
      ['funnel.cohort', 10, 10],
      ['funnel.first_class', 3, 10],
      ['funnel.second_day', 2, 10],
      ['funnel.verified', 4, 10],
    ]);
  });

  it('the funnel is read as totals only, and a total under 10 entrants is suppressed', async () => {
    const s = await series(db, aal2(ops), 'funnel', 7);
    for (const [key, value] of [
      ['funnel.cohort', 13],
      ['funnel.verified', 4],
      ['funnel.first_class', 3],
      ['funnel.second_day', 2],
    ] as const) {
      const m = metricOf(s, key);
      expect(m.points, key).toEqual([]);
      expect(m.total, key).toEqual({ value, suppressed: false });
    }
    expect(metricOf(s, 'funnel.entries').points.length).toBeGreaterThan(0);

    const other = await freshDatabase();
    try {
      const boss = await makeStaff(other, 'owner', 'Aarav');
      for (let n = 0; n < 4; n++) {
        const user = await anonymousChild(other);
        await other.query(
          `insert into public.contest_signup (user_id, student_name, klass, city, created_at) values ($1, 'An entrant', 8, 'Pune', ${atIst(1, '09:00')})`,
          [user],
        );
      }
      await other.query(`select admin.metric_compute(lms.india_today() - 1, false)`);
      const few = await series(other, aal2(boss), 'funnel', 7);
      expect(metricOf(few, 'funnel.cohort').total).toEqual({ value: null, suppressed: true });
      expect(metricOf(few, 'funnel.entries').points.find((p) => p.dim === '')).toMatchObject({ value: 4, suppressed: false });
    } finally {
      await other.close();
    }
  });

  it('the nightly run refreshes the last 30 cohorts', async () => {
    const late = await entrant(atIst(20, '09:00'));
    await compute(db, 20);
    const d20 = await day(20);
    expect(await figures(db, 'funnel.first_class', d20)).toEqual({ '': 0 });
    await sitting(db, { org: late.org, user: late.user, source: 'class', receivedSql: atIst(1, '11:00') });
    await nightly(db);
    expect(await figures(db, 'funnel.first_class', d20)).toEqual({ '': 1 });
  });
});
