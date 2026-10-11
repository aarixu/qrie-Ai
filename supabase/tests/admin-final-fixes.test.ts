// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { makeFinance, rpc, serviceRpc } from './billing-fixtures.ts';
import { bareSchool } from './admin-school-fixtures.ts';
import { asClaims, asService, createUser, freshDatabase } from './harness.ts';

/**
 * THE FINAL REVIEW'S FIXES (0075). Written first.
 *
 * 1. Hand-written SQL on the five control tables the tripwire did not watch
 *    (who is staff, the settings, the switch registry, the one-day ceiling
 *    raise, the alarm token) leaves an 'unmanaged-change' row, as spec section
 *    6 promises; every function that writes them leaves none.
 * 2. The 10,000th invoice or credit note of a year keeps all five digits.
 * 3. Wrong alarm tokens are counted where staff can see them (System).
 * 4. Switching tutor.only_prepared off starts class preparation and its spend
 *    again: the owner's, as spec section 3 reserves money flowing again.
 * 5. A school's own tutor.enabled value can be cleared, so the school follows
 *    the platform's switch again (admin.flag_clear).
 */

const TOKEN = 'a'.repeat(40);

const unmanaged = async (db: PGlite, table?: string) =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n from admin.audit_event where action = 'unmanaged-change' and ($1::text is null or target_kind = $1)`,
      [table ?? null],
    )
  ).rows[0].n;

describe('hand-written SQL on the control tables leaves a trace', () => {
  let db: PGlite;
  let owner: Staff;
  beforeAll(async () => {
    db = await freshDatabase();
    await setEnvironment(db);
    owner = await makeStaff(db, 'owner', 'Aarav');
  });
  afterAll(async () => {
    await db.close();
  });

  it('a hand insert into platform_staff (making someone owner) writes one unmanaged-change row', async () => {
    const id = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    const before = await unmanaged(db, 'platform_staff');
    await db.query(`insert into admin.platform_staff (user_id, role, display_name) values ($1, 'owner', 'x')`, [id]);
    expect(await unmanaged(db, 'platform_staff')).toBe(before + 1);
    await db.query(`update admin.platform_staff set active = false where user_id = $1`, [id]);
    expect(await unmanaged(db, 'platform_staff')).toBe(before + 2);
  });

  it('a hand change to the environment setting writes one', async () => {
    const before = await unmanaged(db, 'setting');
    await db.query(`update admin.setting set value = '"TEST"' where key = 'environment'`);
    expect(await unmanaged(db, 'setting')).toBe(before + 1);
  });

  it('a hand change to a switch definition writes one', async () => {
    const before = await unmanaged(db, 'flag_def');
    await db.query(`update admin.flag_def set guarded = true where key = 'banner.tone'`);
    expect(await unmanaged(db, 'flag_def')).toBe(before + 1);
    await db.query(`update admin.flag_def set guarded = false where key = 'banner.tone'`);
  });

  it('a hand-inserted ceiling raise writes one', async () => {
    const before = await unmanaged(db, 'cap_override');
    await db.query(`insert into admin.cap_override (id, previous_units, revert_on) values (true, 5000, current_date + 1)`);
    expect(await unmanaged(db, 'cap_override')).toBe(before + 1);
    await db.query(`delete from admin.cap_override`);
    expect(await unmanaged(db, 'cap_override')).toBe(before + 2);
  });

  it('a hand-written alarm token writes one', async () => {
    const before = await unmanaged(db, 'alert_token');
    await db.query(`insert into admin.alert_token (id, token_hash) values (true, 'x') on conflict (id) do update set token_hash = 'x'`);
    expect(await unmanaged(db, 'alert_token')).toBe(before + 1);
  });

  it('the functions that write these tables write no unmanaged-change row', async () => {
    const steps: [string, () => Promise<unknown>][] = [
      ['alert_token_set', () => asService(db, (tx) => tx.query(`select admin.alert_token_set($1)`, [TOKEN]))],
      ['alert_snapshot', () => db.query(`select public.alert_snapshot($1)`, [TOKEN])],
      ['audit_head', () => db.query(`select public.audit_head($1)`, [TOKEN])],
      ['billing_reconcile_due', () => serviceRpc(db, 'billing_reconcile_due', { p_force: true })],
      ['billing_reconcile_done', () => serviceRpc(db, 'billing_reconcile_done', { p_value: { checked: 0, changed: 0, failed: 0 } })],
      ['set_caps (a raise)', () => rpc(db, fresh(owner), 'set_caps', { p_units: 900000, p_reason: 'launch day', p_env: 'TEST' })],
      ['revert_caps', async () => {
        await db.transaction(async (tx) => {
          await tx.query(`select set_config('admin.session', 'on', true)`);
          await tx.query(`update admin.cap_override set revert_on = (now() at time zone 'utc')::date`);
        });
        return serviceRpc(db, 'revert_caps', {});
      }],
      ['restore_drill_set', () => rpc(db, aal2(owner), 'restore_drill_set', { p_on: '2026-10-01', p_reason: 'drill done', p_env: 'TEST' })],
      ['flag_set', () => rpc(db, aal2(owner), 'flag_set', {
        p_key: 'banner.message', p_scope: 'global', p_scope_id: '', p_value: 'hello', p_reason: 'a notice', p_env: 'TEST',
      })],
    ];
    for (const [name, step] of steps) {
      const before = await unmanaged(db);
      await step();
      expect(await unmanaged(db), name).toBe(before);
    }
  });

  it('inviting, changing and switching on a member of staff writes none', async () => {
    const id = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    const before = await unmanaged(db);
    await rpc(db, fresh(owner), 'staff_invite', { p_user: id, p_role: 'ops', p_name: 'New ops', p_reason: 'hire', p_env: 'TEST' });
    await rpc(db, fresh(owner), 'staff_set', {
      p_user: id, p_role: 'ops', p_name: 'New ops', p_active: true, p_reason: 'spoke to them', p_env: 'TEST',
    });
    expect(await unmanaged(db)).toBe(before);
  });

  it('the contest purge, through the daily job, writes none', async () => {
    const user = await createUser(db);
    await db.query(
      `insert into public.contest_signup (user_id, student_name, klass, takes_tuition, campaign, created_at)
       values ($1, 'Asha', 7, true, 'diwali', now() - interval '3 days')`,
      [user],
    );
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('admin.session', 'on', true)`);
      await tx.query(
        `insert into admin.setting (key, value) values ('contest_purge_on', to_jsonb((lms.india_today() - 1)::text))
         on conflict (key) do update set value = excluded.value`,
      );
    });
    const before = await unmanaged(db);
    const out = await serviceRpc<{ contestEntriesCleared: number }>(db, 'privacy_daily', {});
    expect(out.contestEntriesCleared).toBe(1);
    expect(await unmanaged(db)).toBe(before);
  });
});

