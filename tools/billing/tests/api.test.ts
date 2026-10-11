// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { billedSchool, makeFinance, readyPlan, readySeller, rpc, serviceRpc, subscribe } from '../../../supabase/tests/billing-fixtures.ts';
import { freshDatabase, type JwtClaims } from '../../../supabase/tests/harness.ts';
import { handleBillingApi, type BillingApiDeps } from '../src/api.ts';
import { RpcError } from '../src/rest.ts';
import { fakeCashfree, type FakeCashfree } from './fake-cashfree.ts';

/**
 * BILLING-API, THE ONLY CALLER OF CASHFREE (supabase/functions/billing-api).
 * Written first.
 *
 * Over the real migrations, with Cashfree faked. Every staff route asks the
 * database as the caller first (their own token), so a refusal happens before
 * Cashfree is asked anything; Cashfree's answers are recorded through the
 * service-role-only functions. /reconcile is the outside checker's, with its
 * own token, paced by the database.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let finance: { id: string; role: 'finance' };
let child: string;
let abc: { org: string; code: string };
const WEBHOOK_URL = 'https://p.supabase.co/functions/v1/cashfree-webhook';
const RECONCILE_TOKEN = 'test-reconcile-token';

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops');
  safety = await makeStaff(db, 'safety');
  finance = await makeFinance(db, 'Accounts');
  child = await anonymousChild(db);
  await readySeller(db, owner);
  await readyPlan(db, owner);
  abc = await billedSchool(db, ops, 'ABC');
});
afterAll(async () => {
  await db.close();
});

/** Test bearer tokens and the claims each stands for, made at the moment of the call. */
const TOKENS: Record<string, () => JwtClaims> = {
  'owner-fresh': () => fresh(owner),
  'owner-stale': () => aal2(owner),
  'owner-aal1': () => ({ sub: owner.id, aal: 'aal1' }),
  ops: () => aal2(ops),
  safety: () => aal2(safety),
  'finance-fresh': () => fresh(finance),
  'finance-stale': () => aal2(finance),
  child: () => ({ sub: child, aal: 'aal2', is_anonymous: true }),
};

function deps(cf: FakeCashfree, over: Partial<BillingApiDeps> = {}): BillingApiDeps & { serviceCalls: string[] } {
  const serviceCalls: string[] = [];
  return {
    serviceCalls,
    async userRpc(authorization, fn, args) {
      const claims = TOKENS[authorization.replace(/^Bearer /, '')];
      if (!claims) throw new RpcError('not allowed', 401);
      try {
        return await rpc(db, claims(), fn, args);
      } catch (e) {
        const message = (e as Error).message;
        throw new RpcError(message, /^not allowed|authenticator code|permission denied/.test(message) ? 403 : 400);
      }
    },
    async serviceRpc(fn, args) {
      serviceCalls.push(fn);
      try {
        return await serviceRpc(db, fn, args);
      } catch (e) {
        throw new RpcError((e as Error).message, 400);
      }
    },
    cashfree: cf.api,
    cashfreeEnv: 'sandbox',
    webhookUrl: WEBHOOK_URL,
    reconcileToken: RECONCILE_TOKEN,
    ...over,
  };
}

const call = (d: BillingApiDeps, route: string, token: string, body: unknown = {}, method = 'POST') =>
  handleBillingApi({ method, path: `/billing-api/${route}`, authorization: `Bearer ${token}`, body }, d);

const raise = async (amountPaise: number) =>
  rpc<{ invoiceId: string; number: string }>(db, aal2(ops), 'billing_invoice_raise', {
    p_org: abc.org,
    p_description: 'Teacher training day',
    p_amount_paise: amountPaise,
    p_due_days: 15,
    p_reason: 'test raise',
    p_env: 'TEST',
  });

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const linkRow = (linkId: string) =>
  one<{ id: string; status: string; url: string | null; cf_link_id: string | null }>(
    `select id, status, url, cf_link_id from billing.payment_link where link_id = $1`,
    [linkId],
  );
