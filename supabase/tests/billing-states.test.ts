// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { billedSchool, CONTACT, makeFinance, readyPlan, readySeller, rpc } from './billing-fixtures.ts';
import { buildSchool } from './fixtures.ts';
import { asService, freshDatabase } from './harness.ts';

/**
 * GRACE, SUSPENSION, THE APPS' VIEW, AND THE BILLING PAGES' READS (migration
 * 0060). Written first.
 *
 * A school's billing state follows its licence's last day L (spec section 10,
 * rulings R5, R6, R23): active (or trial on a pilot) to L, grace for 14 days
 * (14 to 30, the owner's choice per school), then suspended (the tutor is off;
 * homework is untouched), then ended 60 days later. The apps read only ok,
 * grace or suspended through public.app_config.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let today: string;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops');
  safety = await makeStaff(db, 'safety');
  finance = await makeFinance(db, 'Accounts');
  await readySeller(db, owner);
  await readyPlan(db, owner);
  today = (await db.query<{ d: string }>(`select to_char(lms.india_today(), 'YYYY-MM-DD') as d`)).rows[0].d;
});
afterAll(async () => {
  await db.close();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const plus = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const setLicence = (code: string, plan: string, until: string) =>
  db.query(`select lms.set_licence($1, $2, 10, $3::date)`, [code, plan, until]);
const stateOn = async (org: string, day: string) =>
  one<{ state: string; grace_until: string | null }>(
    `select state, to_char(grace_until, 'YYYY-MM-DD') as grace_until from billing.state_for($1, $2::date)`,
    [org, day],
  );
const config = async (school: string | null) =>
  (await one<{ c: Record<string, unknown> }>(`select public.app_config($1) as c`, [school])).c;

describe('the ladder', () => {
  it('the ladder: none, trial, active, grace to its last day, suspended, ended 60 days later', async () => {
    const s = await billedSchool(db, ops, 'LAD');
    expect((await stateOn(s.org, today)).state).toBe('none');
    const L = '2026-06-30';
    await setLicence('LAD', 'standard', L);
    expect(await stateOn(s.org, L)).toEqual({ state: 'active', grace_until: null });
    expect(await stateOn(s.org, plus(L, 1))).toEqual({ state: 'grace', grace_until: plus(L, 14) });
    expect(await stateOn(s.org, plus(L, 14))).toEqual({ state: 'grace', grace_until: plus(L, 14) });
    expect((await stateOn(s.org, plus(L, 15))).state).toBe('suspended');
    expect((await stateOn(s.org, plus(L, 74))).state).toBe('suspended');
    expect((await stateOn(s.org, plus(L, 75))).state).toBe('ended');
    await setLicence('LAD', 'pilot', L);
    expect((await stateOn(s.org, L)).state).toBe('trial');
    expect((await stateOn(s.org, plus(L, 1))).state).toBe('grace');
    // A school with no billing account still has a ladder, at 14 days.
    const bare = await buildSchool(db, 'BARE');
    await setLicence('BARE', 'standard', L);
    expect((await stateOn(bare.org, plus(L, 15))).state).toBe('suspended');
  });

  it('grace is 14 days unless the owner sets 14 to 30 for that school, with a fresh code', async () => {
    const s = await billedSchool(db, ops, 'GRC');
    const L = '2026-06-30';
    await setLicence('GRC', 'standard', L);
    const set = (claims: ReturnType<typeof fresh>, days: number) =>
      rpc(db, claims, 'billing_grace_set', { p_org: s.org, p_days: days, p_reason: 'they asked for time', p_env: 'TEST' });
    await expect(set(fresh(finance), 30)).rejects.toThrow(/not allowed/);
    await expect(set(fresh(ops), 30)).rejects.toThrow(/not allowed/);
    await expect(set(aal2(owner), 30)).rejects.toThrow(/confirm with your authenticator code first/);
    await expect(set(fresh(owner), 31)).rejects.toThrow(/grace is 14 to 30 days/);
    await expect(set(fresh(owner), 13)).rejects.toThrow(/grace is 14 to 30 days/);
    await set(fresh(owner), 30);
    expect(await stateOn(s.org, plus(L, 30))).toEqual({ state: 'grace', grace_until: plus(L, 30) });
    expect((await stateOn(s.org, plus(L, 31))).state).toBe('suspended');
    const a = await one<{ details: unknown; target_id: string }>(
      `select details, target_id from admin.audit_event where action = 'grace-set'`,
    );
    expect(a).toEqual({ details: { days: 30 }, target_id: 'GRC' });
  });
});

describe('what the apps read', () => {
  it('app_config says ok, grace with its last day, or suspended, and nothing finer', async () => {
    const cases: [string, string, string, string][] = [
      // code, licence's last day, billing.state, billing.grace_until
      ['APOK', plus(today, 10), 'ok', ''],
      ['APGR', plus(today, -3), 'grace', plus(today, 11)],
      ['APSU', plus(today, -20), 'suspended', ''],
      ['APEN', plus(today, -100), 'suspended', ''],
    ];
    for (const [code, until, state, graceUntil] of cases) {
      await buildSchool(db, code);
      await setLicence(code, 'standard', until);
      const c = await config(code);
      expect(c['billing.state']).toBe(state);
      expect(c['billing.grace_until']).toBe(graceUntil);
    }
    await buildSchool(db, 'APNO');
    expect((await config('APNO'))['billing.state']).toBe('ok');
    await setLicence('APNO', 'pilot', plus(today, 5));
    expect((await config('APNO'))['billing.state']).toBe('ok');
    expect((await config('apgr'))['billing.state']).toBe('grace');
  });

  it('a suspended school\'s tutor is off whatever its own switch says', async () => {
    await buildSchool(db, 'TUTA');
    await buildSchool(db, 'TUTB');
    await rpc(db, fresh(ops), 'flag_set', {
      p_key: 'tutor.enabled',
      p_scope: 'school',
      p_scope_id: 'TUTA',
      p_value: true,
      p_reason: 'their tutor stays on',
      p_env: 'TEST',
    });
    expect((await config('TUTA'))['tutor.enabled']).toBe(true);
    await setLicence('TUTA', 'standard', plus(today, -20));
    await setLicence('TUTB', 'standard', plus(today, 100));
    expect((await config('TUTA'))['tutor.enabled']).toBe(false);
    expect((await config('TUTB'))['tutor.enabled']).toBe(true);
    // Suspension leaves no entry in the school's own activity log.
    const lms = await one<{ n: number }>(
      `select count(*)::int as n from lms.audit_event e join lms.school s on s.org_id = e.org_id
        where s.code = 'TUTA' and e.action <> 'licence-set'`,
    );
    expect(lms.n).toBe(0);
  });

  it('app_config with no school says ok and keeps every plan-1 key', async () => {
    const c = await config(null);
    expect(c).toEqual({
      'banner.message': '',
      'banner.tone': 'info',
      'tutor.enabled': true,
      'tutor.only_prepared': false,
      'tutor.compose_live_classes': false,
      'contest.entries_open': true,
      'app.min_version.classroom': '0.0.0',
      'app.min_version.student': '0.0.0',
      'app.min_version.lms': '0.0.0',
      'billing.state': 'ok',
      'billing.grace_until': '',
    });
  });

  it('app_config is still callable with no sign-in', async () => {
    const c = await db.transaction(async (tx) => {
      await tx.exec('set local role anon');
      return (await tx.query<{ c: Record<string, unknown> }>(`select public.app_config('APGR') as c`)).rows[0].c;
    });
    expect(c['billing.state']).toBe('grace');
  });
});

describe('the daily job', () => {
  it('the daily job records each change once, audits it, and is scheduled', async () => {
    const run = () => asService(db, async (tx) => (await tx.query<{ n: number }>(`select admin.billing_compute_states() as n`)).rows[0].n);
    const firstRun = await run();
    expect(firstRun).toBeGreaterThanOrEqual(5);
    expect(await run()).toBe(0);
    const rows = (
      await db.query<{ target_id: string; details: { from: string; to: string } }>(
        `select target_id, details from admin.audit_event where action = 'billing-state-changed' order by target_id`,
      )
    ).rows;
    expect(rows.length).toBe(firstRun);
    expect(rows.find((r) => r.target_id === 'APSU')?.details).toEqual({ from: 'none', to: 'suspended' });
    expect(rows.find((r) => r.target_id === 'APOK')?.details).toEqual({ from: 'none', to: 'active' });
    const st = await one<{ state: string; since: string }>(
      `select st.state, to_char(st.since, 'YYYY-MM-DD') as since from billing.school_state st
         join lms.school s on s.org_id = st.org_id where s.code = 'APEN'`,
    );
    expect(st).toEqual({ state: 'ended', since: today });
    const job = await one<{ schedule: string; command: string }>(`select schedule, command from cron.job where jobname = 'billing-states'`);
    expect(job.schedule).toBe('40 18 * * *');
    expect(job.command).toContain('admin.billing_compute_states()');
  });

  it('the job forgets signature failures older than 90 days', async () => {
    const sha = (c: string) => c.repeat(64);
    await db.query(
      `insert into billing.webhook_event (received_at, body_sha256, body_length, signature_ok, status)
       values (now() - interval '91 days', $1, 10, false, 'signature_failed'),
              (now() - interval '10 days', $2, 10, false, 'signature_failed')`,
      [sha('a'), sha('b')],
    );
    await asService(db, (tx) => tx.query(`select admin.billing_compute_states()`));
    const left = (await db.query<{ body_sha256: string }>(`select body_sha256 from billing.webhook_event`)).rows.map((r) => r.body_sha256);
    expect(left).toEqual([sha('b')]);
  });

  it('the job and the service functions are not a browser\'s', async () => {
    await expect(rpc(db, fresh(owner), 'billing_compute_states', {})).rejects.toThrow(/permission denied/);
  });
});

interface Overview {
  collectedThisMonthPaise: number;
  outstandingPaise: number;
  overdue: { count: number; paise: number };
  renewals: { in30: number; in60: number; in90: number };
  states: { grace: number; suspended: number };
  attention: {
    notCounted: number;
    webhookProblems24h: number;
    signatureFailures24h: number;
    lastWebhookMinutesAgo: number | null;
    reconciledMinutesAgo: number | null;
    openLinks: number;
  };
}

describe('the billing pages\' reads', () => {
  it('the overview: collected this month, outstanding, overdue, renewals ahead, counts only', async () => {
    const overview = () => rpc<Overview>(db, aal2(finance), 'billing_overview', {});
    const before = await overview();
    expect(before.attention.lastWebhookMinutesAgo).toBeNull();
    expect(before.attention.reconciledMinutesAgo).toBeNull();
    expect(before.states.grace).toBeGreaterThanOrEqual(1);
    expect(before.states.suspended).toBeGreaterThanOrEqual(2);

    const s = await billedSchool(db, ops, 'OVR');
    await setLicence('OVR', 'standard', plus(today, 20));
    const inv = await rpc<{ invoiceId: string; number: string }>(db, aal2(ops), 'billing_invoice_raise', {
      p_org: s.org,
      p_description: 'Workbooks',
      p_amount_paise: 10_000,
      p_due_days: 15,
      p_reason: 'test raise',
      p_env: 'TEST',
    });
    await rpc(db, fresh(finance), 'billing_payment_record', {
      p_invoice: inv.invoiceId,
      p_source: 'bank_transfer',
      p_amount_paise: 5000,
      p_received_on: today,
      p_reference: 'UTR-OVR-1',
      p_reason: 'part paid',
      p_env: 'TEST',
    });
    await rpc(db, aal2(ops), 'billing_link_prepare', { p_invoice: inv.invoiceId, p_reason: 'send the rest', p_env: 'TEST' });
    // An invoice due 20 days ago, written as the database owner (no function backdates one).
    const old = await one<{ id: string }>(
      `insert into billing.invoice (number, fy, seq, org_id, kind, description, quantity, unit_paise, taxable_paise, gst_rate_bp,
                                    cgst_paise, sgst_paise, igst_paise, total_paise, issued_on, due_on, seller, buyer)
       values ('TEST/OLD/0001', '00-01', 1, $1, 'other', 'Old', 1, 1000, 1000, 1800, 90, 90, 0, 1180,
               lms.india_today() - 35, lms.india_today() - 20, '{}', '{}') returning id`,
      [s.org],
    );
    await db.query(
      `insert into billing.payment (org_id, invoice_id, source, amount_paise, currency, received_on, reference, cf_order_id,
                                    counted, not_counted_why, recorded_as)
       values ($1, $2, 'cashfree_link', 999, 'INR', lms.india_today(), 'CF_odd', 'CF_odd', false, 'the amount is not the link''s amount', 'Cashfree')`,
      [s.org, old.id],
    );
    await db.query(
      `insert into billing.webhook_event (idem_key, body_sha256, body_length, signature_ok, status, detail)
       values ('ovr-mismatch', $1, 10, true, 'mismatch', 'the amount is not the link''s amount')`,
      ['c'.repeat(64)],
    );
    await asService(db, async (tx) => {
      await tx.query(`select admin.billing_signature_failed($1, 10, 'signature does not match')`, ['d'.repeat(64)]);
      await tx.query(`select admin.billing_reconcile_done('{"checked":0,"changed":0,"failed":0}'::jsonb)`);
    });

    const after = await overview();
    expect(after.collectedThisMonthPaise - before.collectedThisMonthPaise).toBe(5000);
    expect(after.outstandingPaise - before.outstandingPaise).toBe(6800 + 1180);
    expect(after.overdue.count - before.overdue.count).toBe(1);
    expect(after.overdue.paise - before.overdue.paise).toBe(1180);
    expect(after.renewals.in30 - before.renewals.in30).toBe(1);
    expect(after.renewals.in60 - before.renewals.in60).toBe(1);
    expect(after.renewals.in90 - before.renewals.in90).toBe(1);
    expect(after.attention.notCounted - before.attention.notCounted).toBe(1);
    expect(after.attention.webhookProblems24h - before.attention.webhookProblems24h).toBe(1);
    expect(after.attention.signatureFailures24h - before.attention.signatureFailures24h).toBe(1);
    expect(after.attention.lastWebhookMinutesAgo).toBe(0);
    expect(after.attention.reconciledMinutesAgo).toBe(0);
    expect(after.attention.openLinks - before.attention.openLinks).toBe(1);
    const text = JSON.stringify(after);
    for (const word of ['OVR', 'Public School', CONTACT.phone, CONTACT.email, CONTACT.name]) expect(text).not.toContain(word);
    await expect(rpc(db, aal2(safety), 'billing_overview', {})).rejects.toThrow(/not allowed/);
  });

  it('a school\'s billing page has its account with the contact, its state, licence, subscriptions, invoices and payments; safety is refused', async () => {
    const org = (await one<{ org_id: string }>(`select org_id from lms.school where code = 'OVR'`)).org_id;
    const page = await rpc<Record<string, unknown>>(db, aal2(ops), 'billing_school', { p_org: org });
    expect(Object.keys(page).sort()).toEqual(
      ['account', 'invoices', 'licence', 'payments', 'school', 'signal', 'state', 'subscriptions'],
    );
    expect(page.school).toEqual({ orgId: org, code: 'OVR', name: 'OVR Public School' });
    expect(page.account).toMatchObject({ contactName: CONTACT.name, contactPhone: CONTACT.phone, contactEmail: CONTACT.email, graceDays: 14 });
    expect(page.state).toEqual({ state: 'active', graceUntil: null });
    expect(page.licence).toMatchObject({ plan: 'standard', seats: 10, validUntil: plus(today, 20) });
    expect((page.licence as { seatsUsed: number }).seatsUsed).toBeGreaterThanOrEqual(0);
    expect((page.invoices as unknown[]).length).toBe(2);
    expect((page.payments as unknown[]).length).toBe(2);
    expect(page.signal).toEqual({ level: 'red', reason: 'An invoice is 20 days overdue.' });

    const bare = (await one<{ org_id: string }>(`select org_id from lms.school where code = 'APNO'`)).org_id;
    const none = await rpc<Record<string, unknown>>(db, aal2(finance), 'billing_school', { p_org: bare });
    expect(none.account).toBeNull();
    expect(none.signal).toEqual({ level: 'grey', reason: 'No billing account yet.' });

    const accounts = await rpc<Record<string, unknown>[]>(db, aal2(finance), 'billing_accounts', {});
    const total = await one<{ n: number }>(`select count(*)::int as n from lms.school`);
    expect(accounts.length).toBe(total.n);
    const ovr = accounts.find((a) => a.code === 'OVR');
    expect(ovr).toMatchObject({ orgId: org, name: 'OVR Public School', hasAccount: true, state: 'active', licenceUntil: plus(today, 20), overdueDays: 20 });
    for (const a of accounts) {
      expect(Object.keys(a).sort()).toEqual(['code', 'hasAccount', 'licenceUntil', 'name', 'orgId', 'outstandingPaise', 'overdueDays', 'state']);
    }
    expect(JSON.stringify(accounts)).not.toContain(CONTACT.phone);
    await expect(rpc(db, aal2(safety), 'billing_school', { p_org: org })).rejects.toThrow(/not allowed/);
    await expect(rpc(db, aal2(safety), 'billing_accounts', {})).rejects.toThrow(/not allowed/);
  });
});
