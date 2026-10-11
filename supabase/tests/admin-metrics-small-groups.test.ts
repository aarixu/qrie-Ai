// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { addStudents } from './admin-school-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { freshDatabase } from './harness.ts';
import {
  answer,
  atIst,
  compute,
  istDay,
  metricOf,
  putMetric,
  series,
  sitting,
  soloOrg,
  type MetricJson,
} from './metrics-fixtures.ts';

/**
 * NO FIGURE, ALONE OR COMBINED, DESCRIBES FEWER THAN 10 CHILDREN (plan 6's fix
 * pass). Written first, as the attacks the reviewers ran.
 *
 * Each test reads what ops can read (both frames, the platform and each
 * school, and, through admin.metric_json, the views of other days), turns
 * every figure into the groups of children behind it (atoms), and asks
 * `smallRemainders` what subtraction can isolate: a shown figure minus any
 * shown figures inside it. A remainder about 1 to 9 children breaks the
 * small-group rule.
 */

interface Fig {
  label: string;
  /** The groups of children behind the figure; a group with no children is left out. */
  atoms: string[];
  shown: boolean;
}

/**
 * Every remainder that subtraction isolates with 1 to 9 children: for each
 * shown figure A, A itself and A minus each family of shown, pairwise
 * disjoint figures strictly inside it.
 */
function smallRemainders(figs: Fig[], children: Record<string, number>): string[] {
  const byKey = new Map<string, Fig>();
  for (const f of figs.filter((x) => x.shown)) byKey.set([...f.atoms].sort().join(','), f);
  const shown = [...byKey.values()];
  const group = (atoms: string[]) => atoms.reduce((n, a) => n + (children[a] ?? 0), 0);
  const out: string[] = [];
  for (const a of shown) {
    const inA = new Set(a.atoms);
    const inside = shown.filter((b) => b !== a && b.atoms.length < inA.size && b.atoms.every((x) => inA.has(x)));
    const families: Fig[][] = [[]];
    for (const b of inside) {
      for (const fam of families.slice()) {
        if (fam.every((c) => c.atoms.every((x) => !b.atoms.includes(x)))) families.push([...fam, b]);
      }
    }
    for (const fam of families) {
      const left = a.atoms.filter((x) => !fam.some((c) => c.atoms.includes(x)));
      const n = group(left);
      if (n >= 1 && n <= 9) out.push(`${a.label} minus [${fam.map((c) => c.label).join('; ')}] = ${n} children`);
    }
  }
  return out;
}