const invoiceStatus = async (id: string) =>
  (await one<{ status: string }>(`select status from billing.invoice where id = $1`, [id])).status;

/** A link made through /link, so the fake holds it too. */
async function sentLink(cf: FakeCashfree, invoiceId: string): Promise<string> {
  const out = await call(deps(cf), 'link', 'ops', { invoiceId, reason: 'send the link', env: 'TEST' });
  expect(out.status).toBe(200);
  return (out.body as { linkId: string }).linkId;
}

describe('/link', () => {
  let first: { subscriptionId: string; invoiceId: string; number: string };

  it('/link: ops gets a Cashfree link; Cashfree is asked once with the link id, the amount in rupees, the notes, notify_url and the idempotency key; the database holds the url, active', async () => {
    first = await subscribe(db, ops, abc.org, 'standard', 40, '2026-04-01');
    const cf = fakeCashfree();
    const out = await call(deps(cf), 'link', 'ops', { invoiceId: first.invoiceId, reason: 'send the link', env: 'TEST' });
    const linkId = first.number.replaceAll('/', '-');
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ linkId, existing: false, url: `https://payments-test.cashfree.com/links/${linkId.toLowerCase()}` });
    const creates = cf.calls.filter((c) => c.method === 'createLink');
    expect(creates).toHaveLength(1);
    const [body, key] = creates[0].args as [Record<string, unknown>, string];
    const row = await linkRow(linkId);
    expect(key).toBe(row.id);
    expect(body).toMatchObject({
      link_id: linkId,
      link_amount: 23600,
      link_currency: 'INR',
      link_purpose: `Qrie invoice ${first.number} for ABC Public School`,
      customer_details: { customer_phone: '9876543210', customer_email: 'accounts@school.example', customer_name: 'Meera Rao' },
      link_partial_payments: false,
      link_notes: { school: 'ABC', invoice: first.number },
      link_notify: { send_sms: false, send_email: true },
      link_meta: { notify_url: WEBHOOK_URL },
      link_auto_reminders: false,
    });
    expect(row).toMatchObject({ status: 'active', url: `https://payments-test.cashfree.com/links/${linkId.toLowerCase()}` });
  });

  it('/link again returns the open link without asking Cashfree', async () => {
    const cf = fakeCashfree();
    const out = await call(deps(cf), 'link', 'ops', { invoiceId: first.invoiceId, reason: 'send it again', env: 'TEST' });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ existing: true, linkId: first.number.replaceAll('/', '-') });
    expect(cf.calls).toEqual([]);
  });

  it('/link when Cashfree refuses: the row is failed, the answer is 502 with Cashfree\'s code, and nothing in it is the secret', async () => {
    const inv = await raise(10_000);
    const cf = fakeCashfree();
    cf.failNext(400, 'link_post_failed');
    const out = await call(deps(cf), 'link', 'ops', { invoiceId: inv.invoiceId, reason: 'send the link', env: 'TEST' });
    expect(out).toEqual({ status: 502, body: { error: 'Cashfree refused (link_post_failed).' } });
    expect((await linkRow(inv.number.replaceAll('/', '-'))).status).toBe('failed');
    expect(JSON.stringify(out)).not.toMatch(/secret|client/i);
  });

  it('/link when Cashfree does not answer leaves the link being made, and the next try reuses its idempotency key', async () => {
    const inv = await raise(10_000);
    const cf = fakeCashfree();
    cf.failNext(0, 'network');
    const out = await call(deps(cf), 'link', 'ops', { invoiceId: inv.invoiceId, reason: 'send the link', env: 'TEST' });
    expect(out.status).toBe(502);
    const linkId = inv.number.replaceAll('/', '-');
    const row = await linkRow(linkId);
    expect(row.status).toBe('creating');
    const again = await call(deps(cf), 'link', 'ops', { invoiceId: inv.invoiceId, reason: 'try again', env: 'TEST' });
    expect(again.status).toBe(200);
    const keys = cf.calls.filter((c) => c.method === 'createLink').map((c) => c.args[1]);
    expect(keys).toEqual([row.id, row.id]);
    expect((await linkRow(linkId)).status).toBe('active');
  });

  it('a child, an aal1 session and safety are refused before Cashfree is asked', async () => {
    const inv = await raise(10_000);
    const cf = fakeCashfree();
    for (const token of ['child', 'owner-aal1', 'safety']) {
      const out = await call(deps(cf), 'link', token, { invoiceId: inv.invoiceId, reason: 'send the link', env: 'TEST' });
      expect(out).toEqual({ status: 403, body: { error: 'not allowed' } });
    }
    expect((await handleBillingApi({ method: 'POST', path: '/billing-api/link', body: {} }, deps(cf))).status).toBe(401);
    expect(cf.calls).toEqual([]);
  });

  it('sandbox keys against a HOSTED database, or production keys against TEST, send nothing', async () => {
    const inv = await raise(10_000);
    const cf = fakeCashfree();
    const prod = await call(deps(cf, { cashfreeEnv: 'production' }), 'link', 'ops', { invoiceId: inv.invoiceId, reason: 'send', env: 'TEST' });
    expect(prod).toEqual({ status: 503, body: { error: 'Cashfree is set to production but this database is TEST; nothing was sent.' } });
    await db.query(`select admin.set_environment('HOSTED', true)`);
    try {
      const sandbox = await call(deps(cf), 'link', 'ops', { invoiceId: inv.invoiceId, reason: 'send', env: 'HOSTED' });
      expect(sandbox).toEqual({ status: 503, body: { error: 'Cashfree is set to sandbox but this database is HOSTED; nothing was sent.' } });
    } finally {
      await db.query(`select admin.set_environment('TEST', true)`);
    }
    expect(cf.calls).toEqual([]);
    expect(await one<{ n: number }>(`select count(*)::int as n from billing.payment_link where invoice_id = $1`, [inv.invoiceId])).toEqual({ n: 0 });
  });
});

