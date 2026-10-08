// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { healthOf, setLicence, signalOf } from './admin-school-fixtures.ts';
import { billedSchool, makeFinance, readyPlan, readySeller, rpc, serviceRpc } from './billing-fixtures.ts';
import { buildSchool } from './fixtures.ts';
import { asClaims, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * WAVE 1 TOGETHER: PLAN 2 (SCHOOLS, USERS, HEALTH) AND PLAN 3 (BILLING), AND
 * MIGRATION 0061. Written first.
 *
 * Each test here only makes sense with both plans' migrations applied: plan
 * 2's health card and System page reading plan 3's real billing tables, plan
 * 3's finance role meeting plan 2's functions, and plan 3's suspension meeting
 * plan 2's per-school switch. 0061 carries the owner's ruling that a stop is
 * open to every active staff member, finance included (spec section 3).
 */

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
  await readySeller(db, owner);
  await readyPlan(db, owner);
});
afterAll(async () => {
  await db.close();
});

const call = (claims: JwtClaims, sql: string, params: unknown[] = []) =>
  asClaims(db, claims, (tx) => tx.query(sql, params));
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const halted = async () =>
  one<{ halted: boolean; halted_by: string | null }>(`select halted, halted_by from public.relay_control where id`);

describe('the stop is open to finance (0061, the owner\'s ruling on spec section 3)', () => {
  it('a finance member can stop the tutor and cannot resume it, even with a fresh code', async () => {
    expect((await halted()).halted).toBe(false);
    await call(aal2(finance), `select admin.set_halt(true, 'a payment run looks wrong', 'TEST')`);
    expect(await halted()).toEqual({ halted: true, halted_by: 'Accounts' });
    const audit = await one<{ actor_role: string; action: string }>(
      `select actor_role, action from admin.audit_event where action like 'tutor-%' order by id desc limit 1`,
    );
    expect(audit).toEqual({ actor_role: 'finance', action: 'tutor-stopped' });

    await expect(call(fresh(finance), `select admin.set_halt(false, 'all clear', 'TEST')`)).rejects.toThrow(/not allowed/);
    await expect(call(aal2(ops), `select admin.set_halt(false, 'all clear', 'TEST')`)).rejects.toThrow(/not allowed/);
    expect((await halted()).halted).toBe(true);
    await call(fresh(owner), `select admin.set_halt(false, 'all clear', 'TEST')`);
    expect((await halted()).halted).toBe(false);
  });

  it('the stop still wants an active member at aal2, the right environment and a reason', async () => {
    await expect(call({ sub: finance.id, aal: 'aal1' }, `select admin.set_halt(true, 'stop it', 'TEST')`)).rejects.toThrow(
      /not allowed/,
    );
    await expect(call(aal2(finance), `select admin.set_halt(true, 'stop it', 'HOSTED')`)).rejects.toThrow(/this console is TEST, not HOSTED/);
    await expect(call(aal2(finance), `select admin.set_halt(true, '', 'TEST')`)).rejects.toThrow(/say why/);
    const gone = await makeFinance(db, 'Former accountant');
    await db.query(`update admin.platform_staff set active = false where user_id = $1`, [gone.id]);
    await expect(call(aal2(gone), `select admin.set_halt(true, 'stop it', 'TEST')`)).rejects.toThrow(/not allowed/);
    // Ops and safety keep the stop they had.
    await call(aal2(safety), `select admin.set_halt(true, 'a child reported something', 'TEST')`);
    await call(fresh(owner), `select admin.set_halt(false, 'all clear', 'TEST')`);
    expect((await halted()).halted).toBe(false);
  });
});