describe('the first owner and the environment', () => {
  it('bootstrap_owner and set_environment write no unmanaged-change row', async () => {
    const db = await freshDatabase();
    const id = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
    await asService(db, async (tx) => {
      await tx.query(`select admin.set_environment('TEST')`);
      await tx.query(`select admin.bootstrap_owner($1, 'Aarav')`, [id]);
      await tx.query(`select admin.set_environment('DEMO', true)`);
    });
    expect(await unmanaged(db)).toBe(0);
    await db.close();
  });
});

describe('invoice and credit-note numbers', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDatabase();
  });
  afterAll(async () => {
    await db.close();
  });
  const fmt = async (series: string, n: number) =>
    (await db.query<{ v: string }>(`select billing.format_number($1, '26-27', $2) as v`, [series, n])).rows[0].v;

  it('keep four digits up to 9999 and every digit from 10000, within 16 characters', async () => {
    expect(await fmt('invoice', 1)).toBe('QRIE/26-27/0001');
    expect(await fmt('invoice', 9999)).toBe('QRIE/26-27/9999');
    expect(await fmt('invoice', 10000)).toBe('QRIE/26-27/10000');
    expect(await fmt('credit_note', 10001)).toBe('QRCN/26-27/10001');
    expect(await fmt('invoice', 99999)).toBe('QRIE/26-27/99999');
    expect((await fmt('invoice', 99999)).length).toBeLessThanOrEqual(16);
    await expect(fmt('invoice', 100000)).rejects.toThrow(/the invoice series is full for this year/);
  });
});