describe('/check and /void', () => {
  it('/check reads the link and its paid orders and pays the invoice', async () => {
    const inv = await raise(20_000);
    const cf = fakeCashfree();
    const linkId = await sentLink(cf, inv.invoiceId);
    cf.pay(linkId, 'CF_checked', 23_600);
    const out = await call(deps(cf), 'check', 'ops', { invoiceId: inv.invoiceId });
    expect(out).toEqual({ status: 200, body: { checked: 1, changed: 1 } });
    expect(await invoiceStatus(inv.invoiceId)).toBe('paid');
    expect((await linkRow(linkId)).status).toBe('paid');
    expect(cf.calls.map((c) => c.method)).toEqual(['createLink', 'getLink', 'linkOrders']);
  });

  it('/check also reads a closed link whose money Cashfree reported and no payment accounts for, and records it', async () => {
    const inv = await raise(21_000);
    const cf = fakeCashfree();
    const linkId = await sentLink(cf, inv.invoiceId);
    cf.pay(linkId, 'CF_found_late', 24_780);
    // What a PAID report without its order leaves behind once the link was closed.
    await db.query(`update billing.payment_link set status = 'cancelled', amount_paid_paise = 24780 where link_id = $1`, [linkId]);
    const out = await call(deps(cf), 'check', 'ops', { invoiceId: inv.invoiceId });
    expect(out).toEqual({ status: 200, body: { checked: 1, changed: 1 } });
    expect(await invoiceStatus(inv.invoiceId)).toBe('paid');
    expect((await linkRow(linkId)).status).toBe('paid');
  });

  it('/void cancels an active link at Cashfree and then voids; money already on the link stops the void and is recorded', async () => {
    const a = await raise(30_000);
    const cf = fakeCashfree();
    const aLink = await sentLink(cf, a.invoiceId);
    const out = await call(deps(cf), 'void', 'owner-fresh', { invoiceId: a.invoiceId, reason: 'raised twice', env: 'TEST' });
    expect(out).toEqual({ status: 200, body: { voided: true } });
    expect(cf.links.get(aLink)?.link_status).toBe('CANCELLED');
    expect((await linkRow(aLink)).status).toBe('cancelled');
    expect(await invoiceStatus(a.invoiceId)).toBe('void');

    const b = await raise(40_000);
    const bLink = await sentLink(cf, b.invoiceId);
    cf.pay(bLink, 'CF_before_void', 47_200);
    const stopped = await call(deps(cf), 'void', 'owner-fresh', { invoiceId: b.invoiceId, reason: 'raised twice', env: 'TEST' });
    expect(stopped).toEqual({
      status: 409,
      body: { error: 'Money arrived on this link; the invoice was not voided. Refund it from Payments if needed.' },
    });
    expect(await invoiceStatus(b.invoiceId)).toBe('paid');
    expect(cf.calls.filter((c) => c.method === 'cancelLink').map((c) => c.args[0])).toEqual([aLink]);
  });

  it('/void without a fresh code answers with the authenticator message and asks Cashfree nothing', async () => {
    const inv = await raise(10_000);
    const cf = fakeCashfree();
    await sentLink(cf, inv.invoiceId);
    cf.calls.length = 0;
    const out = await call(deps(cf), 'void', 'owner-stale', { invoiceId: inv.invoiceId, reason: 'raised twice', env: 'TEST' });
    expect(out).toEqual({ status: 403, body: { error: 'confirm with your authenticator code first' } });
    expect(cf.calls).toEqual([]);
    expect(await invoiceStatus(inv.invoiceId)).toBe('unpaid');
  });
});