describe('the health card reads plan 3\'s real payment signal', () => {
  /**
   * An invoice is raised for today (due 0 days after it), then its dates are
   * moved back as the database owner with triggers off, the way a real invoice
   * raised some days ago would look. Plan 3's invoice_guard refuses that edit
   * to anybody else, which is the point of the guard.
   */
  const backdate = (invoiceId: string, daysOverdue: number) =>
    db.transaction(async (tx) => {
      await tx.exec(`set local session_replication_role = replica`);
      await tx.query(
        `update billing.invoice set issued_on = lms.india_today() - $2::int, due_on = lms.india_today() - $2::int where id = $1`,
        [invoiceId, daysOverdue],
      );
    });
  const listed = async (code: string) =>
    (
      await asClaims(db, aal2(ops), (tx) =>
        tx.query<{ payment_level: string; payment_reason: string }>(
          `select payment_level, payment_reason from admin.school_list() where code = $1`,
          [code],
        ),
      )
    ).rows[0];

  it('green with an account and nothing overdue; amber 1 to 14 days overdue; red after 14; on the card and in the list', async () => {
    const s = await billedSchool(db, ops, 'PAYS');
    expect(signalOf(await healthOf(db, aal2(ops), 'PAYS'), 'payment')).toEqual({
      key: 'payment',
      level: 'green',
      reason: 'Nothing is overdue.',
    });
    const inv = await rpc<{ invoiceId: string }>(db, aal2(ops), 'billing_invoice_raise', {
      p_org: s.org,
      p_description: 'Teacher training day',
      p_amount_paise: 100_000,
      p_due_days: 0,
      p_reason: 'test raise',
      p_env: 'TEST',
    });
    expect(signalOf(await healthOf(db, aal2(ops), 'PAYS'), 'payment').level).toBe('green');

    for (const [days, level, reason] of [
      [1, 'amber', 'An invoice is 1 day overdue.'],
      [14, 'amber', 'An invoice is 14 days overdue.'],
      [15, 'red', 'An invoice is 15 days overdue.'],
    ] as const) {
      await backdate(inv.invoiceId, days);
      expect(signalOf(await healthOf(db, aal2(ops), 'PAYS'), 'payment')).toEqual({ key: 'payment', level, reason });
      expect(await listed('PAYS')).toEqual({ payment_level: level, payment_reason: reason });
    }
    // The safety reviewer sees the same card: the signal says a level, never an amount.
    expect(signalOf(await healthOf(db, aal2(safety), 'PAYS'), 'payment').level).toBe('red');
  });

  it('a school with no billing account still reads plan 2\'s grey line', async () => {
    await buildSchool(db, 'NOACC');
    expect(signalOf(await healthOf(db, aal2(ops), 'NOACC'), 'payment')).toEqual({
      key: 'payment',
      level: 'grey',
      reason: 'No billing account yet.',
    });
  });
});

describe('the System page\'s Cashfree row reads plan 3\'s real tables', () => {
  const cashfree = async () =>
    (
      await asClaims(db, aal2(owner), (tx) =>
        tx.query<{ c: Record<string, unknown> }>(`select admin.system_health() -> 'cashfree' as c`),
      )
    ).rows[0].c;

  it('is captured once billing exists, and counts what the webhook and the hourly check wrote', async () => {
    expect(await one<{ t: string | null }>(`select to_regclass('billing.webhook_event')::text as t`)).toEqual({
      t: 'billing.webhook_event',
    });
    expect(await cashfree()).toEqual({
      captured: true,
      lastWebhookMinutesAgo: null,
      signatureFailures24h: 0,
      unprocessed: 0,
      reconciledMinutesAgo: null,
    });
    const ingested = await serviceRpc<{ duplicate: boolean; status: string }>(db, 'billing_webhook_ingest', {
      p_key: 'wave1-merge-1',
      p_body_sha256: 'a'.repeat(64),
      p_body_length: 64,
      p_value: { type: 'SOMETHING_ELSE' },
    });
    expect(ingested).toEqual({ duplicate: false, status: 'ignored' });
    await serviceRpc(db, 'billing_signature_failed', { p_body_sha256: 'b'.repeat(64), p_body_length: 90, p_why: 'mismatch' });
    await serviceRpc(db, 'billing_reconcile_done', { p_value: { checked: 0, changed: 0, failed: 0 } });
    expect(await cashfree()).toEqual({
      captured: true,
      lastWebhookMinutesAgo: 0,
      signatureFailures24h: 1,
      unprocessed: 0,
      reconciledMinutesAgo: 0,
    });
  });
});

