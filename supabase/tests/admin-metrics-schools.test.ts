// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { addStudents, ageStudents, handIn, publish, setLicence } from './admin-school-fixtures.ts';
import { rpc } from './billing-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { freshDatabase } from './harness.ts';
import { addSignInColumn, atIst, compute, istDay, metricOf, nightly, series } from './metrics-fixtures.ts';

/**
 * SCHOOLS OVER TIME AND SIGN-INS PER SCHOOL (0073). Written first.
 *
 * The nightly run keeps each school's health level, students, seats and
 * activation as snapshots; homework published, any activity and hand-ins in
 * 7 days are worked out again by a recompute. Figures about a school's
 * children are hidden for a school with fewer than 10 students. Sign-ins are
 * counted only where auth.users has a sign-in time, and read not captured
 * where it has none.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let big: School;
let sml: School;
let bigKids: string[];
const day = (n: number) => istDay(db, n);

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  big = await buildSchool(db, 'BIG');
  // 8A first: the homework below is set for 8A.
  bigKids = [big.kid8a, ...(await addStudents(db, big, 'BIG', 10)), big.kid8b];
  await ageStudents(db, big.org, 30);
  sml = await buildSchool(db, 'SML');
  await setLicence(db, 'BIG', 20, 60);
});
afterAll(async () => {
  await db.close();
});

/** Rows of one metric on one day, by school code: {code: {dim, value}[]}. */
async function bySchool(metric: string, d: string): Promise<Record<string, { dim: string; value: number; children: number | null }[]>> {
  const { rows } = await db.query<{ code: string; dim: string; value: string; children: number | null }>(
    `select s.code, m.dim, m.value, m.children from admin.metric_daily m join lms.school s on s.org_id = m.org_id
      where m.metric = $1 and m.day = $2::date order by s.code, m.dim`,
    [metric, d],
  );
  const out: Record<string, { dim: string; value: number; children: number | null }[]> = {};
  for (const r of rows) (out[r.code] ??= []).push({ dim: r.dim, value: Number(r.value), children: r.children });
  return out;
}

describe('schools over time', () => {
  it("the nightly run records each school's health level once", async () => {
    await nightly(db);
    const rows = await bySchool('school.health', await day(1));
    for (const s of [big, sml]) {
      const { rows: h } = await db.query<{ level: string }>(`select admin.school_health_for($1) ->> 'level' as level`, [s.org]);
      const code = s === big ? 'BIG' : 'SML';
      expect(rows[code], code).toEqual([{ dim: h[0].level, value: 1, children: null }]);
    }
  });

  it('students, seats used and seats bought are snapshots of the run', async () => {
    const y = await day(1);
    const { rows } = await db.query<{ n: number }>(`select lms.seats_used($1) as n`, [big.org]);
    expect((await bySchool('school.students', y)).BIG).toEqual([{ dim: '', value: 12, children: null }]);
    expect((await bySchool('school.seats_used', y)).BIG).toEqual([{ dim: '', value: rows[0].n, children: null }]);
    expect((await bySchool('school.seats_bought', y)).BIG).toEqual([{ dim: '', value: 20, children: null }]);
    expect((await bySchool('school.seats_bought', y)).SML).toBeUndefined();
  });

  it("activation and hand-ins follow the health card's definitions, and a school with fewer than 10 students reads suppressed", async () => {
    const hw = await publish(db, big, 3, 0);
    for (const kid of bigKids.slice(0, 6)) await handIn(db, big.org, hw, kid, 1);
    const smlHw = await publish(db, sml, 3, 0);
    await handIn(db, sml.org, smlHw, sml.kid8a, 1);
    await nightly(db);
    const y = await day(1);
    expect((await bySchool('school.activated', y)).BIG).toEqual([{ dim: '', value: 6, children: 12 }]);
    expect((await bySchool('school.handed_in_7d', y)).BIG).toEqual([{ dim: '', value: 6, children: 12 }]);
    expect((await bySchool('school.handed_in_7d', y)).SML).toEqual([{ dim: '', value: 1, children: 2 }]);
    const s = await series(db, aal2(owner), 'schools', 7);
    for (const key of ['school.activated', 'school.handed_in_7d']) {
      const pts = metricOf(s, key).points.filter((p) => p.day === y);
      expect(pts.find((p) => p.school === 'BIG'), key).toMatchObject({ value: 6, suppressed: false });
      expect(pts.find((p) => p.school === 'SML'), key).toMatchObject({ value: null, suppressed: true });
    }
  });

  it('homework published and any activity are counted per school per day, and recomputed', async () => {
    await publish(db, big, 2);
    await compute(db, 2);
    const d2 = await day(2);
    expect((await bySchool('school.homework_published', d2)).BIG).toEqual([{ dim: '', value: 1, children: null }]);
    expect((await bySchool('school.active', d2)).BIG).toEqual([{ dim: '', value: 1, children: null }]);
    expect((await bySchool('school.active', d2)).SML).toEqual([{ dim: '', value: 0, children: null }]);
  });

  it('snapshots are not written by a recompute', async () => {
    const d3 = await day(3);
    await rpc(db, fresh(owner), 'metric_recompute', { p_from: d3, p_to: d3, p_reason: 'fill the past', p_env: 'TEST' });
    expect(await bySchool('school.health', d3)).toEqual({});
    expect((await bySchool('school.homework_published', d3)).BIG).toEqual([{ dim: '', value: 1, children: null }]);
  });

  it('sign-ins are not captured where the database has no sign-in time, and say why', async () => {
    const m = metricOf(await series(db, aal2(owner), 'schools', 7), 'school.signins');
    expect(m.captured).toBe(false);
    expect(m.why).toBe('This database does not record when people sign in (auth.users has no last_sign_in_at).');
    expect(m.points).toEqual([]);
    expect(await bySchool('school.signins', await day(1))).toEqual({});
  });

  it("with a sign-in time, the run counts each school's students whose last sign-in fell yesterday", async () => {
    await addSignInColumn(db);
    await db.query(`update auth.users set last_sign_in_at = ${atIst(1, '08:00')} where id = any($1::uuid[])`, [bigKids.slice(0, 11)]);
    await db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [bigKids[11]]);
    await db.query(`update auth.users set last_sign_in_at = ${atIst(1, '08:00')} where id = $1`, [sml.kid8a]);
    await nightly(db);
    const y = await day(1);
    expect((await bySchool('school.signins', y)).BIG).toEqual([{ dim: '', value: 11, children: 12 }]);
    expect((await bySchool('school.signins', y)).SML).toEqual([{ dim: '', value: 1, children: 2 }]);
    const m = metricOf(await series(db, aal2(owner), 'schools', 7), 'school.signins');
    expect(m.captured).toBe(true);
    expect(m.points.find((p) => p.school === 'BIG')).toMatchObject({ day: y, value: 11, suppressed: false });
    expect(m.points.find((p) => p.school === 'SML')).toMatchObject({ day: y, value: null, suppressed: true });
  });

  it('the one-school view reads only that school', async () => {
    const s = await series(db, aal2(owner), 'schools', 30, 'BIG');
    expect(s.school).toEqual({ code: 'BIG', name: 'BIG Public School' });
    const points = s.metrics.flatMap((m) => m.points);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) expect(p.school).toBe('BIG');
  });

  it('the Schools page is read by the owner and ops, not by safety', async () => {
    await expect(series(db, aal2(ops), 'schools', 7)).resolves.toMatchObject({ page: 'schools' });
    await expect(series(db, aal2(safety), 'schools', 7)).rejects.toThrow('not allowed');
  });
});