describe('/record', () => {
  const MONEY_ON_LINK =
    "Money arrived on this invoice's payment link; nothing was recorded by hand. Look at the invoice again before recording a payment.";
  const recordBody = (invoiceId: string, amountPaise: unknown, reference: string) => ({
    invoiceId,
    source: 'bank_transfer',
    amountPaise,
    receivedOn: new Date().toISOString().slice(0, 10),
    reference,
    reason: 'paid by transfer',
    env: 'TEST',
  });
  const handPayments = async (invoiceId: string) =>
    (
      await one<{ n: number }>(`select count(*)::int as n from billing.payment where invoice_id = $1 and source <> 'cashfree_link'`, [
        invoiceId,
      ])
    ).n;

  it('/record cancels the open link at Cashfree, then records the payment by hand; the next /link is for what stays due', async () => {
    const inv = await raise(100_000);
    const cf = fakeCashfree();
    const linkId = await sentLink(cf, inv.invoiceId);
    const out = await call(deps(cf), 'record', 'finance-fresh', recordBody(inv.invoiceId, 50_000, 'UTR-REC-1'));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ invoiceStatus: 'partly_paid', licenceSet: false, linksCancelled: 1 });
    expect(cf.links.get(linkId)?.link_status).toBe('CANCELLED');
    expect((await linkRow(linkId)).status).toBe('cancelled');
    expect(await invoiceStatus(inv.invoiceId)).toBe('partly_paid');
    const again = await call(deps(cf), 'link', 'ops', { invoiceId: inv.invoiceId, reason: 'the rest', env: 'TEST' });
    expect(again.body).toMatchObject({ linkId: `${linkId}-2`, existing: false });
    const made = cf.calls.filter((c) => c.method === 'createLink').at(-1)?.args[0] as { link_amount: number };
    expect(made.link_amount).toBe(680);
  });

  it('/record and /void wait while a link is still on its way to Cashfree, instead of marking it failed and going on', async () => {
    const IN_FLIGHT = 'A payment link for this invoice may still be on its way to Cashfree; nothing was changed. Try again in 10 minutes.';
    const inv = await raise(10_000);
    const cf = fakeCashfree();
    cf.failNext(0, 'network');
    expect((await call(deps(cf), 'link', 'ops', { invoiceId: inv.invoiceId, reason: 'send the link', env: 'TEST' })).status).toBe(502);
    const linkId = inv.number.replaceAll('/', '-');
    expect((await linkRow(linkId)).status).toBe('creating');
    const record = await call(deps(cf), 'record', 'finance-fresh', recordBody(inv.invoiceId, 11_800, 'UTR-FLIGHT-1'));
    expect(record).toEqual({ status: 409, body: { error: IN_FLIGHT } });
    const voided = await call(deps(cf), 'void', 'owner-fresh', { invoiceId: inv.invoiceId, reason: 'raised twice', env: 'TEST' });
    expect(voided).toEqual({ status: 409, body: { error: IN_FLIGHT } });
    expect((await linkRow(linkId)).status).toBe('creating');
    expect(await invoiceStatus(inv.invoiceId)).toBe('unpaid');
    expect(await handPayments(inv.invoiceId)).toBe(0);
    // Once it is no longer in flight and Cashfree still does not have it, it failed: the payment is recorded.
    await db.query(`update billing.payment_link set created_at = now() - interval '11 minutes' where link_id = $1`, [linkId]);
    const later = await call(deps(cf), 'record', 'finance-fresh', recordBody(inv.invoiceId, 11_800, 'UTR-FLIGHT-1'));
    expect(later).toMatchObject({ status: 200, body: { invoiceStatus: 'paid' } });
    expect((await linkRow(linkId)).status).toBe('failed');
  });

  it('/record with no open link records it without asking Cashfree', async () => {
    const inv = await raise(10_000);
    const cf = fakeCashfree();
    const out = await call(deps(cf), 'record', 'finance-fresh', recordBody(inv.invoiceId, 11_800, 'UTR-REC-2'));
    expect(out).toMatchObject({ status: 200, body: { invoiceStatus: 'paid', linksCancelled: 0 } });
    expect(cf.calls).toEqual([]);
  });

  it('/record when money already arrived on the link records that payment and nothing by hand', async () => {
    const inv = await raise(20_000);
    const cf = fakeCashfree();
    const linkId = await sentLink(cf, inv.invoiceId);
    cf.pay(linkId, 'CF_before_record', 23_600);
    const out = await call(deps(cf), 'record', 'finance-fresh', recordBody(inv.invoiceId, 23_600, 'UTR-REC-3'));
    expect(out).toEqual({ status: 409, body: { error: MONEY_ON_LINK } });
    expect(await invoiceStatus(inv.invoiceId)).toBe('paid');
    expect(await handPayments(inv.invoiceId)).toBe(0);
    expect(cf.calls.filter((c) => c.method === 'cancelLink')).toEqual([]);
  });

  it('/record when the school pays between the read and the cancel records that payment and nothing by hand', async () => {
    const inv = await raise(25_000);
    const cf = fakeCashfree();
    await sentLink(cf, inv.invoiceId);
    const cancel = cf.api.cancelLink;
    cf.api.cancelLink = async (id) => {
      cf.pay(id, 'CF_paid_in_between', 29_500);
      return cancel(id);
    };
    const out = await call(deps(cf), 'record', 'finance-fresh', recordBody(inv.invoiceId, 29_500, 'UTR-REC-4'));
    expect(out).toEqual({ status: 409, body: { error: MONEY_ON_LINK } });
    expect(await invoiceStatus(inv.invoiceId)).toBe('paid');
    expect(await handPayments(inv.invoiceId)).toBe(0);
  });

  it('/record without a fresh code, by ops, or without a whole amount asks Cashfree nothing', async () => {
    const inv = await raise(30_000);
    const cf = fakeCashfree();
    await sentLink(cf, inv.invoiceId);
    cf.calls.length = 0;
    expect(await call(deps(cf), 'record', 'finance-stale', recordBody(inv.invoiceId, 1000, 'UTR-REC-5'))).toEqual({
      status: 403,
      body: { error: 'confirm with your authenticator code first' },
    });
    expect((await call(deps(cf), 'record', 'ops', recordBody(inv.invoiceId, 1000, 'UTR-REC-5'))).status).toBe(403);
    expect(await call(deps(cf), 'record', 'finance-fresh', recordBody(inv.invoiceId, '1000', 'UTR-REC-5'))).toEqual({
      status: 400,
      body: { error: 'amountPaise is a whole number of paise above zero' },
    });
    expect(cf.calls).toEqual([]);
    expect(await invoiceStatus(inv.invoiceId)).toBe('unpaid');
  });
});