describe('wrong alarm tokens are counted where staff see them', () => {
  it("System's alarm line carries the last hour's wrong tokens, from the alarm and the audit copy", async () => {
    const db = await freshDatabase();
    await setEnvironment(db);
    const owner = await makeStaff(db, 'owner', 'Aarav');
    await asService(db, (tx) => tx.query(`select admin.alert_token_set($1)`, [TOKEN]));
    const misses = async () =>
      (await rpc<{ alarm: { tokenMisses1h: number } }>(db, aal2(owner), 'system_health', {})).alarm.tokenMisses1h;
    expect(await misses()).toBe(0);
    await db.query(`select public.alert_snapshot('wrong')`);
    await db.query(`select public.alert_snapshot(null)`);
    expect(await misses()).toBe(2);
    await db.query(`select public.audit_head('wrong')`);
    expect(await misses()).toBe(3);
    await db.query(`select public.alert_snapshot($1)`, [TOKEN]);
    expect(await misses()).toBe(3);
    await db.query(`update admin.alert_miss set at = now() - interval '61 minutes'`);
    expect(await misses()).toBe(0);
    await db.close();
  });
});

describe("switching class preparation back on is the owner's", () => {
  let db: PGlite;
  let owner: Staff;
  let ops: Staff;
  beforeAll(async () => {
    db = await freshDatabase();
    await setEnvironment(db);
    owner = await makeStaff(db, 'owner', 'Aarav');
    ops = await makeStaff(db, 'ops', 'Ops person');
  });
  afterAll(async () => {
    await db.close();
  });
  const set = (claims: Parameters<typeof rpc>[1], value: boolean) =>
    rpc(db, claims, 'flag_set', {
      p_key: 'tutor.only_prepared', p_scope: 'global', p_scope_id: '', p_value: value, p_reason: 'cost scare', p_env: 'TEST',
    });

  it('ops may switch only_prepared on (stop preparing), not off; the owner may do both', async () => {
    await set(fresh(ops), true);
    await expect(set(fresh(ops), false)).rejects.toThrow(/not allowed/);
    const config = async () =>
      (await db.query<{ c: Record<string, unknown> }>(`select public.app_config(null) as c`)).rows[0].c['tutor.only_prepared'];
    expect(await config()).toBe(true);
    await expect(set(aal2(owner), false)).rejects.toThrow(/authenticator code/);
    await set(fresh(owner), false);
    expect(await config()).toBe(false);
  });
});

