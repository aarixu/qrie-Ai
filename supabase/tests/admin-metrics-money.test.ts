// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { setLicence } from './admin-school-fixtures.ts';
import { billedSchool, makeFinance, readyPlan, readySeller, rpc, subscribe } from './billing-fixtures.ts';
import { buildSchool } from './fixtures.ts';
import { asService, freshDatabase, type JwtClaims } from './harness.ts';
import { atIst, compute, figures, istDay, putMetric, series } from './metrics-fixtures.ts';

/**
 * MONEY OVER TIME (0072). Written first.
 *
 * Collected is the counted payments received that India day, less reversals.
 * Outstanding and overdue at a day's end come from what was issued by then,
 * not void by then, less what was received by then. Payment notifications are
 * counted by the day they arrived. Margin per school is the invoiced fee spread
 * over its subscription's days against the school's AI spend in the window;
 * renewals ahead are thirteen weeks of non-pilot licences ending.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let child: string;
let mny: { org: string; code: string };
let sub: { subscriptionId: string; invoiceId: string; number: string };
const day = (n: number) => istDay(db, n);

/** Moves an issued invoice's dates (or its void time) into the past, past the guards, as a test-only backdate. */
async function backdate(invoice: string, set: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(`set local session_replication_role = replica`);
    await tx.query(`update billing.invoice set ${set} where id = $1`, [invoice]);
  });
}

const invoice = async (id: string) =>
  (await db.query<{ total: string; taxable: string }>(`select total_paise as total, taxable_paise as taxable from billing.invoice where id = $1`, [id]))
    .rows[0];

const pay = (invoiceId: string, paise: number, receivedOn: string, reference: string) =>
  rpc<{ paymentId: string }>(db, fresh(owner), 'billing_payment_record', {
    p_invoice: invoiceId,
    p_source: 'bank_transfer',
    p_amount_paise: paise,
    p_received_on: receivedOn,
    p_reference: reference,
    p_reason: 'paid by transfer',
    p_env: 'TEST',
  });

const moneyView = (claims: JwtClaims, days = 7) => rpc<MoneyView>(db, claims, 'money_view', { p_days: days });

interface MoneyView {
  from: string;
  to: string;
  days: number;
  margin: {
    code: string;
    name: string;
    feePaise: number;
    costPaise: number;
    costIsFloor: boolean;
    marginPaise: number;
    noFee: boolean;
    daysRolledUp: number;
  }[];
  directCostPaise: number;
  renewals: { weekStart: string; schools: number; paiseAtCurrentPrice: number }[];
}

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  finance = await makeFinance(db);
  child = await anonymousChild(db);
  await readySeller(db, owner);
  await readyPlan(db, owner, 'standard', 12, 50_000);
  mny = await billedSchool(db, owner, 'MNY');
  sub = await subscribe(db, owner, mny.org, 'standard', 100, await day(30));
  await backdate(sub.invoiceId, `issued_on = lms.india_today() - 30, due_on = lms.india_today() - 15`);
});
afterAll(async () => {
  await db.close();
});

