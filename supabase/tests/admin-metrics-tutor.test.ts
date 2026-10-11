// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { rpc } from './billing-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { freshDatabase } from './harness.ts';
import {
  answer,
  atIst,
  compute,
  figures,
  istDay,
  metricDef,
  nightly,
  price,
  putMetric,
  sitting,
  soloOrg,
  usage,
} from './metrics-fixtures.ts';

/**
 * THE NIGHTLY ROLL-UP, THE OWNER'S RECOMPUTE, AND THE TUTOR'S FIGURES (0071). Written first.
 *
 * admin.metric_compute rolls up one India day by calling every registered
 * family. The nightly job (pg_cron, 18:50 UTC) rolls up yesterday with its
 * snapshots and refreshes the six days before; the owner recomputes up to 92
 * days ending yesterday with a fresh code, a reason and the environment.
 * Learners, minutes, classes and the cost of sittings come from the ledger;
 * spend from usage_cost; the meter and the ceiling by UTC day; calls by
 * their upstream status.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let tut: School;
let direct: string;
let directOrg: string;
const day = (n: number) => istDay(db, n);

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  tut = await buildSchool(db, 'TUT');
  direct = await anonymousChild(db);
  directOrg = await soloOrg(db, direct);
  await price(db, 'gemini-x', 'prompt_token', 0.001);
});
afterAll(async () => {
  await db.close();
});

const recompute = (claims: Parameters<typeof rpc>[1], args: Record<string, unknown>) =>
  rpc<{ from: string; to: string; days: number; rows: number }>(db, claims, 'metric_recompute', {
    p_reason: 'prices loaded',
    p_env: 'TEST',
    ...args,
  });

describe('the tutor figures', () => {
  it('learners count each person once a day, split into school and direct, on the India day the server received them', async () => {
    await sitting(db, { org: tut.org, user: tut.kid8a, receivedSql: atIst(2, '09:00') });
    await answer(db, { org: tut.org, user: tut.kid8a, receivedSql: atIst(2, '09:05') });
    await answer(db, { org: directOrg, user: direct, receivedSql: atIst(2, '23:50') });
    // 00:15 in India is 18:45 UTC on the calendar day before: it belongs to day -2.
    await answer(db, { org: tut.org, user: tut.kid8b, receivedSql: atIst(2, '00:15') });
    const { rows } = await db.query<{ utc: string }>(`select to_char(${atIst(2, '00:15')} at time zone 'UTC', 'HH24:MI') as utc`);
    expect(rows[0].utc).toBe('18:45');
    await compute(db, 2);
    await compute(db, 3);
    expect(await figures(db, 'tutor.learners', await day(2))).toEqual({ '': 3, school: 2, direct: 1 });
    expect((await figures(db, 'tutor.learners', await day(3)))['']).toBe(0);
  });

  it('minutes on task add closed sittings with measured time; open sittings and sittings without time do not count', async () => {
    await sitting(db, { org: tut.org, user: tut.kid8a, source: 'doubt', receivedSql: atIst(4), activeMs: 600000 });
    await sitting(db, { org: tut.org, user: tut.kid8a, source: 'doubt', receivedSql: atIst(4), activeMs: null });
    await sitting(db, { org: tut.org, user: tut.kid8b, source: 'doubt', receivedSql: atIst(4), endedSql: null, activeMs: 60000 });
    await compute(db, 4);
    expect(await figures(db, 'tutor.minutes', await day(4))).toEqual({ '': 600000 });
  });

  it('classes served count class sittings only', async () => {
    await sitting(db, { org: tut.org, user: tut.kid8a, source: 'class', receivedSql: atIst(5) });
    await sitting(db, { org: tut.org, user: tut.kid8b, source: 'doubt', receivedSql: atIst(5) });
    await compute(db, 5);
    expect(await figures(db, 'tutor.classes', await day(5))).toEqual({ '': 1 });
  });

  it('the cost of closed sittings: their spend in paise, their time, their calls and how many are unpriced', async () => {
    const s = await sitting(db, { org: tut.org, user: tut.kid8a, receivedSql: atIst(6), activeMs: 3600000 });
    await usage(db, { user: tut.kid8a, session: s, atSql: atIst(6), promptTokens: 1000 });
    await usage(db, { user: tut.kid8a, session: s, atSql: atIst(6), promptTokens: 1000 });
    await usage(db, { user: tut.kid8a, session: s, atSql: atIst(6), model: 'unpriced-model', promptTokens: 10 });
    await compute(db, 6);
    const d = await day(6);
    expect(await figures(db, 'cost.sitting_paise', d)).toEqual({ '': 200 });
    expect(await figures(db, 'cost.active_ms', d)).toEqual({ '': 3600000 });
    expect(await figures(db, 'cost.sitting_calls', d)).toEqual({ '': 3 });
    expect(await figures(db, 'cost.sitting_unpriced_calls', d)).toEqual({ '': 1 });
  });

  it('spend by relay, model, bucket, school and direct, with a zero row for a school that spent nothing', async () => {
    const tuz = await buildSchool(db, 'TUZ');
    await usage(db, { user: tut.kid8a, atSql: atIst(1), relay: 'llm', model: 'gemini-x', promptTokens: 1000, bucket: 'live' });
    await usage(db, { user: direct, atSql: atIst(1), relay: 'speech', model: null });
    await compute(db, 1);
    const d = await day(1);
    const spend = await figures(db, 'spend.paise', d);
    for (const dim of ['', 'relay:llm', 'relay:speech', 'model:gemini-x', 'model:none', 'bucket:live', 'bucket:none', 'who:school', 'who:direct']) {
      expect(spend, dim).toHaveProperty([dim]);
    }
    expect(spend['']).toBe(100);
    expect(spend['who:school']).toBe(100);
    expect(spend['who:direct']).toBe(0);
    expect(await figures(db, 'spend.calls', d)).toEqual({ '': 2 });
    expect(await figures(db, 'spend.school_paise', d, tut.org)).toEqual({ '': 100 });
    expect(await figures(db, 'spend.school_paise', d, tuz.org)).toEqual({ '': 0 });
    expect(await figures(db, 'spend.school_unpriced_calls', d, tuz.org)).toEqual({ '': 0 });
  });

  it('preparations are counted by their id; pictures by images priced as image', async () => {
    const p1 = crypto.randomUUID();
    const p2 = crypto.randomUUID();
    await usage(db, { user: tut.kid8a, atSql: atIst(7), bucket: 'live', prep: p1, promptTokens: 1000 });
    await usage(db, { user: tut.kid8a, atSql: atIst(7), bucket: 'live', prep: p1, promptTokens: 1000 });
    await usage(db, { user: tut.kid8a, atSql: atIst(7), bucket: 'live', prep: p2, model: 'unpriced-model', promptTokens: 5 });
    await price(db, 'imagen-x', 'image', 2);
    await usage(db, { user: tut.kid8a, atSql: atIst(7), relay: 'icons', model: 'imagen-x', images: 2 });
    await usage(db, { user: tut.kid8a, atSql: atIst(9), relay: 'icons', model: 'unpriced-model', images: 1 });
    await compute(db, 7);
    await compute(db, 9);
    const d = await day(7);
    expect(await figures(db, 'prep.count', d)).toEqual({ '': 2 });
    expect(await figures(db, 'prep.paise', d)).toEqual({ '': 200 });
    expect(await figures(db, 'prep.unpriced_calls', d)).toEqual({ '': 1 });
    expect(await figures(db, 'pictures.count', d)).toEqual({ '': 2 });
    expect(await figures(db, 'pictures.paise', d)).toEqual({ '': 400 });
    expect(await figures(db, 'pictures.unpriced_calls', d)).toEqual({ '': 0 });
    expect(await figures(db, 'pictures.unpriced_calls', await day(9))).toEqual({ '': 1 });
  });

  it('meter units and the ceiling are kept by UTC day, a day behind the India day, and a past ceiling is the one in force when that day ended', async () => {
    const u3 = await day(3);
    const u2 = await day(2);
    await db.query(`insert into public.relay_budget_day (day, units) values ($1::date, 1200), ($2::date, 700)`, [u3, u2]);
    await compute(db, 2);
    expect(await figures(db, 'relay.units', u3)).toEqual({ '': 1200 });
    expect(await figures(db, 'relay.ceiling', u3)).toEqual({ '': 50000 });
    await compute(db, 1);
    expect(await figures(db, 'relay.units', u2)).toEqual({ '': 700 });
    const ceilingOn = async (d: string) =>
      (await db.query<{ c: number }>(`select admin.ceiling_on($1::date) as c`, [d])).rows[0].c;
    const utcToday = (await db.query<{ d: string }>(`select ((now() at time zone 'UTC')::date)::text as d`)).rows[0].d;
    expect(await ceilingOn(u3)).toBe(50000);
    await rpc(db, fresh(owner), 'set_caps', { p_units: 60000, p_reason: 'launch day', p_env: 'TEST' });
    expect(await ceilingOn(u3)).toBe(50000);
    expect(await ceilingOn(utcToday)).toBe(60000);
  });

  it('calls by outcome: answered, refused upstream, failed upstream, and no visible outcome, overall and per relay', async () => {
    for (const status of [200, 429, 503, 0]) {
      await usage(db, { user: tut.kid8a, atSql: atIst(8), status });
    }
    await compute(db, 8);
    const calls = await figures(db, 'calls.outcome', await day(8));
    expect(calls).toMatchObject({ '': 4, ok: 1, client: 1, server: 1, none: 1, 'llm:server': 1, 'llm:ok': 1 });
  });
});

describe('the jobs', () => {
  it('the nightly job rolls up yesterday, refreshes the six days before, logs one run, and only the service role may call it', async () => {
    const out = await nightly(db);
    expect(out.day).toBe(await day(1));
    expect(out.rows).toBeGreaterThan(0);
    const { rows } = await db.query<{ from_day: string; to_day: string; nightly: boolean }>(
      `select from_day::text, to_day::text, nightly from admin.metric_run`,
    );
    expect(rows).toEqual([{ from_day: await day(7), to_day: await day(1), nightly: true }]);
    const can = async (role: string) =>
      (await db.query<{ ok: boolean }>(`select has_function_privilege($1, 'admin.metric_nightly()', 'execute') as ok`, [role])).rows[0].ok;
    expect(await can('authenticated')).toBe(false);
    expect(await can('anon')).toBe(false);
    expect(await can('service_role')).toBe(true);
  });

  it('the owner recomputes a range with a fresh code and a reason', async () => {
    const from = await day(5);
    const to = await day(2);
    const out = await recompute(fresh(owner), { p_from: from, p_to: to });
    expect(out).toMatchObject({ from, to, days: 4 });
    expect(out.rows).toBeGreaterThan(0);
    const { rows } = await db.query<{ target_kind: string; details: Record<string, unknown>; reason: string }>(
      `select target_kind, details, reason from admin.audit_event where action = 'metrics-recomputed'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target_kind).toBe('metrics');
    expect(rows[0].reason).toBe('prices loaded');
    expect(rows[0].details).toEqual({ from, to, days: 4, rows: out.rows });
    const run = await db.query<{ nightly: boolean; by_staff: string }>(
      `select nightly, by_staff from admin.metric_run where not nightly`,
    );
    expect(run.rows).toEqual([{ nightly: false, by_staff: owner.id }]);
  });

  it('recompute is refused to ops, a stale code, the wrong environment, a day not yet over, a range over 92 days, and without a reason', async () => {
    const y = await day(1);
    await expect(recompute(fresh(ops), { p_from: y, p_to: y })).rejects.toThrow('not allowed');
    await expect(recompute(aal2(owner), { p_from: y, p_to: y })).rejects.toThrow('confirm with your authenticator code first');
    await expect(recompute(fresh(owner), { p_from: y, p_to: y, p_env: 'HOSTED' })).rejects.toThrow('this console is TEST, not HOSTED');
    const range = 'pick up to 92 days, ending yesterday or earlier';
    await expect(recompute(fresh(owner), { p_from: y, p_to: await day(0) })).rejects.toThrow(range);
    await expect(recompute(fresh(owner), { p_from: await day(100), p_to: y })).rejects.toThrow(range);
    await expect(recompute(fresh(owner), { p_from: y, p_to: await day(2) })).rejects.toThrow(range);
    await expect(recompute(fresh(owner), { p_from: y, p_to: y, p_reason: 'x' })).rejects.toThrow('say why, in a few words');
    await expect(recompute(fresh(owner), { p_from: await day(92), p_to: y })).resolves.toMatchObject({ days: 92 });
  });

  it("a recompute leaves a past day's snapshots as they were", async () => {
    await metricDef(db, { key: 'test.snap', kind: 'snapshot' });
    const d3 = await day(3);
    await putMetric(db, { day: d3, metric: 'test.snap', value: 9 });
    await recompute(fresh(owner), { p_from: d3, p_to: d3 });
    expect(await figures(db, 'test.snap', d3)).toEqual({ '': 9 });
  });

  it('the job runs at 18:50 UTC, which is 00:20 in India', async () => {
    const { rows } = await db.query<{ schedule: string; command: string }>(
      `select schedule, command from cron.job where jobname = 'admin-metrics-nightly'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].schedule).toBe('50 18 * * *');
    expect(rows[0].command.trim()).toBe('select admin.metric_nightly();');
  });

  it('every registered family exists', async () => {
    const { rows } = await db.query<{ fn: string; ok: boolean }>(
      `select fn, to_regprocedure(fn || '(date, boolean)') is not null as ok from admin.metric_family order by position`,
    );
    expect(rows.map((r) => r.fn)).toEqual(
      expect.arrayContaining([
        'admin.metric_family_tutor',
        'admin.metric_family_spend',
        'admin.metric_family_relay',
        'admin.metric_family_calls',
      ]),
    );
    for (const r of rows) expect(r.ok, r.fn).toBe(true);
  });
});