describe('/refund', () => {
  async function paidThroughLink(cf: FakeCashfree, amountPaise: number, orderId: string) {
    const inv = await raise(amountPaise);
    const linkId = await sentLink(cf, inv.invoiceId);
    const total = Math.round(amountPaise * 1.18);
    cf.pay(linkId, orderId, total);
    await call(deps(cf), 'check', 'ops', { invoiceId: inv.invoiceId });
    const pay = await one<{ id: string }>(`select id from billing.payment where cf_order_id = $1`, [orderId]);
    return { inv, payment: pay.id, total };
  }

  it('/refund: the owner with a fresh code; Cashfree\'s SUCCESS issues the credit note', async () => {
    const cf = fakeCashfree();
    const { payment } = await paidThroughLink(cf, 50_000, 'CF_refund_me');
    const out = await call(deps(cf), 'refund', 'owner-fresh', { paymentId: payment, amountPaise: 11_800, reason: 'overpaid', env: 'TEST' });
    expect(out.status).toBe(200);
    expect((out.body as { status: string }).status).toBe('success');
    expect((out.body as { creditNote: string }).creditNote).toMatch(/^QRCN\/\d\d-\d\d\/0001$/);
    const created = cf.calls.find((c) => c.method === 'createRefund');
    expect(created?.args[0]).toBe('CF_refund_me');
    expect(created?.args[1]).toMatchObject({ refund_amount: 118, refund_speed: 'STANDARD' });
    const ops403 = await call(deps(cf), 'refund', 'ops', { paymentId: payment, amountPaise: 100, reason: 'x', env: 'TEST' });
    expect(ops403.status).toBe(403);
  });

  it('/refund when Cashfree does not answer leaves the refund requested and says the hourly check will find out', async () => {
    const cf = fakeCashfree();
    const { payment } = await paidThroughLink(cf, 60_000, 'CF_refund_timeout');
    cf.failNext(0, 'network');
    const out = await call(deps(cf), 'refund', 'owner-fresh', { paymentId: payment, amountPaise: 1000, reason: 'overpaid', env: 'TEST' });
    expect(out).toEqual({ status: 502, body: { error: 'Cashfree did not answer; the hourly check will find out what happened.' } });
    const r = await one<{ status: string }>(`select status from billing.refund where payment_id = $1`, [payment]);
    expect(r.status).toBe('requested');
  });
});