describe('finance meets plan 2', () => {
  it('a finance member reaches billing', async () => {
    const s = await billedSchool(db, ops, 'FINR');
    for (const sql of [
      `select admin.billing_overview()`,
      `select admin.billing_accounts()`,
      `select admin.billing_invoices()`,
      `select admin.billing_payments()`,
      `select admin.billing_school('${s.org}'::uuid)`,
      `select admin.me()`,
    ]) {
      await expect(call(aal2(finance), sql), sql).resolves.toBeTruthy();
    }
  });

  it('a finance member is refused plan 2\'s schools, school people, users, staff and System', async () => {
    await buildSchool(db, 'FINX');
    const someone = '00000000-0000-0000-0000-000000000001';
    for (const sql of [
      `select * from admin.school_list()`,
      `select admin.school_index()`,
      `select admin.school_health('FINX')`,
      `select admin.school_detail('FINX')`,
      `select admin.school_weekly('FINX')`,
      `select admin.school_people('FINX', 'a')`,
      `select admin.school_person('FINX', 'FINX-101')`,
      `select admin.school_activity('FINX')`,
      `select admin.school_notes('FINX')`,
      `select admin.school_person_disable('FINX', 'FINX-101', 'left the school', 'TEST')`,
      `select admin.direct_users_summary()`,
      `select admin.direct_user_find('someone@example.com')`,
      `select admin.direct_user('${someone}'::uuid)`,
      `select admin.direct_user_block('${someone}'::uuid, true, 'testing it', 'TEST')`,
      `select * from admin.staff_roster()`,
      `select * from admin.audit_list()`,
      `select admin.system_health()`,
      `select admin.api_gate('pin-reset', 'FINX', 'FINX-101', 'forgot it', 'TEST')`,
    ]) {
      await expect(call(fresh(finance), sql), sql).rejects.toThrow(/not allowed/);
    }
  });

  it('plan 2\'s Staff page lists a finance member with their role', async () => {
    const { rows } = await asClaims(db, aal2(owner), (tx) =>
      tx.query<{ role: string; display_name: string }>(
        `select role, display_name from admin.staff_roster() where user_id = $1`,
        [finance.id],
      ),
    );
    expect(rows).toEqual([{ role: 'finance', display_name: 'Accounts' }]);
  });
});

describe('a suspended school and plan 2\'s per-school switch', () => {
  const config = async (school: string) =>
    (await one<{ c: Record<string, unknown> }>(`select public.app_config($1) as c`, [school])).c;
  const setTutor = (claims: JwtClaims, code: string, on: boolean) =>
    rpc(db, claims, 'flag_set', {
      p_key: 'tutor.enabled',
      p_scope: 'school',
      p_scope_id: code,
      p_value: on,
      p_reason: 'testing the switch',
      p_env: 'TEST',
    });

  it('a suspended school reads tutor.enabled false whatever its switch says; a paying school\'s switch still works', async () => {
    await buildSchool(db, 'SUSP');
    await buildSchool(db, 'PAID');
    await setLicence(db, 'SUSP', 10, -20); // its last day was 20 days ago: past 14 days of grace
    await setLicence(db, 'PAID', 10, 100);

    await setTutor(fresh(owner), 'SUSP', true);
    expect(await config('SUSP')).toMatchObject({ 'tutor.enabled': false, 'billing.state': 'suspended' });

    // Plan 2's switch at a paying school: ops may turn it off, only the owner back on (R23).
    await setTutor(fresh(ops), 'PAID', false);
    expect(await config('PAID')).toMatchObject({ 'tutor.enabled': false, 'billing.state': 'ok' });
    await expect(setTutor(fresh(ops), 'PAID', true)).rejects.toThrow(/not allowed/);
    await setTutor(fresh(owner), 'PAID', true);
    expect(await config('PAID')).toMatchObject({ 'tutor.enabled': true, 'billing.state': 'ok' });

    // The suspended school's own switch is still recorded, and comes back into force once it pays.
    const own = await one<{ value: unknown }>(
      `select value from admin.app_flag where key = 'tutor.enabled' and scope = 'school' and scope_id = 'SUSP'`,
    );
    expect(own.value).toBe(true);
    await setLicence(db, 'SUSP', 10, 30);
    expect(await config('SUSP')).toMatchObject({ 'tutor.enabled': true, 'billing.state': 'ok' });

    // Finance has no switch, at a school or anywhere.
    await expect(setTutor(fresh(finance), 'PAID', false)).rejects.toThrow(/not allowed/);
  });
});
