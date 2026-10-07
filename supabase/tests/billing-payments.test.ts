// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { buildSchool } from './fixtures.ts';
import { billedSchool, makeFinance, readyPlan, readySeller, rpc, subscribe } from './billing-fixtures.ts';
import { freshDatabase, type JwtClaims } from './harness.ts';

/**
 * MONEY IN BY HAND, THE LICENCE FOLLOWS THE MONEY, VOID, AND THE PAYMENT
 * SIGNAL (migration 0058). Written first.
 *
 * Finance (or the owner) records a bank transfer or a cheque with a fresh
 * authenticator code, because a payment can set a licence (ruling R8). A fully
 * paid subscription invoice sets the school's licence and never shortens a
 * longer one. Only the owner voids, only with nothing paid.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let abc: { org: string; code: string };
let xyz: { org: string; code: string };
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
  abc = await billedSchool(db, ops, 'ABC');
  xyz = await billedSchool(db, ops, 'XYZ');
  today = (await db.query<{ d: string }>(`select to_char(lms.india_today(), 'YYYY-MM-DD') as d`)).rows[0].d;
});
afterAll(async () => {
  await db.close();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];

interface Recorded {
  paymentId: string;
  invoiceStatus: string;
  licenceSet: boolean;
}
const record = (
  claims: JwtClaims,
  invoice: string,
  amountPaise: number,
  over: Partial<{ source: string; receivedOn: string; reference: string }> = {},
) =>
  rpc<Recorded>(db, claims, 'billing_payment_record', {
    p_invoice: invoice,
    p_source: over.source ?? 'bank_transfer',
    p_amount_paise: amountPaise,
    p_received_on: over.receivedOn ?? today,
    p_reference: over.reference ?? `UTR${Math.random().toString().slice(2, 12)}`,
    p_reason: 'money arrived',
    p_env: 'TEST',
  });

const raise = (org: string, amountPaise: number, dueDays = 15) =>
  rpc<{ invoiceId: string; number: string }>(db, aal2(ops), 'billing_invoice_raise', {
    p_org: org,
    p_description: 'Teacher training day',
    p_amount_paise: amountPaise,
    p_due_days: dueDays,
    p_reason: 'test raise',
    p_env: 'TEST',
  });

const voidInvoice = (claims: JwtClaims, invoice: string, commit: boolean) =>
  rpc<{ openLinks: string[]; voided: boolean }>(db, claims, 'billing_invoice_void', {
    p_invoice: invoice,
    p_reason: 'raised by mistake',
    p_env: 'TEST',
    p_commit: commit,
  });

const invoice = (id: string) =>
  one<{ status: string; paid_paise: string; total_paise: string; paid_on: string | null }>(
    `select status, paid_paise::text, total_paise::text, to_char(paid_on, 'YYYY-MM-DD') as paid_on
       from billing.invoice where id = $1`,
    [id],
  );

const licence = (org: string) =>
  one<{ plan: string; seats: number; valid_until: string } | undefined>(
    `select plan, seats, to_char(valid_until, 'YYYY-MM-DD') as valid_until from lms.licence where org_id = $1`,
    [org],
  );

let abcSub: { subscriptionId: string; invoiceId: string; number: string };

describe('recording a payment by hand', () => {
  it('finance records a bank transfer with a fresh code; the owner may; ops and safety may not', async () => {
    abcSub = await subscribe(db, ops, abc.org, 'standard', 40, '2026-04-01');
    await expect(record(aal2(finance), abcSub.invoiceId, 1_180_000)).rejects.toThrow(/confirm with your authenticator code first/);
    const r = await record(fresh(finance), abcSub.invoiceId, 1_180_000);
    expect(r).toMatchObject({ invoiceStatus: 'partly_paid', licenceSet: false });
    expect(r.paymentId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(record(fresh(ops), abcSub.invoiceId, 1000)).rejects.toThrow(/not allowed/);
    await expect(record(fresh(safety), abcSub.invoiceId, 1000)).rejects.toThrow(/not allowed/);
    const ad = await raise(abc.org, 5000);
    expect((await record(fresh(owner), ad.invoiceId, 5900)).invoiceStatus).toBe('paid');
  });

  it('a part payment makes the invoice partly paid, the rest makes it paid with today\'s date', async () => {
    expect(await invoice(abcSub.invoiceId)).toMatchObject({ status: 'partly_paid', paid_paise: '1180000', paid_on: null });
    const r = await record(fresh(finance), abcSub.invoiceId, 1_180_000, { source: 'cheque' });
    expect(r).toMatchObject({ invoiceStatus: 'paid', licenceSet: true });
    expect(await invoice(abcSub.invoiceId)).toMatchObject({ status: 'paid', paid_paise: '2360000', paid_on: today });
  });

  it('refuses more than is due, a void or paid invoice, a future date, an unknown source and the same reference twice', async () => {
    const ad = await raise(xyz.org, 10_000);
    await expect(record(fresh(finance), ad.invoiceId, 11_801)).rejects.toThrow(/that is more than the 11800 paise still due/);
    await expect(record(fresh(finance), abcSub.invoiceId, 100)).rejects.toThrow(/this invoice is already paid/);
    await expect(record(fresh(finance), ad.invoiceId, 100, { receivedOn: '2099-01-01' })).rejects.toThrow(
      /a payment cannot be received in the future/,
    );
    await expect(record(fresh(finance), ad.invoiceId, 100, { source: 'upi' })).rejects.toThrow(
      /a payment by hand is a bank transfer or a cheque/,
    );
    await expect(record(fresh(finance), ad.invoiceId, 100, { source: 'cashfree_link' })).rejects.toThrow(
      /a payment by hand is a bank transfer or a cheque/,
    );
    await record(fresh(finance), ad.invoiceId, 100, { reference: 'CHQ 000123' });
    await expect(record(fresh(finance), ad.invoiceId, 100, { reference: 'CHQ 000123' })).rejects.toThrow(
      /this reference is already recorded for this invoice/,
    );
    const gone = await raise(xyz.org, 2000);
    await voidInvoice(fresh(owner), gone.invoiceId, true);
    await expect(record(fresh(finance), gone.invoiceId, 100)).rejects.toThrow(/this invoice is void/);
  });
});

describe('the licence follows the money', () => {
  it('a fully paid subscription invoice sets the school\'s licence: plan, seats and last day, and says who', async () => {
    expect(await licence(abc.org)).toEqual({ plan: 'standard', seats: 40, valid_until: '2027-03-31' });
    const a = await one<{ actor_name: string; actor_role: string; target_id: string }>(
      `select actor_name, actor_role, target_id from admin.audit_event where action = 'licence-from-payment'`,
    );
    expect(a).toEqual({ actor_name: 'Accounts', actor_role: 'finance', target_id: 'ABC' });
    const l = await one<{ n: number }>(
      `select count(*)::int as n from lms.audit_event where org_id = $1 and action = 'licence-set'`,
      [abc.org],
    );
    expect(l.n).toBe(1);
    const applied = await one<{ ok: boolean }>(
      `select licence_applied_at is not null as ok from billing.subscription where id = $1`,
      [abcSub.subscriptionId],
    );
    expect(applied.ok).toBe(true);
  });

  it('a late payment for an older period never shortens a longer licence', async () => {
    const later = await subscribe(db, ops, xyz.org, 'standard', 10, '2027-04-01');
    const earlier = await subscribe(db, ops, xyz.org, 'standard', 10, '2026-04-01');
    expect((await record(fresh(finance), later.invoiceId, 590_000)).licenceSet).toBe(true);
    expect((await licence(xyz.org))?.valid_until).toBe('2028-03-31');
    const r = await record(fresh(finance), earlier.invoiceId, 590_000);
    expect(r).toMatchObject({ invoiceStatus: 'paid', licenceSet: false });
    expect((await licence(xyz.org))?.valid_until).toBe('2028-03-31');
    const kept = await one<{ n: number }>(
      `select count(*)::int as n from admin.audit_event where action = 'licence-kept' and target_id = 'XYZ'`,
    );
    expect(kept.n).toBe(1);
  });

  it('an ad hoc invoice paid in full does not touch the licence', async () => {
    const before = await licence(abc.org);
    const ad = await raise(abc.org, 20_000);
    expect((await record(fresh(finance), ad.invoiceId, 23_600)).licenceSet).toBe(false);
    expect(await licence(abc.org)).toEqual(before);
  });

  it('a recorded payment is never edited or deleted, even by hand', async () => {
    await expect(db.query(`update billing.payment set amount_paise = 1`)).rejects.toThrow(/a recorded payment is not edited/);
    await expect(db.query(`delete from billing.payment`)).rejects.toThrow(/billing records are never deleted/);
  });
});

describe('void', () => {
  it('void is the owner\'s with a fresh code, only with nothing paid; the number stays used and the subscription is cancelled', async () => {
    const school = await billedSchool(db, ops, 'VOD');
    const s = await subscribe(db, ops, school.org, 'standard', 5, '2026-04-01');
    await expect(voidInvoice(fresh(finance), s.invoiceId, true)).rejects.toThrow(/not allowed/);
    await expect(voidInvoice(aal2(owner), s.invoiceId, true)).rejects.toThrow(/confirm with your authenticator code first/);
    const part = await raise(school.org, 10_000);
    await record(fresh(finance), part.invoiceId, 100);
    await expect(voidInvoice(fresh(owner), part.invoiceId, true)).rejects.toThrow(/an invoice with money on it cannot be void/);
    expect(await voidInvoice(fresh(owner), s.invoiceId, false)).toEqual({ openLinks: [], voided: false });
    expect((await invoice(s.invoiceId)).status).toBe('unpaid');
    expect(await voidInvoice(fresh(owner), s.invoiceId, true)).toEqual({ openLinks: [], voided: true });
    expect((await invoice(s.invoiceId)).status).toBe('void');
    const sub = await one<{ ok: boolean }>(`select cancelled_at is not null as ok from billing.subscription where id = $1`, [
      s.subscriptionId,
    ]);
    expect(sub.ok).toBe(true);
    await expect(voidInvoice(fresh(owner), s.invoiceId, true)).rejects.toThrow(/this invoice is already void/);
    const max = await one<{ n: number }>(`select max(seq)::int as n from billing.invoice`);
    const next = await raise(school.org, 1000);
    expect((await one<{ seq: number }>(`select seq from billing.invoice where id = $1`, [next.invoiceId])).seq).toBe(max.n + 1);
    // The cancelled subscription's days can be sold again.
    await subscribe(db, ops, school.org, 'standard', 6, '2026-04-01');
  });

  it('void waits for an open payment link to be cancelled', async () => {
    const ad = await raise(xyz.org, 3000);
    await db.query(
      `insert into billing.payment_link (invoice_id, attempt, link_id, amount_paise, status, expires_at)
       values ($1, 1, 'QRIE-test-link', 3540, 'active', now() + interval '30 days')`,
      [ad.invoiceId],
    );
    expect(await voidInvoice(fresh(owner), ad.invoiceId, false)).toEqual({ openLinks: ['QRIE-test-link'], voided: false });
    await expect(voidInvoice(fresh(owner), ad.invoiceId, true)).rejects.toThrow(/cancel the payment link first/);
    expect((await invoice(ad.invoiceId)).status).toBe('unpaid');
  });
});

describe('the audit trail and the list', () => {
  it('audit rows hold ids, amounts and a hash of the reference, never the reference', async () => {
    const ad = await raise(abc.org, 4000);
    await record(fresh(finance), ad.invoiceId, 4720, { reference: 'NEFT-SBIN-998877' });
    const row = await one<{ details: Record<string, unknown> }>(
      `select details from admin.audit_event where action = 'payment-recorded' order by id desc limit 1`,
    );
    expect(row.details.referenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.details).toMatchObject({ amountPaise: 4720, source: 'bank_transfer', invoiceStatus: 'paid' });
    expect(JSON.stringify(row.details)).not.toContain('NEFT-SBIN-998877');
  });

  it('the payments list is read by owner, ops and finance, newest first, and shows nothing refundable for money by hand', async () => {
    const list = await rpc<{ schoolCode: string; source: string; refundable: boolean; refundedPaise: number; recordedAs: string }[]>(
      db,
      aal2(ops),
      'billing_payments',
      { p_org: abc.org },
    );
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.every((p) => p.schoolCode === 'ABC' && !p.refundable && p.refundedPaise === 0)).toBe(true);
    expect(list[0].recordedAs).toBe('Accounts');
    await expect(rpc(db, aal2(safety), 'billing_payments', {})).rejects.toThrow(/not allowed/);
  });
});

describe('the payment signal', () => {
  const signal = (org: string, day: string) =>
    one<{ s: { level: string; reason: string } }>(`select billing.payment_signal_on($1, $2::date) as s`, [org, day]).then(
      (r) => r.s,
    );
  const plus = (day: string, n: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it('the payment signal is grey with no billing account', async () => {
    const { org } = await buildSchool(db, 'NOB');
    expect(await signal(org, today)).toEqual({ level: 'grey', reason: 'No billing account yet.' });
  });

  it('green when nothing is overdue', async () => {
    const school = await billedSchool(db, ops, 'GRN');
    expect(await signal(school.org, today)).toEqual({ level: 'green', reason: 'Nothing is overdue.' });
    await raise(school.org, 1000, 0);
    expect(await signal(school.org, today)).toEqual({ level: 'green', reason: 'Nothing is overdue.' });
  });

  it('amber 1 to 14 days overdue, red after 14', async () => {
    const school = await billedSchool(db, ops, 'LATE');
    const due = await raise(school.org, 1000, 0);
    expect(await signal(school.org, plus(today, 1))).toEqual({ level: 'amber', reason: 'An invoice is 1 day overdue.' });
    expect(await signal(school.org, plus(today, 14))).toEqual({ level: 'amber', reason: 'An invoice is 14 days overdue.' });
    expect(await signal(school.org, plus(today, 15))).toEqual({ level: 'red', reason: 'An invoice is 15 days overdue.' });
    await record(fresh(finance), due.invoiceId, 1180);
    expect(await signal(school.org, plus(today, 15))).toEqual({ level: 'green', reason: 'Nothing is overdue.' });
  });

  it('admin.school_payment_signal is not callable from a browser, and answers as payment_signal_on for today', async () => {
    const priv = await one<{ a: boolean; n: boolean }>(
      `select has_function_privilege('authenticated', 'admin.school_payment_signal(uuid)', 'execute') as a,
              has_function_privilege('anon', 'admin.school_payment_signal(uuid)', 'execute') as n`,
    );
    expect(priv).toEqual({ a: false, n: false });
    const r = await one<{ same: boolean }>(
      `select admin.school_payment_signal($1) = billing.payment_signal_on($1, lms.india_today()) as same`,
      [abc.org],
    );
    expect(r.same).toBe(true);
  });
});
