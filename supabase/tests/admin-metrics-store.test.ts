// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { makeFinance } from './billing-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { freshDatabase } from './harness.ts';
import { istDay, metricDef, metricOf, putMetric, series } from './metrics-fixtures.ts';

/**
 * THE CHART STORE AND ITS ONE READ (0071). Written first.
 *
 * admin.metric_daily holds one whole number per India day, metric, school (or
 * the platform) and dimension, and the size of the group of children behind
 * it, which never leaves the database. admin.metric_series is the only read:
 * it checks the page's roles, hides a learning figure for fewer than 10
 * children, marks what this database cannot see as not captured, and gives
 * no point for a day nobody rolled up.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let child: string;
let cha: School;
const day = (n: number) => istDay(db, n);

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  finance = await makeFinance(db);
  child = await anonymousChild(db);
  cha = await buildSchool(db, 'CHA');
});
afterAll(async () => {
  await db.close();
});

const PAGES = ['overview', 'money', 'schools', 'learning', 'content', 'reliability', 'funnel', 'safety'];

describe('the chart store', () => {
  it('the store holds a day, a metric, a school, a dimension, a whole number and a group size, and nothing that names a person', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'admin' and table_name = 'metric_daily' order by column_name collate "C"`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(['children', 'computed_at', 'day', 'dim', 'id', 'metric', 'org_id', 'value']);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const t of ['admin.metric_def', 'admin.metric_daily', 'admin.metric_run', 'admin.metric_family']) {
        const { rows: p } = await db.query<{ ok: boolean }>(
          `select has_table_privilege($1, $2, 'select,insert,update,delete') as ok`,
          [role, t],
        );
        expect(p[0].ok, `${role} on ${t}`).toBe(false);
      }
    }
  });

  it('each page is read by the roles of ruling R9', async () => {
    for (const page of PAGES) {
      await expect(series(db, aal2(owner), page, 7)).resolves.toMatchObject({ page });
    }
    for (const page of PAGES.filter((p) => p !== 'safety')) {
      await expect(series(db, aal2(ops), page, 7)).resolves.toMatchObject({ page });
    }
    await expect(series(db, aal2(ops), 'safety', 7)).rejects.toThrow('not allowed');
    await expect(series(db, aal2(safety), 'safety', 7)).resolves.toMatchObject({ page: 'safety' });
    await expect(series(db, aal2(safety), 'overview', 7)).rejects.toThrow('not allowed');
    await expect(series(db, aal2(safety), 'money', 7)).rejects.toThrow('not allowed');
    await expect(series(db, aal2(finance), 'money', 7)).resolves.toMatchObject({ page: 'money' });
    await expect(series(db, aal2(finance), 'overview', 7)).rejects.toThrow('not allowed');
    await expect(series(db, { sub: child, aal: 'aal2', is_anonymous: true }, 'overview', 7)).rejects.toThrow('not allowed');
    await expect(series(db, aal2(owner, { aal: 'aal1' }), 'overview', 7)).rejects.toThrow('not allowed');
  });

  it('an unknown page, a day count other than 7 or 30, and a one-school view of a page without one are refused', async () => {
    await expect(series(db, aal2(owner), 'sales', 7)).rejects.toThrow('there is no chart page called sales');
    await expect(series(db, aal2(owner), 'overview', 14)).rejects.toThrow('days is 7 or 30');
    await expect(series(db, aal2(owner), 'overview', 7, 'CHA')).rejects.toThrow('this page has no view of one school');
    await expect(series(db, aal2(owner), 'schools', 7, 'NOPE')).rejects.toThrow('there is no school with the code NOPE');
  });

  it('a day with no roll-up has no point, and a computed zero is a point of 0', async () => {
    await metricDef(db, { key: 'test.count' });
    await putMetric(db, { day: await day(1), metric: 'test.count', value: 0 });
    await putMetric(db, { day: await day(3), metric: 'test.count', value: 4 });
    const s = await series(db, aal2(owner), 'overview', 7);
    expect(s.from).toBe(await day(7));
    expect(s.to).toBe(await day(1));
    const m = metricOf(s, 'test.count');
    expect(m.points).toEqual([
      { day: await day(3), dim: '', school: null, value: 4, suppressed: false },
      { day: await day(1), dim: '', school: null, value: 0, suppressed: false },
    ]);
    expect(m.total).toEqual({ value: 4, suppressed: false });
    expect(m.captured).toBe(true);
  });

  it('a child figure for fewer than 10 children is suppressed, at 10 it is shown, and the total follows the same rule', async () => {
    await metricDef(db, { key: 'test.kids', childFigure: true, total: 'sum' });
    await putMetric(db, { day: await day(2), metric: 'test.kids', value: 3, children: 9 });
    await putMetric(db, { day: await day(1), metric: 'test.kids', value: 5, children: 10 });
    const s = await series(db, aal2(owner), 'overview', 7);
    const m = metricOf(s, 'test.kids');
    expect(m.points.map((p) => ({ value: p.value, suppressed: p.suppressed }))).toEqual([
      { value: null, suppressed: true },
      { value: 5, suppressed: false },
    ]);
    expect(m.total).toEqual({ value: 8, suppressed: false });
    expect(JSON.stringify(s)).not.toContain('"children"');

    await metricDef(db, { key: 'test.few', childFigure: true, total: 'sum' });
    await putMetric(db, { day: await day(2), metric: 'test.few', value: 3, children: 9 });
    const few = metricOf(await series(db, aal2(owner), 'overview', 7), 'test.few');
    expect(few.total).toEqual({ value: null, suppressed: true });
  });

  it("a one-school view reads that school's rows; the platform view reads the platform's rows, or every school's for a school-only metric", async () => {
    await metricDef(db, { key: 'test.both', pages: ['learning'], scope: 'both' });
    await putMetric(db, { day: await day(1), metric: 'test.both', value: 7 });
    await putMetric(db, { day: await day(1), metric: 'test.both', org: cha.org, value: 2 });
    const all = metricOf(await series(db, aal2(owner), 'learning', 7), 'test.both');
    expect(all.points).toEqual([{ day: await day(1), dim: '', school: null, value: 7, suppressed: false }]);
    const one = await series(db, aal2(owner), 'learning', 7, 'CHA');
    expect(one.school).toEqual({ code: 'CHA', name: 'CHA Public School' });
    expect(metricOf(one, 'test.both').points).toEqual([{ day: await day(1), dim: '', school: 'CHA', value: 2, suppressed: false }]);

    const second = await buildSchool(db, 'CHB');
    await metricDef(db, { key: 'test.schoolonly', pages: ['learning'], scope: 'school' });
    await putMetric(db, { day: await day(1), metric: 'test.schoolonly', org: cha.org, value: 1 });
    await putMetric(db, { day: await day(1), metric: 'test.schoolonly', org: second.org, value: 6 });
    const each = metricOf(await series(db, aal2(owner), 'learning', 7), 'test.schoolonly');
    expect(each.points.map((p) => [p.school, p.value])).toEqual([
      ['CHA', 1],
      ['CHB', 6],
    ]);
  });

  it('what this database cannot see reads not captured, with its reason, never a zero', async () => {
    const s = await series(db, aal2(owner), 'reliability', 7);
    for (const key of ['relay.refusals', 'calls.latency', 'alarm.history']) {
      const m = metricOf(s, key);
      expect(m.captured, key).toBe(false);
      expect((m.why ?? '').length, key).toBeGreaterThanOrEqual(20);
      expect(m.points, key).toEqual([]);
      expect(m.total, key).toBeNull();
    }
  });

  it("a UTC metric's window ends a day earlier", async () => {
    await metricDef(db, { key: 'test.utc', dayKind: 'utc' });
    await putMetric(db, { day: await day(1), metric: 'test.utc', value: 11 });
    await putMetric(db, { day: await day(2), metric: 'test.utc', value: 12 });
    const s = await series(db, aal2(owner), 'overview', 7);
    const m = metricOf(s, 'test.utc');
    expect(m.from).toBe(await day(8));
    expect(m.to).toBe(await day(2));
    expect(m.points.map((p) => [p.day, p.value])).toEqual([[await day(2), 12]]);
  });

  it('a cohort metric is returned as a total only', async () => {
    await metricDef(db, { key: 'test.cohort', kind: 'cohort', childFigure: true, total: 'sum' });
    await putMetric(db, { day: await day(2), metric: 'test.cohort', value: 4, children: 6 });
    await putMetric(db, { day: await day(1), metric: 'test.cohort', value: 3, children: 5 });
    const m = metricOf(await series(db, aal2(owner), 'overview', 7), 'test.cohort');
    expect(m.points).toEqual([]);
    expect(m.total).toEqual({ value: 7, suppressed: false });
  });

  it('a hand-made change to the store leaves an unmanaged-change row', async () => {
    const { rows: before } = await db.query<{ n: number }>(
      `select count(*)::int as n from admin.audit_event where action = 'unmanaged-change' and target_kind like 'metric%'`,
    );
    expect(before[0].n, 'the migrations and the roll-ups write with the session on').toBe(0);
    await db.query(`insert into admin.metric_daily (day, metric, value) values ($1::date, 'test.count', 1)`, [await day(5)]);
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from admin.audit_event where action = 'unmanaged-change' and target_kind = 'metric_daily'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('the series says when the last roll-up finished', async () => {
    expect((await series(db, aal2(owner), 'overview', 7)).lastRun).toBeNull();
    await db.query(`insert into admin.metric_run (from_day, to_day, nightly) values ($1::date - 6, $1::date, true)`, [await day(1)]);
    const { lastRun } = await series(db, aal2(owner), 'overview', 7);
    expect(lastRun).toMatchObject({ through: await day(1), nightly: true });
    expect(Number.isNaN(Date.parse(lastRun!.finishedAt))).toBe(false);
  });
});
