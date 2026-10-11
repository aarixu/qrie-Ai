// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { atIst, istDay, nightly, price, sitting, usage } from '../../../supabase/tests/metrics-fixtures.ts';
import { classRow, report } from '../../../supabase/tests/safety-fixtures.ts';
import { AdminError, createChartsClient, pgliteAdminTransport, type AdminClaims } from '../src/index.ts';

/**
 * THE CHARTS CLIENT, END TO END (plan 6). Written first.
 *
 * Every call runs as the member of staff would reach PostgREST. Dates come
 * back as YYYY-MM-DD, numbers as numbers, a hidden figure as null; refusals
 * as AdminError.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let school: School;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const chartsAs = (claims: AdminClaims) => createChartsClient(pgliteAdminTransport(db, claims));
const codeOf = (p: Promise<unknown>) =>
  p.then(() => 'resolved', (e: unknown) => (e instanceof AdminError ? e.code : `untyped: ${String(e)}`));

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  school = await buildSchool(db, 'CHT');
  await price(db, 'gemini-x', 'prompt_token', 0.001);
  const s = await sitting(db, { org: school.org, user: school.kid8a, receivedSql: atIst(1), activeMs: 1800000, topic: 'sci/cht' });
  await usage(db, { user: school.kid8a, session: s, atSql: atIst(1), promptTokens: 3000, bucket: 'live' });
  await classRow(db, 'CHT-A', { topicRef: 'sci/cht' });
  await report(db, school.kid8b, { lessonId: 'CHT-A' });
  await nightly(db);
});
afterAll(async () => {
  await db.close();
});

describe('the charts client', () => {
  it('series comes back typed: dates as YYYY-MM-DD, numbers as numbers, suppressed points as null', async () => {
    const s = await chartsAs(aal2(owner)).series('overview', 7);
    expect(s.page).toBe('overview');
    expect(s.days).toBe(7);
    expect(s.from).toMatch(ISO_DAY);
    expect(s.to).toBe(await istDay(db, 1));
    expect(s.school).toBeNull();
    expect(s.lastRun).toMatchObject({ through: await istDay(db, 1), nightly: true });
    const spend = s.metrics.find((m) => m.key === 'cost.sitting_paise');
    expect(spend).toMatchObject({ unit: 'paise', dayKind: 'india', kind: 'daily', captured: true, why: null, total: { value: 300, suppressed: false } });
    const point = spend!.points.find((p) => p.day === s.to)!;
    expect(point).toEqual({ day: s.to, dim: '', school: null, value: 300, suppressed: false });
    for (const m of s.metrics) {
      expect(m.from, m.key).toMatch(ISO_DAY);
      for (const p of m.points) {
        expect(p.day, m.key).toMatch(ISO_DAY);
        expect(p.value === null || typeof p.value === 'number', m.key).toBe(true);
      }
    }
    const units = s.metrics.find((m) => m.key === 'relay.units')!;
    expect(units.dayKind).toBe('utc');
    expect(units.to).toBe(await istDay(db, 2));

    const schools = await chartsAs(aal2(owner)).series('schools', 7, 'CHT');
    expect(schools.school).toEqual({ code: 'CHT', name: 'CHT Public School' });
    const activated = schools.metrics.find((m) => m.key === 'school.activated')!;
    expect(activated.points).toEqual([{ day: schools.to, dim: '', school: 'CHT', value: null, suppressed: true }]);
    const signins = schools.metrics.find((m) => m.key === 'school.signins')!;
    expect(signins).toMatchObject({ captured: false, capturedSince: null, total: null, points: [] });
    expect(signins.why).toMatch(/sign in/);
  });

  it('a refusal is a typed AdminError: ops reading Safety is not-allowed; a stale owner recomputing is needs-mfa', async () => {
    expect(await codeOf(chartsAs(aal2(ops)).series('safety', 7))).toBe('not-allowed');
    const y = await istDay(db, 1);
    expect(await codeOf(chartsAs(aal2(owner)).recompute({ from: y, to: y, reason: 'prices loaded', env: 'TEST' }))).toBe('needs-mfa');
    expect(await codeOf(chartsAs(fresh(owner)).recompute({ from: y, to: y, reason: 'prices loaded', env: 'HOSTED' }))).toBe(
      'wrong-environment',
    );
    expect(await codeOf(chartsAs(aal2(owner)).series('overview', 30, 'CHT'))).toBe('other');
  });

  it('money and content views come back typed', async () => {
    const money = await chartsAs(aal2(ops)).money(30);
    expect(money.days).toBe(30);
    expect(money.from).toMatch(ISO_DAY);
    expect(money.to).toMatch(ISO_DAY);
    expect(money.directCostPaise).toBe(0);
    expect(money.margin).toEqual([
      { code: 'CHT', name: 'CHT Public School', feePaise: 0, costPaise: 300, costIsFloor: false, marginPaise: -300, noFee: true, daysRolledUp: 7 },
    ]);
    expect(money.renewals).toHaveLength(13);
    expect(money.renewals[0].weekStart).toMatch(ISO_DAY);
    expect(typeof money.renewals[0].paiseAtCurrentPrice).toBe('number');

    const content = await chartsAs(aal2(owner)).content();
    expect(content.classes).toEqual({ pending: 0, published: 1, retracted: 0, removed: 0 });
    expect(content.bank).toEqual({ library: 0, schoolApproved: 0, schoolWaiting: 0, drafts: 0 });
    expect(content.mostReported).toEqual([
      { id: 'CHT-A', title: 'Title of CHT-A', topicRef: 'sci/cht', reports: { total: 1, open: 1, unsafe: 0 } },
    ]);
    expect(content.mostCost).toEqual([
      {
        id: 'CHT-A',
        title: 'Title of CHT-A',
        topicRef: 'sci/cht',
        cost: { inr: 3, liveInr: 3, warmInr: 0, unpriced: false, calls: 1, sittings: 1 },
      },
    ]);
  });

  it('recompute sends the environment and the reason and returns the counts', async () => {
    const from = await istDay(db, 3);
    const to = await istDay(db, 2);
    const out = await chartsAs(fresh(owner)).recompute({ from, to, reason: 'prices loaded', env: 'TEST' });
    expect(out.from).toBe(from);
    expect(out.to).toBe(to);
    expect(out.days).toBe(2);
    expect(typeof out.rows).toBe('number');
    expect(out.rows).toBeGreaterThan(0);
    const { rows } = await db.query<{ reason: string; environment: string }>(
      `select reason, environment from admin.audit_event where action = 'metrics-recomputed'`,
    );
    expect(rows).toEqual([{ reason: 'prices loaded', environment: 'TEST' }]);
  });
});