const DAY_MS = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const plus = (d: string, n: number) => new Date(ms(d) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = ms(from); t <= ms(to); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const shownPoint = (p: { value: number | null; suppressed: boolean }) => !p.suppressed && p.value !== null;
const shownTotal = (m: MetricJson) => m.total !== null && !m.total.suppressed && m.total.value !== null;

/**
 * A funnel figure's days: a total covers its window; a point covers the India
 * week (Monday to Sunday) that starts on its day. Days with no entrant are
 * left out, because the daily entries chart shows them as 0.
 */
function cohortFigures(m: MetricJson, view: string, entrants: Record<string, number>): Fig[] {
  const keep = (days: string[]) => days.filter((d) => (entrants[d] ?? 0) > 0);
  const figs: Fig[] = [];
  if (m.total) figs.push({ label: `${view} total`, atoms: keep(daysBetween(m.from, m.to)), shown: shownTotal(m) });
  for (const p of m.points) {
    figs.push({ label: `${view} week of ${p.day}`, atoms: keep(daysBetween(p.day, plus(p.day, 6))), shown: shownPoint(p) });
  }
  return figs;
}

/** The last day of the latest fixed 30-day learning block (blocks run back to back from 2026-01-01) on or before `day`. */
function blockEnd(day: string): string {
  const k = Math.round((ms(day) - ms('2026-01-01')) / DAY_MS);
  return plus(day, -((((k - 29) % 30) + 30) % 30));
}

const FUNNEL = ['funnel.cohort', 'funnel.verified', 'funnel.first_class', 'funnel.second_day'];

describe('the contest funnel', () => {
  let db: PGlite;
  let ops: Staff;
  beforeAll(async () => {
    db = await freshDatabase();
    await setEnvironment(db);
    await makeStaff(db, 'owner', 'Aarav');
    ops = await makeStaff(db, 'ops', 'Ops person');
  });
  afterAll(async () => {
    await db.close();
  });

  it("the 30-day view minus the 7-day view does not give one entrant's steps", async () => {
    const today = await istDay(db, 0);
    const yesterday = await istDay(db, 1);
    const sunday = plus(yesterday, -new Date(ms(yesterday)).getUTCDay());
    const ago = (d: string) => Math.round((ms(today) - ms(d)) / DAY_MS);
    const entrant = async (day: string) => {
      const user = await anonymousChild(db);
      await db.query(
        `insert into public.contest_signup (user_id, student_name, klass, city, created_at) values ($1, 'An entrant', 8, 'Pune', ${atIst(ago(day), '09:00')})`,
        [user],
      );
      return { user, org: await soloOrg(db, user) };
    };
    for (let n = 0; n < 12; n++) await entrant(sunday);
    const lone = await entrant(plus(sunday, -14));
    await db.query(
      `insert into public.consent_record (user_id, parent_name, parent_phone, source, otp_verified_at) values ($1, 'A parent', '+919800000000', 'contest', now())`,
      [lone.user],
    );
    await sitting(db, { org: lone.org, user: lone.user, source: 'class', receivedSql: atIst(ago(plus(sunday, -14)), '10:00') });
    await sitting(db, { org: lone.org, user: lone.user, source: 'doubt', receivedSql: atIst(ago(plus(sunday, -13)), '10:00') });
    await compute(db, ago(sunday));
    await compute(db, ago(plus(sunday, -14)));

    const entrants = { [sunday]: 12, [plus(sunday, -14)]: 1 };
    const s7 = await series(db, aal2(ops), 'funnel', 7);
    const s30 = await series(db, aal2(ops), 'funnel', 30);
    // The sweep is only worth something if the big week is in it.
    expect(shownTotal(metricOf(s7, 'funnel.cohort')) || metricOf(s7, 'funnel.cohort').points.some(shownPoint)).toBe(true);
    for (const key of FUNNEL) {
      const figs = [...cohortFigures(metricOf(s7, key), `${key} 7 days`, entrants), ...cohortFigures(metricOf(s30, key), `${key} 30 days`, entrants)];
      expect(smallRemainders(figs, entrants), key).toEqual([]);
    }
  });

  it("the views of two days in a row do not give the steps of the one entrant who arrived on the new day", async () => {
    // The reviewers' days: none on 1 September, two a day from 2 to 7
    // September (one verified each), one on 8 September (verified). The
    // console's view on day t + 1 is admin.metric_json over the 7 or 30 days
    // ending t, which this test calls for every t from 1 to 30 September.
    const other = await freshDatabase();
    try {
      const entrants: Record<string, number> = {};
      for (const d of daysBetween('2026-08-03', '2026-10-04')) {
        const n = d >= '2026-09-02' && d <= '2026-09-07' ? 2 : d === '2026-09-08' ? 1 : 0;
        entrants[d] = n;
        const verified = n > 0 ? 1 : 0;
        for (const [metric, value] of [
          ['funnel.cohort', n],
          ['funnel.verified', verified],
          ['funnel.first_class', 0],
          ['funnel.second_day', 0],
        ] as const) {
          await putMetric(other, { day: d, metric, value, children: n });
        }
      }
      for (const key of FUNNEL) {
        const figs: Fig[] = [];
        for (const t of daysBetween('2026-09-01', '2026-09-30')) {
          for (const days of [7, 30]) {
            const { rows } = await other.query<{ j: MetricJson }>(
              `select admin.metric_json(d, $2::date - $3::int + 1, $2::date, null::uuid, false) as j from admin.metric_def d where d.key = $1`,
              [key, t, days],
            );
            figs.push(...cohortFigures(rows[0].j, `${key} ${days} days to ${t}`, entrants));
          }
        }
        // The sweep is only worth something if some figure was shown.
        expect(figs.some((f) => f.shown && f.atoms.length > 0), key).toBe(true);
        expect(smallRemainders(figs, entrants), key).toEqual([]);
      }
    } finally {
      await other.close();
    }
  });
});

describe('the platform and each school', () => {
  let db: PGlite;
  let ops: Staff;
  let big: School;
  let sml: School;
  let bigKids: string[];
  let item: string;
  beforeAll(async () => {
    db = await freshDatabase();
    await setEnvironment(db);
    await makeStaff(db, 'owner', 'Aarav');
    ops = await makeStaff(db, 'ops', 'Ops person');
    big = await buildSchool(db, 'BIG');
    bigKids = [big.kid8a, big.kid8b, ...(await addStudents(db, big, 'BIG', 10))];
    sml = await buildSchool(db, 'SML');
    await db.query(
      `insert into lms.outcome (id, grade, subject, chapter, title, position) values
         ('o1', 8, 'Mathematics', 'Fractions', 'Adds fractions', 1),
         ('o2', 8, 'Mathematics', 'Fractions', 'Compares fractions', 2)`,
    );
    item = (
      await db.query<{ id: string }>(
        `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
         values ('lib-1', '{o1}', 8, 'Mathematics', 'mcq', 'What is 1/2 + 1/3?', '["5/6","2/5"]', 0, '["", "adds denominators"]') returning id`,
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await db.close();
  });

  const practise = (org: string, user: string, daysAgo: number, times = 1) =>
    Promise.all(
      Array.from({ length: times }, () => answer(db, { org, user, source: 'practice', receivedSql: atIst(daysAgo, '17:00') })),
    );

  /** Practice on one day as figures: the platform's point covers every group that practised; a school's covers that school. */
  async function practiceFigures(daysAgo: number, groups: string[]): Promise<Fig[]> {
    const d = await istDay(db, daysAgo);
    const at = (m: MetricJson, school: string | null) => m.points.find((p) => p.day === d && p.dim === '' && p.school === school);
    const figs: Fig[] = [];
    const platform = at(metricOf(await series(db, aal2(ops), 'learning', 7), 'learn.practice_answers'), null);
    if (platform) figs.push({ label: 'platform', atoms: groups, shown: shownPoint(platform) });
    for (const code of groups.filter((g) => g !== 'direct')) {
      const one = at(metricOf(await series(db, aal2(ops), 'learning', 7, code), 'learn.practice_answers'), code);
      if (one) figs.push({ label: code, atoms: [code], shown: shownPoint(one) });
    }
    return figs;
  }

  it("the platform's practice minus a school's does not give one direct child's practice", async () => {
    for (const kid of bigKids.slice(0, 10)) await practise(big.org, kid, 1);
    const child = await anonymousChild(db);
    await practise(await soloOrg(db, child), child, 1, 7);
    await compute(db, 1);
    const figs = await practiceFigures(1, ['BIG', 'direct']);
    expect(figs.find((f) => f.label === 'BIG')?.shown, 'the big school is shown').toBe(true);
    expect(smallRemainders(figs, { BIG: 10, direct: 1 })).toEqual([]);
  });

  it("the platform's practice minus a big school's does not give a small school's", async () => {
    for (const kid of bigKids.slice(0, 10)) await practise(big.org, kid, 2);
    await practise(sml.org, sml.kid8a, 2, 4);
    await compute(db, 2);
    const figs = await practiceFigures(2, ['BIG', 'SML']);
    expect(figs.find((f) => f.label === 'SML')?.shown).toBe(false);
    expect(smallRemainders(figs, { BIG: 10, SML: 1 })).toEqual([]);
  });

  it('the platform is still shown when what it adds to the shown schools is none, or 10 children or more', async () => {
    for (const kid of bigKids.slice(0, 10)) await practise(big.org, kid, 3);
    for (let n = 0; n < 10; n++) {
      const child = await anonymousChild(db);
      await practise(await soloOrg(db, child), child, 3);
    }
    for (const kid of bigKids.slice(0, 10)) await practise(big.org, kid, 4, 2);
    await compute(db, 3);
    await compute(db, 4);
    const s = metricOf(await series(db, aal2(ops), 'learning', 7), 'learn.practice_answers');
    const d3 = await istDay(db, 3);
    const d4 = await istDay(db, 4);
    expect(s.points.find((p) => p.day === d3 && p.school === null), 'ten at a school and ten on their own').toMatchObject({
      value: 20,
      suppressed: false,
    });
    expect(s.points.find((p) => p.day === d4 && p.school === null), 'all ten at one shown school').toMatchObject({
      value: 20,
      suppressed: false,
    });
  });

  it("outcomes answered at the platform minus a school's do not tell what one direct child answered", async () => {
    const today = await istDay(db, 0);
    const end = blockEnd(await istDay(db, 1));
    const ago = Math.round((ms(today) - ms(end)) / DAY_MS);
    for (const kid of bigKids.slice(0, 10)) await answer(db, { org: big.org, user: kid, receivedSql: atIst(ago, '11:00'), outcomes: ['o1'] });
    const child = await anonymousChild(db);
    await answer(db, { org: await soloOrg(db, child), user: child, receivedSql: atIst(ago, '11:00'), outcomes: ['o2'] });
    await compute(db, ago);
    const at = (m: MetricJson, school: string | null) => m.points.find((p) => p.day === end && p.dim === '8|Mathematics' && p.school === school);
    const platform = at(metricOf(await series(db, aal2(ops), 'learning', 30), 'learn.outcomes_covered_30d'), null);
    const one = at(metricOf(await series(db, aal2(ops), 'learning', 30, 'BIG'), 'learn.outcomes_covered_30d'), 'BIG');
    expect(one, "the big school's point").toMatchObject({ value: 1, suppressed: false });
    const figs: Fig[] = [
      { label: 'platform', atoms: ['BIG', 'direct'], shown: platform ? shownPoint(platform) : false },
      { label: 'BIG', atoms: ['BIG'], shown: one ? shownPoint(one) : false },
    ];
    expect(smallRemainders(figs, { BIG: 10, direct: 1 })).toEqual([]);
  });

  it("two 30-day windows a day apart do not give one day's misconception answers", async () => {
    // Ten children chose the misconception the day before yesterday; one of
    // them chose it three more times yesterday.
    const wrong = (user: string, daysAgo: number) =>
      answer(db, {
        org: big.org,
        user,
        source: 'practice',
        receivedSql: atIst(daysAgo, '19:00'),
        outcomes: ['o1'],
        payload: { correct: false, chosenIndex: 1, itemId: item, assistanceRung: 0 },
      });
    for (const kid of bigKids.slice(0, 10)) await wrong(kid, 2);
    for (let n = 0; n < 3; n++) await wrong(bigKids[0], 1);
    await compute(db, 2);
    await compute(db, 1);
    const d2 = await istDay(db, 2);
    const d1 = await istDay(db, 1);
    const data: Record<string, number> = { [d2]: 10, [d1]: 1 };
    const m = metricOf(await series(db, aal2(ops), 'learning', 30), 'learn.misconceptions_30d');
    const figs: Fig[] = m.points
      .filter((p) => p.dim === '8|Mathematics|adds denominators')
      .map((p) => ({
        label: `the 30 days ending ${p.day}`,
        atoms: daysBetween(plus(p.day, -29), p.day).filter((d) => (data[d] ?? 0) > 0),
        shown: shownPoint(p),
      }));
    expect(smallRemainders(figs, data)).toEqual([]);
  });
});

describe('the schools', () => {
  let db: PGlite;
  let ops: Staff;
  let top: School;
  let tin: School;
  beforeAll(async () => {
    db = await freshDatabase();
    await setEnvironment(db);
    await makeStaff(db, 'owner', 'Aarav');
    ops = await makeStaff(db, 'ops', 'Ops person');
    top = await buildSchool(db, 'TOP');
    tin = await buildSchool(db, 'TIN');
  });
  afterAll(async () => {
    await db.close();
  });

  it("the all-schools total of a school's children minus the shown schools does not give a hidden school's figure", async () => {
    const y = await istDay(db, 1);
    for (const metric of ['school.activated', 'school.handed_in_7d']) {
      await putMetric(db, { day: y, metric, org: top.org, value: 6, children: 12 });
      await putMetric(db, { day: y, metric, org: tin.org, value: 1, children: 2 });
    }
    const s = await series(db, aal2(ops), 'schools', 7);
    for (const key of ['school.activated', 'school.handed_in_7d']) {
      const m = metricOf(s, key);
      const point = (code: string) => m.points.find((p) => p.school === code && p.day === y);
      const figs: Fig[] = [
        { label: 'TOP', atoms: ['TOP'], shown: shownPoint(point('TOP')!) },
        { label: 'TIN', atoms: ['TIN'], shown: shownPoint(point('TIN')!) },
      ];
      if (m.total) figs.push({ label: 'total', atoms: ['TOP', 'TIN'], shown: shownTotal(m) });
      expect(figs[0].shown, `${key}: the big school is shown`).toBe(true);
      expect(smallRemainders(figs, { TOP: 12, TIN: 2 }), key).toEqual([]);
    }
  });
});