describe('money over time', () => {
  it('collected is the counted payments received that India day, less any reversed', async () => {
    const mnc = await billedSchool(db, owner, 'MNC');
    const s = await subscribe(db, owner, mnc.org, 'standard', 10, await day(0));
    const y = await day(1);
    await pay(s.invoiceId, 10_000, y, 'UTR-ONE');
    const second = await pay(s.invoiceId, 5_000, y, 'UTR-TWO');
    await rpc(db, fresh(owner), 'billing_payment_reverse', { p_payment: second.paymentId, p_reason: 'recorded twice', p_env: 'TEST' });
    await compute(db, 1);
    expect(await figures(db, 'money.collected_paise', y)).toEqual({ '': 10_000 });
  });

  it("outstanding and overdue at a day's end: issued by then, not void by then, less counted payments received by then", async () => {
    const { total } = await invoice(sub.invoiceId);
    const t = Number(total);
    await compute(db, 20);
    expect(await figures(db, 'money.outstanding_paise', await day(20))).toEqual({ '': t });
    expect(await figures(db, 'money.overdue_paise', await day(20))).toEqual({ '': 0 });

    await pay(sub.invoiceId, 100_000, await day(5), 'UTR-PART');
    await compute(db, 1);
    expect(await figures(db, 'money.outstanding_paise', await day(1))).toEqual({ '': t - 100_000 });
    expect(await figures(db, 'money.overdue_paise', await day(1))).toEqual({ '': t - 100_000 });

    // A second school's invoice, issued ten days ago and voided three days ago.
    const mnv = await billedSchool(db, owner, 'MNV');
    const v = await subscribe(db, owner, mnv.org, 'standard', 10, await day(10));
    await backdate(v.invoiceId, `issued_on = lms.india_today() - 10, due_on = lms.india_today() - 5`);
    await rpc(db, fresh(owner), 'billing_invoice_void', { p_invoice: v.invoiceId, p_reason: 'sold in error', p_env: 'TEST', p_commit: true });
    await backdate(v.invoiceId, `voided_at = ${atIst(3, '12:00')}`);
    const vt = Number((await invoice(v.invoiceId)).total);
    await compute(db, 4);
    await compute(db, 2);
    expect(await figures(db, 'money.outstanding_paise', await day(4))).toEqual({ '': t - 100_000 + vt });
    expect(await figures(db, 'money.outstanding_paise', await day(2))).toEqual({ '': t - 100_000 });
  });

  it('payment notifications by result, counted by the day they arrived', async () => {
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('admin.session', 'on', true)`);
      for (const [ok, status] of [
        [true, 'processed'],
        [true, 'processed'],
        [false, 'signature_failed'],
      ] as const) {
        await tx.query(
          `insert into billing.webhook_event (received_at, body_sha256, body_length, signature_ok, status)
           values (${atIst(1, '11:00')}, repeat('a', 64), 10, $1, $2)`,
          [ok, status],
        );
      }
    });
    await compute(db, 1);
    expect(await figures(db, 'webhook.events', await day(1))).toEqual({ '': 3, processed: 2, signature_failed: 1 });
  });

  it('margin: the invoiced fee spread over its subscription\'s days, against the school\'s AI spend in the window, a floor when any call was unpriced', async () => {
    for (let n = 1; n <= 7; n++) {
      await putMetric(db, { day: await day(n), metric: 'spend.school_paise', org: mny.org, value: 1000 });
    }
    await putMetric(db, { day: await day(3), metric: 'spend.school_unpriced_calls', org: mny.org, value: 1 });
    const { rows } = await db.query<{ span: number }>(`select (ends_on - starts_on + 1) as span from billing.subscription where id = $1`, [
      sub.subscriptionId,
    ]);
    const fee = Math.floor((Number((await invoice(sub.invoiceId)).taxable) * 7) / rows[0].span);
    const view = await moneyView(aal2(owner), 7);
    expect(view.from).toBe(await day(7));
    expect(view.to).toBe(await day(1));
    expect(view.margin.find((m) => m.code === 'MNY')).toEqual({
      code: 'MNY',
      name: 'MNY Public School',
      feePaise: fee,
      costPaise: 7000,
      costIsFloor: true,
      marginPaise: fee - 7000,
      noFee: false,
      daysRolledUp: 7,
    });
  });

  it('a school with no subscription, a void invoice or a cancelled subscription earns no fee in the window', async () => {
    await buildSchool(db, 'PIL');
    await setLicence(db, 'PIL', 30, 60);
    const view = await moneyView(aal2(owner), 7);
    expect(view.margin.find((m) => m.code === 'PIL')).toMatchObject({ feePaise: 0, noFee: true });
    // MNV's only invoice is void and its subscription cancelled.
    expect(view.margin.find((m) => m.code === 'MNV')).toMatchObject({ feePaise: 0, noFee: true });
    expect(view.margin.map((m) => m.code)).toEqual([...view.margin.map((m) => m.code)].sort());
  });

  it('renewals ahead: thirteen weeks, non-pilot licences ending in each, valued at the latest subscription\'s seats times its seat price', async () => {
    const { rows } = await db.query<{ monday: string; third: string }>(
      `select date_trunc('week', lms.india_today()::timestamp)::date::text as monday,
              (date_trunc('week', lms.india_today()::timestamp)::date + 14)::text as third`,
    );
    await asService(db, (tx) => tx.query(`select lms.set_licence('MNY', 'standard', 100, $1::date + 3)`, [rows[0].third]));
    const view = await moneyView(aal2(owner), 30);
    expect(view.days).toBe(30);
    expect(view.renewals).toHaveLength(13);
    expect(view.renewals[0].weekStart).toBe(rows[0].monday);
    expect(view.renewals[2]).toEqual({ weekStart: rows[0].third, schools: 1, paiseAtCurrentPrice: 100 * 50_000 });
    expect(view.renewals.reduce((n, w) => n + w.schools, 0)).toBe(1);
  });

  it('money_view is for the owner, ops and finance; safety and a child are refused; days are 7 or 30', async () => {
    await expect(moneyView(aal2(ops))).resolves.toMatchObject({ days: 7 });
    await expect(moneyView(aal2(finance))).resolves.toMatchObject({ days: 7 });
    await expect(moneyView(aal2(safety))).rejects.toThrow('not allowed');
    await expect(moneyView({ sub: child, aal: 'aal2', is_anonymous: true })).rejects.toThrow('not allowed');
    await expect(moneyView(aal2(owner), 14)).rejects.toThrow('days is 7 or 30');
  });

  it('the Money page lists collected, outstanding and overdue; finance reads it', async () => {
    const s = await series(db, aal2(finance), 'money', 7);
    const keys = s.metrics.map((m) => m.key);
    for (const k of ['money.collected_paise', 'money.outstanding_paise', 'money.overdue_paise', 'spend.paise', 'spend.school_paise', 'prep.paise']) {
      expect(keys, k).toContain(k);
    }
  });
});