describe("a school's own tutor switch can be cleared (admin.flag_clear)", () => {
  let db: PGlite;
  let owner: Staff;
  let ops: Staff;
  let safety: Staff;
  let finance: { id: string; role: 'finance' };
  beforeAll(async () => {
    db = await freshDatabase();
    await setEnvironment(db);
    owner = await makeStaff(db, 'owner', 'Aarav');
    ops = await makeStaff(db, 'ops', 'Ops person');
    safety = await makeStaff(db, 'safety', 'Safety person');
    finance = await makeFinance(db, 'Accounts');
    await bareSchool(db, 'KVX');
  });
  afterAll(async () => {
    await db.close();
  });

  const setFlag = (claims: Parameters<typeof rpc>[1], scope: 'global' | 'school', value: boolean) =>
    rpc(db, claims, 'flag_set', {
      p_key: 'tutor.enabled', p_scope: scope, p_scope_id: scope === 'school' ? 'KVX' : '', p_value: value, p_reason: 'testing', p_env: 'TEST',
    });
  const clear = (claims: Parameters<typeof rpc>[1], over: Record<string, unknown> = {}) =>
    rpc(db, claims, 'flag_clear', { p_key: 'tutor.enabled', p_scope_id: 'kvx', p_reason: 'follow the platform', p_env: 'TEST', ...over });
  const at = async (code: string | null) =>
    (await db.query<{ c: Record<string, unknown> }>(`select public.app_config($1) as c`, [code])).rows[0].c['tutor.enabled'];
  const own = async () =>
    (await db.query(`select 1 from admin.app_flag where key = 'tutor.enabled' and scope = 'school' and scope_id = 'KVX'`)).rows.length;

  it("a school switched on by its own value ignores the platform's switch until the value is cleared", async () => {
    await setFlag(fresh(owner), 'school', true);
    await setFlag(fresh(owner), 'global', false);
    expect(await at('KVX')).toBe(true);
    // Clearing an exemption while the platform is off stops the school: ops may do it.
    const before = await unmanaged(db);
    await clear(fresh(ops));
    expect(await own()).toBe(0);
    expect(await at('KVX')).toBe(false);
    expect(await unmanaged(db)).toBe(before);
    const audit = (
      await db.query<{ actor: string; target_id: string; reason: string; details: unknown }>(
        `select actor, target_id, reason, details from admin.audit_event where action = 'flag-cleared' order by id desc limit 1`,
      )
    ).rows[0];
    expect(audit).toEqual({ actor: ops.id, target_id: 'tutor.enabled @ KVX', reason: 'follow the platform', details: { before: true, after: null } });
  });

  it("clearing a school's off value while the platform is on resumes the school: the owner's, with a fresh code", async () => {
    await setFlag(fresh(owner), 'global', true);
    await setFlag(fresh(ops), 'school', false);
    expect(await at('KVX')).toBe(false);
    await expect(clear(fresh(ops))).rejects.toThrow(/not allowed/);
    await expect(clear(aal2(owner))).rejects.toThrow(/authenticator code/);
    expect(await own()).toBe(1);
    await clear(fresh(owner));
    expect(await own()).toBe(0);
    expect(await at('KVX')).toBe(true);
  });

  it('safety and finance cannot clear; a wrong environment, a missing reason, an unknown school or switch are refused', async () => {
    await setFlag(fresh(ops), 'school', false);
    await expect(clear(fresh(safety))).rejects.toThrow(/not allowed/);
    await expect(clear(fresh(finance))).rejects.toThrow(/not allowed/);
    await expect(clear(fresh(owner), { p_env: 'HOSTED' })).rejects.toThrow(/this console is/);
    await expect(clear(fresh(owner), { p_reason: 'x' })).rejects.toThrow(/say why/);
    await expect(clear(fresh(owner), { p_scope_id: 'NOPE' })).rejects.toThrow(/there is no school with the code NOPE/);
    await expect(clear(fresh(owner), { p_key: 'banner.message' })).rejects.toThrow(/cannot be set for one school/);
    await expect(clear(fresh(owner), { p_key: 'nothing.here' })).rejects.toThrow(/there is no switch called nothing.here/);
    expect(await own()).toBe(1);
  });

  it('clearing a value that is not set says so and changes nothing', async () => {
    await clear(fresh(owner));
    await expect(clear(fresh(owner))).rejects.toThrow(/KVX has no value of its own for tutor.enabled/);
  });

  it('a child cannot call it', async () => {
    const kid = await createUser(db);
    await expect(
      asClaims(db, { sub: kid, aal: 'aal2' }, (tx) =>
        tx.query(`select admin.flag_clear('tutor.enabled', 'KVX', 'because', 'TEST')`),
      ),
    ).rejects.toThrow(/not allowed/);
  });
});
