// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { billedSchool, makeFinance, readyPlan, readySeller } from '../../../supabase/tests/billing-fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import {
  AdminError,
  billingApiFetch,
  createAdminClient,
  createBillingClient,
  pgliteAdminTransport,
  type AdminClaims,
  type BillingApi,
} from '../src/index.ts';

/**
 * THE BILLING CLIENT, END TO END ON THE REAL MIGRATIONS. Written first.
 *
 * The admin.billing_* functions through the same transport the console uses,
 * and billing-api through a recording fetch: every refusal arrives as a typed
 * AdminError the screens branch on.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let finance: { id: string; role: 'finance' };
let school: { org: string; code: string };

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops');
  finance = await makeFinance(db, 'Accounts');
  await readySeller(db, owner);
  await readyPlan(db, owner);
  school = await billedSchool(db, ops, 'ABC');
});
afterAll(async () => {
  await db.close();
});

const noApi: BillingApi = {
  post: async () => {
    throw new Error('billing-api is not part of this test');
  },
};
const as = (claims: AdminClaims, api: BillingApi = noApi) => createBillingClient(pgliteAdminTransport(db, claims), api);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

let invoiceId = '';

describe('selling and reading', () => {
  it('subscriptionCreate and invoiceRaise return the invoice number', async () => {
    const s = await as(aal2(ops)).subscriptionCreate({
      orgId: school.org,
      plan: 'standard',
      seats: 40,
      startsOn: '2026-04-01',
      reason: 'a new school',
      env: 'TEST',
    });
    expect(s.number).toMatch(/^QRIE\/\d\d-\d\d\/0001$/);
    invoiceId = s.invoiceId;
    const r = await as(aal2(ops)).invoiceRaise({ orgId: school.org, description: 'Workbooks', amountPaise: 10_000, reason: 'books', env: 'TEST' });
    expect(r.number).toMatch(/^QRIE\/\d\d-\d\d\/0002$/);
  });

  it('paymentRecord with an old code is needs-mfa; with a fresh one it pays', async () => {
    const input = {
      invoiceId,
      source: 'bank_transfer' as const,
      amountPaise: 2_360_000,
      receivedOn: new Date().toISOString().slice(0, 10),
      reference: 'UTR-1',
      reason: 'paid by transfer',
      env: 'TEST',
    };
    const err = await as(aal2(finance)).paymentRecord(input).catch((e) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect(err.code).toBe('needs-mfa');
    expect(await as(fresh(finance)).paymentRecord(input)).toMatchObject({ invoiceStatus: 'paid', licenceSet: true });
  });

  it('reads come back typed: settings, plans, invoices, one invoice, payments, subscriptions, webhook log, overview, accounts, a school', async () => {
    const c = as(aal2(finance));
    const settings = await c.settings();
    expect(settings).toMatchObject({ ready: true, gstRateBp: 1800, stateCode: '27' });
    expect((await c.plans())[0]).toEqual({ code: 'standard', name: 'Standard', months: 12, seatPricePaise: 50_000, active: true });
    const invoices = await c.invoices();
    expect(invoices).toHaveLength(2);
    expect(typeof invoices[0].totalPaise).toBe('number');
    expect(invoices[0].issuedOn).toMatch(DAY);
    expect(await c.invoices({ status: 'paid' })).toHaveLength(1);
    const detail = await c.invoice(invoiceId);
    expect(detail).toMatchObject({ status: 'paid', totalPaise: 2_360_000, cgstPaise: 180_000, sgstPaise: 180_000, igstPaise: 0 });
    expect(detail.paidOn).toMatch(DAY);
    expect(detail.payments[0]).toMatchObject({ source: 'bank_transfer', amountPaise: 2_360_000, counted: true, recordedAs: 'Accounts' });
    const payments = await c.payments(school.org);
    expect(payments[0]).toMatchObject({ schoolCode: 'ABC', refundable: false, refundedPaise: 0 });
    const subs = await c.subscriptions();
    expect(subs[0]).toMatchObject({ plan: 'standard', seats: 40, startsOn: '2026-04-01', endsOn: '2027-03-31', invoiceStatus: 'paid' });
    expect(await c.webhookLog(true)).toEqual([]);
    const overview = await c.overview();
    expect(overview.collectedThisMonthPaise).toBe(2_360_000);
    expect(overview.attention.reconciledMinutesAgo).toBeNull();
    const accounts = await c.accounts();
    expect(accounts).toEqual([
      expect.objectContaining({ code: 'ABC', hasAccount: true, state: 'active', licenceUntil: '2027-03-31', outstandingPaise: 11_800 }),
    ]);
    const page = await c.school(school.org);
    expect(page.school.code).toBe('ABC');
    expect(page.account?.contactPhone).toBe('9876543210');
    expect(page.licence).toMatchObject({ plan: 'standard', seats: 40, validUntil: '2027-03-31' });
    expect(page.signal.level).toBe('green');
  });
});

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}
function recordingFetch(status: number, answer: unknown) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => answer };
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}
const FUNCTIONS = 'http://127.0.0.1:54321/functions/v1/billing-api';

describe('billing-api', () => {
  it('billing-api calls post to <functions>/billing-api/<route> with the session\'s token', async () => {
    const { sent, fetchImpl } = recordingFetch(200, { linkId: 'QRIE-26-27-0002', url: 'https://x', existing: false });
    const api = billingApiFetch({ functionsUrl: FUNCTIONS, accessToken: async () => 'session-token', fetchImpl });
    const c = as(aal2(ops), api);
    expect(await c.sendLink({ invoiceId: 'inv', reason: 'send', env: 'TEST' })).toEqual({
      linkId: 'QRIE-26-27-0002',
      url: 'https://x',
      existing: false,
    });
    await c.checkLink('inv');
    await c.voidInvoice({ invoiceId: 'inv', reason: 'mistake', env: 'TEST' });
    await c.refund({ paymentId: 'pay', amountPaise: 100, reason: 'overpaid', env: 'TEST' });
    expect(sent.map((s) => s.url)).toEqual([`${FUNCTIONS}/link`, `${FUNCTIONS}/check`, `${FUNCTIONS}/void`, `${FUNCTIONS}/refund`]);
    expect(sent[0].headers).toMatchObject({ authorization: 'Bearer session-token', 'content-type': 'application/json' });
    expect(sent.map((s) => s.body)).toEqual([
      { invoiceId: 'inv', reason: 'send', env: 'TEST' },
      { invoiceId: 'inv' },
      { invoiceId: 'inv', reason: 'mistake', env: 'TEST' },
      { paymentId: 'pay', amountPaise: 100, reason: 'overpaid', env: 'TEST' },
    ]);
  });

  it('a payment by hand on an invoice with an open link goes to billing-api /record, which cancels the link first', async () => {
    const answer = { paymentId: 'p', invoiceStatus: 'partly_paid', licenceSet: false, linksCancelled: 1 };
    const { sent, fetchImpl } = recordingFetch(200, answer);
    const api = billingApiFetch({ functionsUrl: FUNCTIONS, accessToken: async () => 'session-token', fetchImpl });
    const input = {
      invoiceId: 'inv',
      source: 'cheque' as const,
      amountPaise: 500,
      receivedOn: '2026-10-08',
      reference: 'CHQ 1',
      reason: 'paid by cheque',
      env: 'TEST',
    };
    expect(await as(fresh(finance), api).paymentRecordCancellingLink(input)).toEqual(answer);
    expect(sent.map((s) => [s.url, s.body])).toEqual([[`${FUNCTIONS}/record`, input]]);
    expect(sent[0].headers).toMatchObject({ authorization: 'Bearer session-token' });
  });

  it('billing-api refusals are typed: not-allowed, needs-mfa, wrong-environment and other', async () => {
    const cases: [number, string, string][] = [
      [403, 'not allowed', 'not-allowed'],
      [403, 'confirm with your authenticator code first', 'needs-mfa'],
      [409, 'this console is TEST, not HOSTED', 'wrong-environment'],
      [502, 'Cashfree refused (link_post_failed).', 'other'],
    ];
    for (const [status, error, code] of cases) {
      const { fetchImpl } = recordingFetch(status, { error });
      const api = billingApiFetch({ functionsUrl: FUNCTIONS, accessToken: async () => 'session-token', fetchImpl });
      const err = await as(aal2(ops), api).sendLink({ invoiceId: 'inv', reason: 'send', env: 'TEST' }).catch((e) => e);
      expect(err).toBeInstanceOf(AdminError);
      expect(err.code).toBe(code);
    }
    const bare = recordingFetch(500, null);
    const err = await as(aal2(ops), billingApiFetch({ functionsUrl: FUNCTIONS, accessToken: async () => 't', fetchImpl: bare.fetchImpl }))
      .checkLink('inv')
      .catch((e) => e);
    expect(err.message).toBe('billing-api answered 500');
  });

  it('with no session, a billing-api call is not-allowed and nothing is sent', async () => {
    const { sent, fetchImpl } = recordingFetch(200, {});
    const api = billingApiFetch({ functionsUrl: FUNCTIONS, accessToken: async () => null, fetchImpl });
    const err = await as(aal2(ops), api).refund({ paymentId: 'p', amountPaise: 1, reason: 'x', env: 'TEST' }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect(err.code).toBe('not-allowed');
    expect(sent).toEqual([]);
  });
});

describe('correcting a payment by hand', () => {
  it('paymentReverse is the owner\'s with a fresh code; the payment stays listed, marked reversed', async () => {
    const r = await as(aal2(ops)).invoiceRaise({ orgId: school.org, description: 'Lab kit', amountPaise: 1000, reason: 'kit', env: 'TEST' });
    const paid = await as(fresh(finance)).paymentRecord({
      invoiceId: r.invoiceId,
      source: 'cheque',
      amountPaise: 1180,
      receivedOn: new Date().toISOString().slice(0, 10),
      reference: 'CHQ 9',
      reason: 'paid by cheque',
      env: 'TEST',
    });
    const err = await as(fresh(finance)).paymentReverse({ paymentId: paid.paymentId, reason: 'bounced', env: 'TEST' }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect(err.code).toBe('not-allowed');
    expect(await as(fresh(owner)).paymentReverse({ paymentId: paid.paymentId, reason: 'bounced', env: 'TEST' })).toEqual({
      invoiceStatus: 'unpaid',
      paidPaise: 0,
      licenceStays: false,
    });
    const listed = (await as(aal2(finance)).payments(school.org)).find((p) => p.id === paid.paymentId);
    expect(listed).toMatchObject({ reversedAs: 'Aarav', reversible: false });
    expect(listed?.reversedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect((await as(aal2(finance)).invoice(r.invoiceId)).payments[0]).toMatchObject({ reversedAs: 'Aarav' });
  });
});

describe('the finance role', () => {
  it('me() types a finance member', async () => {
    const me = await createAdminClient(pgliteAdminTransport(db, aal2(finance))).me();
    expect(me).toEqual({ userId: finance.id, role: 'finance', displayName: 'Accounts', environment: 'TEST' });
  });
});
