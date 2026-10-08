// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { billedSchool, CONTACT, makeFinance, readyPlan, readySeller, rpc, subscribe } from './billing-fixtures.ts';
import { asService, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * CASHFREE'S SIDE, IN THE DATABASE (migration 0059). Written first.
 *
 * Payment links are prepared by the database before billing-api asks Cashfree
 * for them. A webhook event is stored once (by its key), keeps only the
 * whitelisted fields, and only ever moves a link or an invoice forward; a
 * payment counts only when its amount, currency and notes match (ruling R13).
 * Refunds are the owner's; a credit note follows Cashfree's SUCCESS. The
 * hourly reconciliation is paced by the database.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let abc: { org: string; code: string };
let fy: string;
let first: { subscriptionId: string; invoiceId: string; number: string };

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
  first = await subscribe(db, ops, abc.org, 'standard', 40, '2026-04-01');
  fy = (await db.query<{ fy: string }>(`select billing.fy_of(lms.india_today()) as fy`)).rows[0].fy;
});
afterAll(async () => {
  await db.close();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => (await one<{ n: number }>(sql, params)).n;
const hex64 = () => Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

/** An admin.* function as the service role, the way billing-api and the webhook call it. */
const service = <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const names = Object.keys(args);
  return asService(db, async (tx) => {
    const { rows } = await tx.query<{ v: T }>(
      `select admin.${fn}(${names.map((n, i) => `${n} => $${i + 1}${n === 'p_value' ? '::jsonb' : ''}`).join(', ')}) as v`,
      names.map((n) => (n === 'p_value' ? JSON.stringify(args[n]) : args[n])),
    );
    return rows[0].v;
  });
};

const ingest = (key: string, value: unknown) =>
  service<{ duplicate: boolean; status?: string }>('billing_webhook_ingest', {
    p_key: key,
    p_body_sha256: hex64(),
    p_body_length: 512,
    p_value: value,
  });

interface Prepared {
  linkRowId: string;
  linkId: string;
  amountPaise: number;
  currency: string;
  purpose: string;
  customer: { name: string; phone: string; email: string | null };
  notes: { school: string; invoice: string };
  expiresAt: string;
  sendEmail: boolean;
  existing: boolean;
  url?: string;
}
const prepare = (claims: JwtClaims, invoice: string) =>
  rpc<Prepared>(db, claims, 'billing_link_prepare', { p_invoice: invoice, p_reason: 'send', p_env: 'TEST' });

/** A link the way billing-api leaves it after Cashfree made it: active, with its URL. */
async function openLink(invoice: string): Promise<Prepared> {
  const p = await prepare(aal2(ops), invoice);
  await service('billing_link_created', {
    p_link_id: p.linkId,
    p_cf_link_id: '1576977',
    p_url: `https://payments.cashfree.com/links/${p.linkId}`,
    p_expires_at: null,
  });
  return p;
}

const raise = (org: string, amountPaise: number) =>
  rpc<{ invoiceId: string; number: string }>(db, aal2(ops), 'billing_invoice_raise', {
    p_org: org,
    p_description: 'Teacher training day',
    p_amount_paise: amountPaise,
    p_due_days: 15,
    p_reason: 'test raise',
    p_env: 'TEST',
  });

/** Task 6's extract of a payment-link event, for one link and one order. */
function linkEvent(o: {
  linkId: string;
  invoice: string;
  amountPaise: number;
  orderId?: string;
  status?: string;
  currency?: string;
  orderAmountPaise?: number;
}) {
  const status = o.status ?? 'PAID';
  return {
    type: 'PAYMENT_LINK_EVENT',
    eventTime: new Date().toISOString(),
    link: {
      linkId: o.linkId,
      cfLinkId: '1576977',
      status,
      amountPaise: o.amountPaise,
      amountPaidPaise: status === 'PAID' ? o.amountPaise : 0,
      currency: o.currency ?? 'INR',
      notes: { school: 'ABC', invoice: o.invoice },
    },
    order: o.orderId
      ? { orderId: o.orderId, amountPaise: o.orderAmountPaise ?? o.amountPaise, transactionId: '1021206', transactionStatus: 'SUCCESS' }
      : null,
  };
}

const invoiceStatus = async (id: string) =>
  (await one<{ status: string }>(`select status from billing.invoice where id = $1`, [id])).status;
const linkStatus = async (linkId: string) =>
  (await one<{ status: string }>(`select status from billing.payment_link where link_id = $1`, [linkId])).status;

let firstLink: Prepared;
let cashfreePayment: string;

describe('payment links', () => {
  it('ops prepares a link: id from the invoice number, the amount still due, school and invoice in the notes, the billing contact as customer', async () => {
    const p = await prepare(aal2(ops), first.invoiceId);
    firstLink = p;
    expect(p).toMatchObject({
      linkId: `QRIE-${fy}-0001`,
      amountPaise: 2_360_000,
      currency: 'INR',
      purpose: `Qrie invoice QRIE/${fy}/0001 for ABC Public School`,
      customer: { name: CONTACT.name, phone: CONTACT.phone, email: CONTACT.email },
      notes: { school: 'ABC', invoice: `QRIE/${fy}/0001` },
      sendEmail: true,
      existing: false,
    });
    expect(await linkStatus(p.linkId)).toBe('creating');
    const want = await one<{ e: string }>(
      `select to_char(((greatest(i.due_on, lms.india_today()) + 30)::timestamp + time '23:59:59'), 'YYYY-MM-DD"T"HH24:MI:SS"+05:30"') as e
         from billing.invoice i where i.id = $1`,
      [first.invoiceId],
    );
    expect(p.expiresAt).toBe(want.e);
  });

  it('a second prepare while one is open answers with that link; after a failed one the next is attempt 2', async () => {
    const again = await prepare(aal2(ops), first.invoiceId);
    expect(again).toMatchObject({ linkRowId: firstLink.linkRowId, existing: false });
    await service('billing_link_created', {
      p_link_id: firstLink.linkId,
      p_cf_link_id: '1576977',
      p_url: 'https://payments.cashfree.com/links/abc',
      p_expires_at: null,
    });
    expect(await prepare(aal2(ops), first.invoiceId)).toMatchObject({
      existing: true,
      linkId: firstLink.linkId,
      url: 'https://payments.cashfree.com/links/abc',
    });
    expect(await linkStatus(firstLink.linkId)).toBe('active');

    const other = await raise(abc.org, 10_000);
    const p1 = await prepare(aal2(ops), other.invoiceId);
    await service('billing_link_failed', { p_link_id: p1.linkId, p_why: 'link_post_failed' });
    expect(await linkStatus(p1.linkId)).toBe('failed');
    const p2 = await prepare(aal2(ops), other.invoiceId);
    expect(p2.linkId).toBe(`${p1.linkId}-2`);
    expect(p2.linkRowId).not.toBe(p1.linkRowId);
  });

  it('no link without the contact\'s phone, for a void or paid invoice, or for safety or finance', async () => {
    const nophone = await billedSchool(db, ops, 'NOPH', { phone: null });
    const inv = await raise(nophone.org, 5000);
    await expect(prepare(aal2(ops), inv.invoiceId)).rejects.toThrow(/add the billing contact's phone first/);
    const gone = await raise(abc.org, 5000);
    await rpc(db, fresh(owner), 'billing_invoice_void', { p_invoice: gone.invoiceId, p_reason: 'mistake', p_env: 'TEST', p_commit: true });
    await expect(prepare(aal2(ops), gone.invoiceId)).rejects.toThrow(/this invoice is void/);
    const paid = await raise(abc.org, 5000);
    await rpc(db, fresh(finance), 'billing_payment_record', {
      p_invoice: paid.invoiceId,
      p_source: 'bank_transfer',
      p_amount_paise: 5900,
      p_received_on: new Date().toISOString().slice(0, 10),
      p_reference: 'UTR-PAID-1',
      p_reason: 'paid by transfer',
      p_env: 'TEST',
    });
    await expect(prepare(aal2(ops), paid.invoiceId)).rejects.toThrow(/this invoice is already paid/);
    await expect(prepare(aal2(safety), first.invoiceId)).rejects.toThrow(/not allowed/);
    await expect(prepare(aal2(finance), first.invoiceId)).rejects.toThrow(/not allowed/);
  });

  it('link_created, link_failed and link_observed are the service role\'s alone', async () => {
    await expect(
      rpc(db, fresh(owner), 'billing_link_created', { p_link_id: 'x', p_cf_link_id: '1', p_url: 'https://x', p_expires_at: null }),
    ).rejects.toThrow(/permission denied/);
    await expect(rpc(db, fresh(owner), 'billing_link_failed', { p_link_id: 'x', p_why: 'x' })).rejects.toThrow(/permission denied/);
    await expect(rpc(db, fresh(owner), 'billing_link_observed', { p_link_id: 'x', p_value: {} })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('webhook events', () => {
  it('a PAID event for the whole amount pays the invoice and sets the licence, in Cashfree\'s name', async () => {
    const ev = linkEvent({ linkId: firstLink.linkId, invoice: firstLink.notes.invoice, amountPaise: 2_360_000, orderId: 'CFPay_first' });
    expect(await ingest('key-first', ev)).toEqual({ duplicate: false, status: 'processed' });
    expect(await invoiceStatus(first.invoiceId)).toBe('paid');
    expect(await linkStatus(firstLink.linkId)).toBe('paid');
    const pay = await one<{ id: string; counted: boolean; recorded_as: string; cf_order_id: string; amount_paise: string }>(
      `select id, counted, recorded_as, cf_order_id, amount_paise::text from billing.payment where cf_order_id = 'CFPay_first'`,
    );
    cashfreePayment = pay.id;
    expect(pay).toMatchObject({ counted: true, recorded_as: 'Cashfree', amount_paise: '2360000' });
    const a = await one<{ actor_name: string; actor_role: string }>(
      `select actor_name, actor_role from admin.audit_event where action = 'licence-from-payment'`,
    );
    expect(a).toEqual({ actor_name: 'Cashfree', actor_role: 'service' });
    const lic = await one<{ valid_until: string }>(
      `select to_char(valid_until, 'YYYY-MM-DD') as valid_until from lms.licence where org_id = $1`,
      [abc.org],
    );
    expect(lic.valid_until).toBe('2027-03-31');
    const row = await one<{ status: string; processed: boolean }>(
      `select status, processed_at is not null as processed from billing.webhook_event where idem_key = 'key-first'`,
    );
    expect(row).toEqual({ status: 'processed', processed: true });
  });

  it('the same delivery twice is stored once and pays once', async () => {
    const ev = linkEvent({ linkId: firstLink.linkId, invoice: firstLink.notes.invoice, amountPaise: 2_360_000, orderId: 'CFPay_first' });
    expect(await ingest('key-first', ev)).toEqual({ duplicate: true });
    expect(await count(`select count(*)::int as n from billing.payment where cf_order_id = 'CFPay_first'`)).toBe(1);
    expect(await count(`select count(*)::int as n from billing.webhook_event where idem_key = 'key-first'`)).toBe(1);
  });

  it('a second event with another key for the same order pays once', async () => {
    const ev = linkEvent({ linkId: firstLink.linkId, invoice: firstLink.notes.invoice, amountPaise: 2_360_000, orderId: 'CFPay_first' });
    expect(await ingest('key-first-again', ev)).toEqual({ duplicate: false, status: 'processed' });
    expect(await count(`select count(*)::int as n from billing.payment where cf_order_id = 'CFPay_first'`)).toBe(1);
    expect(
      (await one<{ paid_paise: string }>(`select paid_paise::text from billing.invoice where id = $1`, [first.invoiceId])).paid_paise,
    ).toBe('2360000');
  });

  it('out of order, an EXPIRED after PAID leaves the link and the invoice paid', async () => {
    const ev = linkEvent({ linkId: firstLink.linkId, invoice: firstLink.notes.invoice, amountPaise: 2_360_000, status: 'EXPIRED' });
    expect(await ingest('key-first-expired', ev)).toEqual({ duplicate: false, status: 'processed' });
    expect(await linkStatus(firstLink.linkId)).toBe('paid');
    expect(await invoiceStatus(first.invoiceId)).toBe('paid');
  });

  it('an amount, currency or notes that do not match are stored, not counted, and marked mismatch', async () => {
    const inv = await raise(abc.org, 100_000);
    const l = await openLink(inv.invoiceId);
    const cases: [string, Parameters<typeof linkEvent>[0], string][] = [
      ['mm-amount', { linkId: l.linkId, invoice: inv.number, amountPaise: 118_000, orderId: 'CF_mm_amount', orderAmountPaise: 117_999 }, "the amount is not the link's amount"],
      ['mm-currency', { linkId: l.linkId, invoice: inv.number, amountPaise: 118_000, orderId: 'CF_mm_currency', currency: 'USD' }, 'the currency is not INR'],
      ['mm-notes', { linkId: l.linkId, invoice: `QRIE/${fy}/9999`, amountPaise: 118_000, orderId: 'CF_mm_notes' }, 'the notes name another invoice'],
    ];
    for (const [key, ev, why] of cases) {
      expect(await ingest(key, linkEvent(ev))).toEqual({ duplicate: false, status: 'mismatch' });
      const p = await one<{ counted: boolean; not_counted_why: string }>(
        `select counted, not_counted_why from billing.payment where cf_order_id = $1`,
        [ev.orderId],
      );
      expect(p).toEqual({ counted: false, not_counted_why: why });
      const e = await one<{ detail: string }>(`select detail from billing.webhook_event where idem_key = $1`, [key]);
      expect(e.detail).toBe(why);
    }
    expect(await invoiceStatus(inv.invoiceId)).toBe('unpaid');
  });

  it('money on a void invoice is stored, not counted, and needs a refund', async () => {
    const inv = await raise(abc.org, 20_000);
    const l = await openLink(inv.invoiceId);
    await db.query(`update billing.payment_link set status = 'cancelled' where link_id = $1`, [l.linkId]);
    await rpc(db, fresh(owner), 'billing_invoice_void', { p_invoice: inv.invoiceId, p_reason: 'school left', p_env: 'TEST', p_commit: true });
    await ingest('void-paid', linkEvent({ linkId: l.linkId, invoice: inv.number, amountPaise: 23_600, orderId: 'CF_void' }));
    const p = await one<{ id: string; counted: boolean; not_counted_why: string }>(
      `select id, counted, not_counted_why from billing.payment where cf_order_id = 'CF_void'`,
    );
    expect(p).toMatchObject({ counted: false, not_counted_why: 'the invoice was void' });
    const list = await rpc<{ id: string; refundable: boolean }[]>(db, aal2(finance), 'billing_payments', {});
    expect(list.find((x) => x.id === p.id)?.refundable).toBe(true);
    expect(await invoiceStatus(inv.invoiceId)).toBe('void');
  });

  it('an event for a link Qrie did not make is stored and ignored', async () => {
    expect(await ingest('stranger', linkEvent({ linkId: 'NOT-OURS-1', invoice: 'x', amountPaise: 100, orderId: 'CF_stranger' }))).toEqual({
      duplicate: false,
      status: 'ignored',
    });
    expect(await count(`select count(*)::int as n from billing.payment where cf_order_id = 'CF_stranger'`)).toBe(0);
  });

  it('a body that was not JSON is stored as unparsed', async () => {
    expect(await ingest('garbled', { unparsed: true })).toEqual({ duplicate: false, status: 'unparsed' });
    const row = await one<{ status: string; payload: unknown }>(`select status, payload from billing.webhook_event where idem_key = 'garbled'`);
    expect(row).toEqual({ status: 'unparsed', payload: { unparsed: true } });
  });

  it('the stored event keeps only the whitelisted fields', async () => {
    const ev = {
      ...linkEvent({ linkId: 'NOT-OURS-2', invoice: 'x', amountPaise: 100, orderId: 'CF_pii' }),
      customer_details: { customer_phone: '9876543210', customer_email: 'parent@example.com' },
    } as Record<string, unknown>;
    (ev.link as Record<string, unknown>).customer = { customer_phone: '9876543210' };
    (ev.link as Record<string, unknown>).link_url = 'https://payments.cashfree.com/links/secret';
    await ingest('pii', ev);
    const row = await one<{ t: string }>(`select payload::text as t from billing.webhook_event where idem_key = 'pii'`);
    expect(row.t).not.toContain('9876543210');
    expect(row.t).not.toContain('parent@example.com');
    expect(row.t).not.toContain('secret');
    expect(row.t).toContain('NOT-OURS-2');
  });

  it('a signature failure is stored with its hash and length only', async () => {
    const sha = hex64();
    await service('billing_signature_failed', { p_body_sha256: sha, p_body_length: 120, p_why: 'mismatch' });
    const row = await one<Record<string, unknown>>(
      `select signature_ok, status, payload, idem_key, body_length, detail from billing.webhook_event where body_sha256 = $1`,
      [sha],
    );
    expect(row).toEqual({ signature_ok: false, status: 'signature_failed', payload: {}, idem_key: null, body_length: 120, detail: 'mismatch' });
  });
});

describe('refunds', () => {
  let refund: { refundRowId: string; refundId: string; orderId: string; amountPaise: number; note: string };

  it('the owner, with a fresh code, asks for a refund of up to what is left; finance and ops may not', async () => {
    const ask = (claims: JwtClaims, amountPaise: number) =>
      rpc<typeof refund>(db, claims, 'billing_refund_prepare', {
        p_payment: cashfreePayment,
        p_amount_paise: amountPaise,
        p_reason: 'school overpaid',
        p_env: 'TEST',
      });
    await expect(ask(fresh(finance), 1000)).rejects.toThrow(/not allowed/);
    await expect(ask(fresh(ops), 1000)).rejects.toThrow(/not allowed/);
    await expect(ask(aal2(owner), 1000)).rejects.toThrow(/confirm with your authenticator code first/);
    refund = await ask(fresh(owner), 1_000_000);
    expect(refund).toMatchObject({ orderId: 'CFPay_first', amountPaise: 1_000_000, note: `Refund for QRIE/${fy}/0001` });
    expect(refund.refundId).toMatch(/^qrierf[0-9a-f]{32}$/);
    await expect(ask(fresh(owner), 1_400_000)).rejects.toThrow(/at most 1360000 paise can still be refunded/);
  });

  it('SUCCESS issues one credit note, QRCN/<fy>/0001, with its tax share; a later PENDING changes nothing', async () => {
    const r = await service<{ status: string; creditNote: string | null }>('billing_refund_result', {
      p_refund_id: refund.refundId,
      p_value: { status: 'SUCCESS', cfRefundId: '1' },
    });
    expect(r).toEqual({ status: 'success', creditNote: `QRCN/${fy}/0001` });
    const note = await one<{ amount_paise: string; tax_paise: string; taxable_paise: string }>(
      `select amount_paise::text, tax_paise::text, taxable_paise::text from billing.credit_note`,
    );
    // 1000000 x 360000 / 2360000 = 152542.37, half-up to 152542.
    expect(note).toEqual({ amount_paise: '1000000', tax_paise: '152542', taxable_paise: '847458' });
    await service('billing_refund_result', { p_refund_id: refund.refundId, p_value: { status: 'SUCCESS', cfRefundId: '1' } });
    expect(await count(`select count(*)::int as n from billing.credit_note`)).toBe(1);
    expect(
      await service<{ status: string }>('billing_refund_result', { p_refund_id: refund.refundId, p_value: { status: 'PENDING' } }),
    ).toMatchObject({ status: 'success' });
    const other = await rpc<typeof refund>(db, fresh(owner), 'billing_refund_prepare', {
      p_payment: cashfreePayment,
      p_amount_paise: 100_000,
      p_reason: 'a second refund',
      p_env: 'TEST',
    });
    expect(
      await service<{ status: string; creditNote: string | null }>('billing_refund_result', {
        p_refund_id: other.refundId,
        p_value: { status: 'REJECTED' },
      }),
    ).toEqual({ status: 'failed', creditNote: null });
    expect(await count(`select count(*)::int as n from billing.credit_note`)).toBe(1);
    // The licence and the invoice's paid amount do not change on a refund (ruling R18).
    expect(await invoiceStatus(first.invoiceId)).toBe('paid');
  });

  it('a payment made by hand cannot be refunded here', async () => {
    const byHand = await one<{ id: string }>(`select id from billing.payment where source = 'bank_transfer' limit 1`);
    await expect(
      rpc(db, fresh(owner), 'billing_refund_prepare', { p_payment: byHand.id, p_amount_paise: 100, p_reason: 'test', p_env: 'TEST' }),
    ).rejects.toThrow(/only a payment made through a Cashfree link can be refunded here/);
  });
});

describe('reconciliation', () => {
  it('due at most once in 55 minutes', async () => {
    const d1 = await service<{ due: boolean; links: { linkId: string }[]; refunds: unknown[] }>('billing_reconcile_due', {});
    expect(d1.due).toBe(true);
    expect(d1.links.length).toBeGreaterThan(0);
    expect(Array.isArray(d1.refunds)).toBe(true);
    expect(await service('billing_reconcile_due', {})).toEqual({ due: false });
    await db.query(
      `update admin.setting set value = to_jsonb((now() - interval '61 minutes')::text) where key = 'billing_reconcile_started'`,
    );
    expect((await service<{ due: boolean }>('billing_reconcile_due', {})).due).toBe(true);
    expect((await service<{ due: boolean }>('billing_reconcile_due', { p_force: true })).due).toBe(true);
  });

  it('an observed link pays the invoice exactly as a webhook would', async () => {
    const inv = await raise(abc.org, 50_000);
    const l = await openLink(inv.invoiceId);
    const seen = { status: 'PAID', amountPaidPaise: 59_000, currency: 'INR', orders: [{ orderId: 'CF_observed', amountPaise: 59_000, status: 'PAID' }] };
    expect(await service('billing_link_observed', { p_link_id: l.linkId, p_value: seen })).toEqual({
      changed: true,
      counted: 1,
      mismatched: 0,
    });
    expect(await invoiceStatus(inv.invoiceId)).toBe('paid');
    expect(await linkStatus(l.linkId)).toBe('paid');
    expect(await service('billing_link_observed', { p_link_id: l.linkId, p_value: seen })).toEqual({
      changed: false,
      counted: 0,
      mismatched: 0,
    });
  });

  it('done records the time and the counts', async () => {
    await service('billing_reconcile_done', { p_value: { checked: 3, changed: 1, failed: 0, extra: 'dropped' } });
    expect(await count(`select count(*)::int as n from admin.setting where key = 'billing_reconciled_at'`)).toBe(1);
    const a = await one<{ actor_role: string; details: unknown }>(
      `select actor_role, details from admin.audit_event where action = 'billing-reconciled' order by id desc limit 1`,
    );
    expect(a).toEqual({ actor_role: 'service', details: { checked: 3, changed: 1, failed: 0 } });
  });

  it('the webhook log lists problems first and never a customer', async () => {
    const problems = await rpc<Record<string, unknown>[]>(db, aal2(finance), 'billing_webhook_log', { p_problems: true });
    expect(problems.length).toBeGreaterThanOrEqual(5);
    expect(new Set(problems.map((p) => p.status))).toEqual(new Set(['signature_failed', 'mismatch', 'unparsed']));
    for (const p of problems) {
      expect(Object.keys(p).sort()).toEqual(['detail', 'eventType', 'id', 'linkId', 'orderId', 'receivedAt', 'status']);
    }
    const all = await rpc<Record<string, unknown>[]>(db, aal2(ops), 'billing_webhook_log', {});
    expect(all.length).toBeGreaterThan(problems.length);
    expect(JSON.stringify(all)).not.toContain('9876543210');
    await expect(rpc(db, aal2(safety), 'billing_webhook_log', {})).rejects.toThrow(/not allowed/);
  });
});

describe('money Cashfree reports that no stored payment accounts for', () => {
  const NOT_RECORDED = 'Cashfree says this link is paid, but no payment for it was recorded; the hourly check reads it again.';
  const attention = async () =>
    (await rpc<{ attention: { linksUnrecorded: number } }>(db, aal2(finance), 'billing_overview', {})).attention.linksUnrecorded;
  const dueLinks = async () =>
    (await service<{ links: { linkId: string }[] }>('billing_reconcile_due', { p_force: true })).links.map((l) => l.linkId);
  const linkOnPage = async (invoiceId: string, linkId: string) =>
    (await rpc<{ links: { linkId: string; unrecordedPaise: number }[] }>(db, aal2(finance), 'billing_invoice', { p_invoice: invoiceId })).links.find(
      (x) => x.linkId === linkId,
    );

  it('a PAID event without an order keeps the link open, is marked mismatch, and is counted until it is found', async () => {
    const before = await attention();
    const inv = await raise(abc.org, 30_000);
    const l = await openLink(inv.invoiceId);
    expect(await ingest('unrecorded-no-order', linkEvent({ linkId: l.linkId, invoice: inv.number, amountPaise: 35_400 }))).toEqual({
      duplicate: false,
      status: 'mismatch',
    });
    expect((await one<{ detail: string }>(`select detail from billing.webhook_event where idem_key = 'unrecorded-no-order'`)).detail).toBe(
      NOT_RECORDED,
    );
    expect(await linkStatus(l.linkId)).toBe('active');
    expect(await invoiceStatus(inv.invoiceId)).toBe('unpaid');
    expect(await dueLinks()).toContain(l.linkId);
    expect((await attention()) - before).toBe(1);
    expect(await linkOnPage(inv.invoiceId, l.linkId)).toMatchObject({ unrecordedPaise: 35_400 });
    // No second link is made for an invoice whose link Cashfree says is paid.
    expect(await prepare(aal2(ops), inv.invoiceId)).toMatchObject({ existing: true, linkId: l.linkId });
  });

  it('a PAID event whose order is not SUCCESS is not counted, and the link stays open', async () => {
    const inv = await raise(abc.org, 31_000);
    const l = await openLink(inv.invoiceId);
    const ev = linkEvent({ linkId: l.linkId, invoice: inv.number, amountPaise: 36_580, orderId: 'CF_not_success' });
    const odd = { ...ev, order: { ...ev.order, transactionStatus: 'PAID' } };
    expect(await ingest('unrecorded-not-success', odd)).toEqual({ duplicate: false, status: 'mismatch' });
    expect(await linkStatus(l.linkId)).toBe('active');
    expect(await invoiceStatus(inv.invoiceId)).toBe('unpaid');
    expect(await dueLinks()).toContain(l.linkId);
  });

  it('an observed PAID link whose orders are not PAID stays open until a paid order is found, then pays the invoice', async () => {
    const inv = await raise(abc.org, 32_000);
    const l = await openLink(inv.invoiceId);
    const seen = (status: string) => ({
      status: 'PAID',
      amountPaidPaise: 37_760,
      currency: 'INR',
      orders: [{ orderId: 'CF_observed_late', amountPaise: 37_760, status }],
    });
    await service('billing_link_observed', { p_link_id: l.linkId, p_value: seen('SUCCESS') });
    expect(await linkStatus(l.linkId)).toBe('active');
    expect(await invoiceStatus(inv.invoiceId)).toBe('unpaid');
    expect(await dueLinks()).toContain(l.linkId);
    expect(await linkOnPage(inv.invoiceId, l.linkId)).toMatchObject({ unrecordedPaise: 37_760 });
    await service('billing_link_observed', { p_link_id: l.linkId, p_value: seen('PAID') });
    expect(await linkStatus(l.linkId)).toBe('paid');
    expect(await invoiceStatus(inv.invoiceId)).toBe('paid');
    expect(await dueLinks()).not.toContain(l.linkId);
    expect(await linkOnPage(inv.invoiceId, l.linkId)).toMatchObject({ unrecordedPaise: 0 });
  });

  it('money reported on a closed link is still read by reconciliation, and stops a new link, a payment by hand and a void', async () => {
    const inv = await raise(abc.org, 33_000);
    const l = await openLink(inv.invoiceId);
    await db.query(`update billing.payment_link set status = 'cancelled' where link_id = $1`, [l.linkId]);
    expect(await ingest('unrecorded-closed', linkEvent({ linkId: l.linkId, invoice: inv.number, amountPaise: 38_940 }))).toEqual({
      duplicate: false,
      status: 'mismatch',
    });
    expect(await linkStatus(l.linkId)).toBe('cancelled');
    expect(await dueLinks()).toContain(l.linkId);
    const notYet = /Cashfree reports money on this invoice's payment link that is not recorded yet; check with Cashfree first/;
    await expect(prepare(aal2(ops), inv.invoiceId)).rejects.toThrow(notYet);
    await expect(
      rpc(db, fresh(finance), 'billing_payment_record', {
        p_invoice: inv.invoiceId,
        p_source: 'bank_transfer',
        p_amount_paise: 1000,
        p_received_on: new Date().toISOString().slice(0, 10),
        p_reference: 'UTR-UNRECORDED-1',
        p_reason: 'paid by transfer',
        p_env: 'TEST',
      }),
    ).rejects.toThrow(notYet);
    await expect(
      rpc(db, fresh(owner), 'billing_invoice_void', { p_invoice: inv.invoiceId, p_reason: 'mistake', p_env: 'TEST', p_commit: true }),
    ).rejects.toThrow(notYet);
    expect(await invoiceStatus(inv.invoiceId)).toBe('unpaid');
  });
});

describe('a payment by hand and an open payment link', () => {
  const byHand = (invoiceId: string, amountPaise: number, reference: string, commit?: boolean) =>
    rpc<{ openLinks?: string[]; recorded?: boolean; invoiceStatus?: string }>(db, fresh(finance), 'billing_payment_record', {
      p_invoice: invoiceId,
      p_source: 'bank_transfer',
      p_amount_paise: amountPaise,
      p_received_on: new Date().toISOString().slice(0, 10),
      p_reference: reference,
      p_reason: 'paid by transfer',
      p_env: 'TEST',
      p_commit: commit,
    });
  const paid = async (id: string) =>
    (await one<{ paid_paise: string }>(`select paid_paise::text from billing.invoice where id = $1`, [id])).paid_paise;
  let inv: { invoiceId: string; number: string };
  let old: Prepared;

  it('is refused while the invoice has an open link; a dry run checks everything else and names the links to cancel first', async () => {
    inv = await raise(abc.org, 100_000);
    old = await openLink(inv.invoiceId);
    await expect(byHand(inv.invoiceId, 50_000, 'UTR-OPEN-1')).rejects.toThrow(
      /this invoice's payment link is still open: record the payment from the invoice again, which cancels the link at Cashfree first/,
    );
    expect(await byHand(inv.invoiceId, 50_000, 'UTR-OPEN-1', false)).toEqual({ openLinks: [old.linkId], recorded: false });
    expect(await count(`select count(*)::int as n from billing.payment where invoice_id = $1`, [inv.invoiceId])).toBe(0);
    await expect(byHand(inv.invoiceId, 118_001, 'UTR-OPEN-1', false)).rejects.toThrow(/that is more than the 118000 paise still due/);
    await expect(
      rpc(db, aal2(finance), 'billing_payment_record', {
        p_invoice: inv.invoiceId,
        p_source: 'bank_transfer',
        p_amount_paise: 50_000,
        p_received_on: new Date().toISOString().slice(0, 10),
        p_reference: 'UTR-OPEN-1',
        p_reason: 'paid by transfer',
        p_env: 'TEST',
        p_commit: false,
      }),
    ).rejects.toThrow(/confirm with your authenticator code first/);
    expect(await linkStatus(old.linkId)).toBe('active');
  });

  it('once the link is cancelled the payment is recorded, and the next link is for what stays due', async () => {
    await service('billing_link_observed', {
      p_link_id: old.linkId,
      p_value: { status: 'CANCELLED', amountPaidPaise: 0, currency: 'INR', orders: [] },
    });
    expect(await linkStatus(old.linkId)).toBe('cancelled');
    expect(await byHand(inv.invoiceId, 50_000, 'UTR-OPEN-1')).toMatchObject({ invoiceStatus: 'partly_paid' });
    const next = await prepare(aal2(ops), inv.invoiceId);
    expect(next).toMatchObject({ existing: false, linkId: `${old.linkId}-2`, amountPaise: 68_000 });
    // A dry run names a duplicate reference before Cashfree is asked anything.
    await expect(byHand(inv.invoiceId, 1000, 'UTR-OPEN-1', false)).rejects.toThrow(/this reference is already recorded for this invoice/);
  });

  it('money paid later on the cancelled old link is stored, not counted, flagged and refundable: never lost', async () => {
    const before = (await rpc<{ attention: { notCounted: number } }>(db, aal2(finance), 'billing_overview', {})).attention.notCounted;
    expect(
      await ingest('paid-old-link', linkEvent({ linkId: old.linkId, invoice: inv.number, amountPaise: 118_000, orderId: 'CF_old_link' })),
    ).toEqual({ duplicate: false, status: 'mismatch' });
    const p = await one<{ id: string; counted: boolean; not_counted_why: string }>(
      `select id, counted, not_counted_why from billing.payment where cf_order_id = 'CF_old_link'`,
    );
    expect(p).toMatchObject({ counted: false, not_counted_why: 'more than is still due' });
    expect(await paid(inv.invoiceId)).toBe('50000');
    expect(await invoiceStatus(inv.invoiceId)).toBe('partly_paid');
    expect(await linkStatus(old.linkId)).toBe('paid');
    const list = await rpc<{ id: string; refundable: boolean }[]>(db, aal2(finance), 'billing_payments', {});
    expect(list.find((x) => x.id === p.id)?.refundable).toBe(true);
    expect((await rpc<{ attention: { notCounted: number } }>(db, aal2(finance), 'billing_overview', {})).attention.notCounted - before).toBe(1);
  });
});