describe('/reconcile', () => {
  it('/reconcile refuses a missing or wrong token without touching the database', async () => {
    const cf = fakeCashfree();
    for (const authorization of [undefined, 'Bearer wrong-token', `Basic ${RECONCILE_TOKEN}`, 'Bearer ops']) {
      const d = deps(cf);
      const spy = vi.fn(d.serviceRpc);
      const out = await handleBillingApi({ method: 'POST', path: '/billing-api/reconcile', authorization, body: {} }, { ...d, serviceRpc: spy });
      expect(out.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    }
    const off = await handleBillingApi(
      { method: 'POST', path: '/billing-api/reconcile', authorization: `Bearer ${RECONCILE_TOKEN}`, body: {} },
      deps(cf, { reconcileToken: '' }),
    );
    expect(off.status).toBe(404);
    expect(cf.calls).toEqual([]);
  });

  it('/reconcile runs at most once an hour, checks open links and pending refunds, and records what it did', async () => {
    const cf = fakeCashfree();
    const inv = await raise(70_000);
    const linkId = await sentLink(cf, inv.invoiceId);
    cf.pay(linkId, 'CF_by_reconcile', 82_600);
    // A refund Cashfree first answers PENDING, then finishes.
    const paidInv = await raise(80_000);
    const paidLink = await sentLink(cf, paidInv.invoiceId);
    cf.pay(paidLink, 'CF_pending_refund', 94_400);
    await call(deps(cf), 'check', 'ops', { invoiceId: paidInv.invoiceId });
    const payment = (await one<{ id: string }>(`select id from billing.payment where cf_order_id = 'CF_pending_refund'`)).id;
    cf.nextRefundStatus = 'PENDING';
    const asked = await call(deps(cf), 'refund', 'owner-fresh', { paymentId: payment, amountPaise: 2000, reason: 'overpaid', env: 'TEST' });
    expect((asked.body as { status: string }).status).toBe('pending');
    for (const r of cf.refunds.values()) r.refund_status = 'SUCCESS';

    const reconcile = () =>
      handleBillingApi({ method: 'POST', path: '/billing-api/reconcile', authorization: `Bearer ${RECONCILE_TOKEN}`, body: {} }, deps(cf));
    const out = await reconcile();
    expect(out.status).toBe(200);
    const result = out.body as { ran: boolean; checked: number; changed: number; failed: number };
    expect(result.ran).toBe(true);
    expect(result.changed).toBeGreaterThanOrEqual(2);
    expect(await invoiceStatus(inv.invoiceId)).toBe('paid');
    expect((await one<{ status: string }>(`select status from billing.refund where payment_id = $1`, [payment])).status).toBe('success');
    const done = await one<{ details: { checked: number; changed: number; failed: number } }>(
      `select details from admin.audit_event where action = 'billing-reconciled' order by id desc limit 1`,
    );
    expect(done.details).toEqual({ checked: result.checked, changed: result.changed, failed: result.failed });
    expect(await reconcile()).toEqual({ status: 200, body: { ran: false } });
  });

  it('/reconcile finishes a link whose creation answer was lost', async () => {
    const cf = fakeCashfree();
    const inv = await raise(90_000);
    const prep = await rpc<{ linkId: string; linkRowId: string; amountPaise: number }>(db, aal2(ops), 'billing_link_prepare', {
      p_invoice: inv.invoiceId,
      p_reason: 'send',
      p_env: 'TEST',
    });
    // Cashfree made it, but billing-api never heard back.
    await cf.api.createLink(
      {
        link_id: prep.linkId,
        link_amount: prep.amountPaise / 100,
        link_currency: 'INR',
        link_purpose: 'x',
        customer_details: { customer_phone: '9876543210' },
        link_partial_payments: false,
        link_expiry_time: '2026-12-31T23:59:59+05:30',
        link_notes: {},
        link_notify: { send_sms: false, send_email: false },
        link_meta: { notify_url: WEBHOOK_URL },
        link_auto_reminders: false,
      },
      prep.linkRowId,
    );
    await db.query(`update billing.payment_link set created_at = now() - interval '15 minutes' where link_id = $1`, [prep.linkId]);
    await db.query(`update admin.setting set value = to_jsonb((now() - interval '2 hours')::text) where key = 'billing_reconcile_started'`);
    const out = await handleBillingApi(
      { method: 'POST', path: '/billing-api/reconcile', authorization: `Bearer ${RECONCILE_TOKEN}`, body: {} },
      deps(cf),
    );
    expect((out.body as { ran: boolean }).ran).toBe(true);
    expect(await linkRow(prep.linkId)).toMatchObject({ status: 'active', url: `https://payments-test.cashfree.com/links/${prep.linkId.toLowerCase()}` });
  });
});

describe('routes', () => {
  it('an unknown route is 404 and a GET is 405', async () => {
    const cf = fakeCashfree();
    expect((await call(deps(cf), 'nope', 'ops')).status).toBe(404);
    expect((await call(deps(cf), 'link', 'ops', {}, 'GET')).status).toBe(405);
    expect((await call(deps(cf), 'link', 'ops', 'not an object')).status).toBe(400);
    expect((await call(deps(cf), 'link', 'ops', { reason: 'x', env: 'TEST' })).status).toBe(400);
  });
});
