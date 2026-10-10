// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { addStudents, handIn, publish } from './admin-school-fixtures.ts';
import { rpc } from './billing-fixtures.ts';
import { buildSchool, type School } from './fixtures.ts';
import { freshDatabase } from './harness.ts';
import { addSignInColumn, answer, atIst, istDay, nightly, series, sitting, usage } from './metrics-fixtures.ts';
import { keepFlag, report, setReport } from './safety-fixtures.ts';

/**
 * NEVER A CHILD (plan 6, Task 8). Written after the store, the families and
 * the reads, as a sweep over all of them.
 *
 * Children with marker names, notes, contest details and every kind of record
 * the families read are rolled up by the nightly job and a recompute; then
 * every read the console has is called as the owner and searched for any of
 * them. The store is checked for a person's id in any column, and its
 * dimensions against the fixed vocabulary.
 */

let db: PGlite;
let owner: Staff;
let swp: School;
let kids: string[];
let logins: string[];

const PAGES = ['overview', 'money', 'schools', 'learning', 'content', 'reliability', 'funnel', 'safety'];

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  await addSignInColumn(db);
  swp = await buildSchool(db, 'SWP');
  kids = [swp.kid8a, ...(await addStudents(db, swp, 'SWP', 10)), swp.kid8b];
  await db.query(
    `update lms.account set display_name = 'Zzmarker Child ' || login_id where org_id = $1 and kind = 'student'`,
    [swp.org],
  );
  logins = (
    await db.query<{ login_id: string }>(`select login_id from lms.account where org_id = $1 and kind = 'student'`, [swp.org])
  ).rows.map((r) => r.login_id);
  await db.query(`insert into lms.outcome (id, grade, subject, chapter, title) values ('swp-o1', 8, 'Mathematics', 'Fractions', 'Adds fractions')`);
  const item = (
    await db.query<{ id: string }>(
      `insert into lms.item (library_ref, outcome_ids, kind, stem, options, correct_index, misconceptions)
       values ('swp-lib-1', '{swp-o1}', 'mcq', 'What is 1/2 + 1/3?', '["5/6","2/5"]', 0, '["", "adds denominators"]') returning id`,
    )
  ).rows[0].id;
  await db.query(
    `insert into public.model_price (provider, model, unit, inr_per_unit, effective_from) values ('vertex', 'gemini-x', 'prompt_token', 0.001, '2026-01-01')`,
  );
  const hw = await publish(db, swp, 2);
  for (const kid of kids) {
    const s = await sitting(db, { org: swp.org, user: kid, receivedSql: atIst(1, '10:00'), activeMs: 600000, topic: 'sci/swp' });
    await answer(db, { org: swp.org, user: kid, receivedSql: atIst(1, '10:05'), outcomes: ['swp-o1'], session: s });
    await usage(db, { user: kid, session: s, atSql: atIst(1, '10:06'), promptTokens: 1000, bucket: 'live' });
    await handIn(db, swp.org, hw, kid, 1);
    await answer(db, {
      org: swp.org,
      user: kid,
      source: 'practice',
      receivedSql: atIst(1, '17:00'),
      outcomes: ['swp-o1'],
      payload: { correct: false, chosenIndex: 1, itemId: item, assistanceRung: 0 },
    });
    const filed = await report(db, kid, { kind: 'unsafe', note: 'zzsecretnote', lessonId: 'SWP-LESSON' });
    await setReport(db, filed, `received_at = ${atIst(1, '12:00')}`);
    await db.query(
      `insert into public.contest_signup (user_id, student_name, klass, student_phone, address, city, parent_name_unverified, parent_phone_unverified, created_at)
       values ($1, 'Zzmarker Entrant', 8, '+919999999999', 'zz house', 'Pune', 'Zzmarker Parent', '+919999999999', ${atIst(1, '09:00')})`,
      [kid],
    );
    await db.query(
      `insert into public.consent_record (user_id, parent_name, parent_phone, source, otp_verified_at)
       values ($1, 'Zzmarker Parent', '+919999999999', 'contest', now())`,
      [kid],
    );
    await db.query(`update auth.users set last_sign_in_at = ${atIst(1, '08:00')} where id = $1`, [kid]);
  }
  const flag = crypto.randomUUID();
  await keepFlag(db, kids[0], { id: flag });
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('admin.session', 'on', true)`);
    await tx.query(`update admin.safety_event set received_at = ${atIst(1, '15:00')} where id = $1`, [flag]);
  });
  await rpc(db, fresh(owner), 'safety_capture_set', { p_on: await istDay(db, 5), p_reason: 'the relay went live', p_env: 'TEST' });
  await nightly(db);
  await rpc(db, fresh(owner), 'metric_recompute', {
    p_from: await istDay(db, 30),
    p_to: await istDay(db, 1),
    p_reason: 'the privacy sweep',
    p_env: 'TEST',
  });
});
afterAll(async () => {
  await db.close();
});

describe('never a child', () => {
  it("no read returns a child's id, login ID, name, words, phone or address", async () => {
    const reads: unknown[] = [];
    for (const page of PAGES) {
      for (const days of [7, 30]) reads.push(await series(db, aal2(owner), page, days));
    }
    reads.push(await series(db, aal2(owner), 'schools', 30, 'SWP'));
    reads.push(await series(db, aal2(owner), 'learning', 30, 'SWP'));
    reads.push(await rpc(db, aal2(owner), 'money_view', { p_days: 30 }));
    reads.push(await rpc(db, aal2(owner), 'content_view', {}));
    const text = JSON.stringify(reads);
    // The sweep is only worth something if the children's figures are in it.
    expect(text).toContain('adds denominators');
    expect(text).toContain('"school":"SWP"');
    for (const kid of kids) expect(text).not.toContain(kid);
    for (const login of logins) expect(text).not.toContain(login);
    expect(text).not.toContain('SWP-');
    for (const marker of ['Zzmarker', 'zzsecretnote', '9999999999', 'zz house']) {
      expect(text, marker).not.toContain(marker);
    }
  });

  it("the store holds no person's id", async () => {
    const { rows } = await db.query<{ dim: string; org: string | null; school: boolean }>(
      `select distinct m.dim, m.org_id as org, exists (select 1 from lms.school s where s.org_id = m.org_id) as school
         from admin.metric_daily m`,
    );
    // Every family wrote something for the sweep to check.
    expect(rows.map((r) => r.dim)).toEqual(
      expect.arrayContaining(['', 'school', 'model:gemini-x', 'llm:ok', '8|Mathematics', '8|Mathematics|adds denominators', 'unsafe', 'from-student', 'library']),
    );
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const vocabulary =
      /^$|^(school|direct|ok|client|server|none|other|green|amber|red|grey|new|seen|triaged|wrong|rude|unsafe|from-student|to-student|pending|published|retracted|removed|library|school_approved|school_waiting|drafts|processed|ignored|mismatch|unparsed|stored|signature_failed)$|^(relay|model|bucket|who):|^[a-z]+:(ok|client|server|none|other)$|^[0-9]{1,2}\|/;
    for (const r of rows) {
      expect(r.dim, r.dim).not.toMatch(uuid);
      expect(r.dim, r.dim).toMatch(vocabulary);
      if (r.org !== null) expect(r.school, r.org).toBe(true);
    }
  });

  it('every child figure is marked as one', async () => {
    const { rows } = await db.query<{ key: string }>(`select key from admin.metric_def where child_figure order by key collate "C"`);
    expect(rows.map((r) => r.key)).toEqual(
      [
        'school.activated',
        'school.handed_in_7d',
        'school.signins',
        'learn.outcomes_covered_30d',
        'learn.misconceptions_30d',
        'learn.practice_answers',
        'funnel.cohort',
        'funnel.verified',
        'funnel.first_class',
        'funnel.second_day',
      ].sort(),
    );
  });

  it('every figure that can be not captured has a reason', async () => {
    const { rows } = await db.query<{ key: string; why: string | null }>(
      `select key, why from admin.metric_def where not captured or since_setting is not null or key = 'school.signins' order by key`,
    );
    expect(rows.map((r) => r.key)).toEqual(['alarm.history', 'calls.latency', 'relay.refusals', 'safety.flags', 'school.signins']);
    for (const r of rows) expect((r.why ?? '').length, r.key).toBeGreaterThanOrEqual(20);
  });

  it('the browser can call exactly four new functions', async () => {
    const { rows } = await db.query<{ fn: string; auth: boolean; anon: boolean }>(
      `select p.proname as fn,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'admin'
          and (p.proname like 'metric%' or p.proname in ('money_view', 'content_view', 'content_counts', 'ist_start',
                                                        'chart_roles', 'signins_readable', 'ceiling_on'))
        order by 1`,
    );
    expect(rows.filter((r) => r.auth).map((r) => r.fn)).toEqual(['content_view', 'metric_recompute', 'metric_series', 'money_view']);
    expect(rows.filter((r) => r.anon)).toEqual([]);
    expect(rows.map((r) => r.fn)).toEqual(
      expect.arrayContaining([
        'ceiling_on',
        'chart_roles',
        'content_counts',
        'ist_start',
        'metric_compute',
        'metric_family_calls',
        'metric_family_content',
        'metric_family_funnel',
        'metric_family_learning',
        'metric_family_money',
        'metric_family_relay',
        'metric_family_safety',
        'metric_family_schools',
        'metric_family_spend',
        'metric_family_tutor',
        'metric_family_webhooks',
        'metric_json',
        'metric_nightly',
        'signins_readable',
      ]),
    );
  });
});
