import { bearerFrom } from '../../../packages/relay/src/auth.ts';
import { CashfreeError, type CashfreeApi, type CashfreeEnv, type CashfreeLink } from './cashfree.ts';
import { MoneyError, paiseFromRupees, rupeesFromPaise } from './money.ts';
import { RpcError } from './rest.ts';
import { sha256Hex } from './signature.ts';

/**
 * BILLING-API, THE ONLY CALLER OF CASHFREE, AS A PLAIN FUNCTION (the Deno
 * entry is supabase/functions/billing-api/index.ts).
 *
 * Every staff route asks the database first, as the staff member: their own
 * Authorization goes to PostgREST (userRpc), so admin.require_staff, the fresh
 * code and the environment check decide (ruling R4). Cashfree is asked only
 * after the database said yes; what it answered is recorded through
 * service-role-only functions (serviceRpc).
 *
 *   /link     {invoiceId, reason, env}  a payment link for what is still due
 *   /check    {invoiceId}               reads the invoice's open links at Cashfree, and any
 *                                       link with money no stored payment accounts for
 *   /void     {invoiceId, reason, env}  cancels open links at Cashfree, then voids
 *   /refund   {paymentId, amountPaise, reason, env}
 *   /reconcile                          the outside checker's, with its own token
 *
 * Before any Cashfree call, the keys must suit the database (ruling R16):
 * production keys only for a HOSTED database, sandbox keys for any other.
 * Answers never carry a key or a header: a Cashfree failure is reported by its
 * code, a database refusal by the database's own message.
 */

export interface BillingApiRequest {
  method: string;
  path: string;
  authorization?: string;
  body: unknown;
}

export interface BillingApiDeps {
  /** An admin.* function run AS THE CALLER: their Authorization header goes to the database, which decides. */
  userRpc(authorization: string, fn: string, args: Record<string, unknown>): Promise<unknown>;
  /** An admin.* function run with the service role. */
  serviceRpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  cashfree: CashfreeApi;
  cashfreeEnv: CashfreeEnv;
  /** <SUPABASE_URL>/functions/v1/cashfree-webhook */
  webhookUrl: string;
  /** BILLING_RECONCILE_TOKEN; '' disables /reconcile. */
  reconcileToken: string;
}

type Answer = { status: number; body: unknown };

class Refusal extends Error {
  readonly answer: Answer;
  constructor(answer: Answer) {
    super('refused');
    this.answer = answer;
  }
}

const ROUTES = ['link', 'check', 'void', 'refund', 'reconcile'] as const;
type Route = (typeof ROUTES)[number];

/** A link younger than this may still be on its way to Cashfree. */
const IN_FLIGHT_MINUTES = 10;

const enc = new TextEncoder();
const fail = (status: number, error: string): Answer => ({ status, body: { error } });

/** Sorts a failure into the answer the console reads (its toAdminError sorts the message again). */
function answerFor(e: unknown): Answer {
  if (e instanceof Refusal) return e.answer;
  if (e instanceof CashfreeError) {
    return e.status === 0 || e.status >= 500
      ? fail(502, 'Cashfree did not answer; try again in a minute.')
      : fail(502, `Cashfree refused (${e.code}).`);
  }
  if (e instanceof RpcError) {
    if (/^not allowed\b|permission denied/i.test(e.message)) return fail(403, 'not allowed');
    if (/authenticator code/i.test(e.message)) return fail(403, e.message);
    if (/^this console is /i.test(e.message)) return fail(409, e.message);
    if (e.status === 0 || e.status >= 500) return fail(502, 'Could not reach the database.');
    return fail(400, e.message);
  }
  if (e instanceof MoneyError) return fail(502, 'Cashfree answered an amount that is not rupees and paise.');
  console.error('billing-api: an unexpected failure');
  return fail(500, 'Something went wrong; nothing more was sent to Cashfree.');
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function need(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (typeof v !== 'string' || v.length === 0 || v.length > 100) throw new Refusal(fail(400, `${field} is required`));
  return v;
}

/** Production keys for HOSTED, sandbox keys for anything else. */
function pair(deps: BillingApiDeps, environment: unknown): void {
  const want: CashfreeEnv = environment === 'HOSTED' ? 'production' : 'sandbox';
  if (deps.cashfreeEnv !== want) {
    throw new Refusal(
      fail(503, `Cashfree is set to ${deps.cashfreeEnv} but this database is ${String(environment)}; nothing was sent.`),
    );
  }
}

interface ObservedAnswer {
  changed?: boolean;
}

/** Records what Cashfree says about one link: its creation if the row was still being made, then its state and paid orders. */
async function record(deps: BillingApiDeps, linkId: string, rowMayBeCreating: boolean, cf: CashfreeLink): Promise<boolean> {
  let changed = false;
  if (rowMayBeCreating && cf.link_url) {
    await deps.serviceRpc('billing_link_created', {
      p_link_id: linkId,
      p_cf_link_id: cf.cf_link_id,
      p_url: cf.link_url,
      p_expires_at: cf.link_expiry_time ?? null,
    });
    changed = true;
  }
  const orders = cf.link_amount_paid > 0 ? await deps.cashfree.linkOrders(linkId) : [];
  const observed = (await deps.serviceRpc('billing_link_observed', {
    p_link_id: linkId,
    p_value: {
      status: cf.link_status,
      amountPaidPaise: paiseFromRupees(cf.link_amount_paid),
      currency: cf.link_currency,
      orders: orders.map((o) => ({
        orderId: o.order_id,
        amountPaise: paiseFromRupees(o.order_amount),
        currency: o.order_currency,
        status: o.order_status,
      })),
    },
  })) as ObservedAnswer | null;
  return changed || Boolean(observed?.changed);
}

/** Reads one open link at Cashfree and records it. A row still being made that Cashfree does not have, and that is no longer in flight, is marked failed. */
async function observe(deps: BillingApiDeps, linkId: string, dbStatus: string, ageMinutes: number): Promise<boolean> {
  let cf: CashfreeLink;
  try {
    cf = await deps.cashfree.getLink(linkId);
  } catch (e) {
    if (e instanceof CashfreeError && e.status === 404 && dbStatus === 'creating') {
      if (ageMinutes < IN_FLIGHT_MINUTES) return false;
      await deps.serviceRpc('billing_link_failed', { p_link_id: linkId, p_why: 'not at Cashfree' });
      return true;
    }
    throw e;
  }
  return record(deps, linkId, dbStatus === 'creating', cf);
}

const minutesSince = (iso: unknown): number => {
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 60000) : 0;
};

async function staffMe(deps: BillingApiDeps, auth: string): Promise<void> {
  const me = (await deps.userRpc(auth, 'me', {})) as { environment?: unknown } | null;
  pair(deps, me?.environment);
}

async function link(deps: BillingApiDeps, auth: string, body: Record<string, unknown>): Promise<Answer> {
  const invoiceId = need(body, 'invoiceId');
  await staffMe(deps, auth);
  const prep = (await deps.userRpc(auth, 'billing_link_prepare', {
    p_invoice: invoiceId,
    p_reason: text(body.reason),
    p_env: text(body.env),
  })) as {
    existing: boolean;
    linkRowId: string;
    linkId: string;
    url?: string | null;
    amountPaise: number;
    purpose: string;
    customer: { name: string; phone: string; email: string | null };
    notes: Record<string, string>;
    expiresAt: string;
    sendEmail: boolean;
  };
  if (prep.existing) return { status: 200, body: { linkId: prep.linkId, url: prep.url ?? null, existing: true } };
  let made: CashfreeLink;
  try {
    made = await deps.cashfree.createLink(
      {
        link_id: prep.linkId,
        link_amount: rupeesFromPaise(prep.amountPaise),
        link_currency: 'INR',
        link_purpose: prep.purpose,
        customer_details: {
          customer_phone: prep.customer.phone,
          ...(prep.customer.email ? { customer_email: prep.customer.email } : {}),
          customer_name: prep.customer.name,
        },
        link_partial_payments: false,
        link_expiry_time: prep.expiresAt,
        link_notes: prep.notes,
        link_notify: { send_sms: false, send_email: prep.sendEmail },
        link_meta: { notify_url: deps.webhookUrl },
        link_auto_reminders: false,
      },
      // The row's id: a retry of the same row is the same request to Cashfree.
      prep.linkRowId,
    );
  } catch (e) {
    if (!(e instanceof CashfreeError)) throw e;
    if (e.status === 409) {
      // Made before, its answer lost (UNVERIFIED that Cashfree answers 409 for a repeated link_id).
      made = await deps.cashfree.getLink(prep.linkId);
    } else if (e.status >= 400 && e.status < 500) {
      await deps.serviceRpc('billing_link_failed', { p_link_id: prep.linkId, p_why: e.code });
      return fail(502, `Cashfree refused (${e.code}).`);
    } else {
      // No answer: the row stays 'creating', so the next try (or the hourly
      // check) settles it with the same idempotency key.
      return fail(502, 'Cashfree did not answer; try again in a minute, or the hourly check will finish the link.');
    }
  }
  await deps.serviceRpc('billing_link_created', {
    p_link_id: prep.linkId,
    p_cf_link_id: made.cf_link_id,
    p_url: made.link_url,
    p_expires_at: made.link_expiry_time ?? null,
  });
  return { status: 200, body: { linkId: prep.linkId, url: made.link_url, existing: false } };
}

async function check(deps: BillingApiDeps, auth: string, body: Record<string, unknown>): Promise<Answer> {
  const invoiceId = need(body, 'invoiceId');
  await staffMe(deps, auth);
  const detail = (await deps.userRpc(auth, 'billing_invoice', { p_invoice: invoiceId })) as {
    links: { linkId: string; status: string; createdAt: string; unrecordedPaise?: number }[];
  };
  let checked = 0;
  let changed = 0;
  // Open links, and any link with money Cashfree reported that no stored payment accounts for.
  for (const l of detail.links.filter((x) => ['creating', 'active', 'partly_paid'].includes(x.status) || (x.unrecordedPaise ?? 0) > 0)) {
    checked += 1;
    if (await observe(deps, l.linkId, l.status, minutesSince(l.createdAt))) changed += 1;
  }
  return { status: 200, body: { checked, changed } };
}

async function voidInvoice(deps: BillingApiDeps, auth: string, body: Record<string, unknown>): Promise<Answer> {
  const invoiceId = need(body, 'invoiceId');
  await staffMe(deps, auth);
  const args = { p_invoice: invoiceId, p_reason: text(body.reason), p_env: text(body.env) };
  // Every check the void makes, the fresh code included, before Cashfree is asked anything.
  const plan = (await deps.userRpc(auth, 'billing_invoice_void', { ...args, p_commit: false })) as { openLinks: string[] };
  for (const linkId of plan.openLinks) {
    let cf: CashfreeLink;
    try {
      cf = await deps.cashfree.getLink(linkId);
    } catch (e) {
      if (e instanceof CashfreeError && e.status === 404) {
        await deps.serviceRpc('billing_link_failed', { p_link_id: linkId, p_why: 'not at Cashfree' });
        continue;
      }
      throw e;
    }
    if (cf.link_status === 'PAID' || cf.link_status === 'PARTIALLY_PAID') {
      await record(deps, linkId, true, cf);
      return fail(409, 'Money arrived on this link; the invoice was not voided. Refund it from Payments if needed.');
    }
    if (cf.link_status === 'ACTIVE') {
      const after = await deps.cashfree.cancelLink(linkId);
      // Cashfree cancels only an ACTIVE link and answered 200, so it is cancelled.
      cf = { ...cf, link_status: after.link_status && after.link_status !== 'ACTIVE' ? after.link_status : 'CANCELLED' };
    }
    await record(deps, linkId, true, cf);
  }
  await deps.userRpc(auth, 'billing_invoice_void', { ...args, p_commit: true });
  return { status: 200, body: { voided: true } };
}

async function refund(deps: BillingApiDeps, auth: string, body: Record<string, unknown>): Promise<Answer> {
  const paymentId = need(body, 'paymentId');
  const amountPaise = body.amountPaise;
  if (typeof amountPaise !== 'number' || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Refusal(fail(400, 'amountPaise is a whole number of paise above zero'));
  }
  await staffMe(deps, auth);
  const prep = (await deps.userRpc(auth, 'billing_refund_prepare', {
    p_payment: paymentId,
    p_amount_paise: amountPaise,
    p_reason: text(body.reason),
    p_env: text(body.env),
  })) as { refundRowId: string; refundId: string; orderId: string; amountPaise: number; note: string };
  let answer;
  try {
    answer = await deps.cashfree.createRefund(
      prep.orderId,
      { refund_amount: rupeesFromPaise(prep.amountPaise), refund_id: prep.refundId, refund_note: prep.note, refund_speed: 'STANDARD' },
      prep.refundRowId,
    );
  } catch (e) {
    if (!(e instanceof CashfreeError)) throw e;
    if (e.status >= 400 && e.status < 500) {
      await deps.serviceRpc('billing_refund_result', { p_refund_id: prep.refundId, p_value: { status: 'FAILED', detail: e.code } });
      return fail(502, `Cashfree refused (${e.code}).`);
    }
    return fail(502, 'Cashfree did not answer; the hourly check will find out what happened.');
  }
  const result = (await deps.serviceRpc('billing_refund_result', {
    p_refund_id: prep.refundId,
    p_value: { status: answer.refund_status, cfRefundId: answer.cf_refund_id },
  })) as { status: string; creditNote: string | null };
  return { status: 200, body: { status: result.status, creditNote: result.creditNote } };
}

async function reconcile(deps: BillingApiDeps, authorization: string | undefined): Promise<Answer> {
  if (!deps.reconcileToken) return fail(404, 'not found');
  const token = bearerFrom(authorization);
  // Equal-length digests are compared, so the comparison says nothing about the token's characters.
  if (!token || (await sha256Hex(enc.encode(token))) !== (await sha256Hex(enc.encode(deps.reconcileToken)))) {
    return fail(401, 'not allowed');
  }
  const status = (await deps.serviceRpc('bootstrap_status', {})) as { environment?: unknown } | null;
  pair(deps, status?.environment);
  const due = (await deps.serviceRpc('billing_reconcile_due', { p_force: false })) as {
    due: boolean;
    links?: { linkId: string; status: string; createdMinutesAgo: number }[];
    refunds?: { refundId: string; orderId: string; status: string; createdMinutesAgo: number }[];
  };
  if (!due.due) return { status: 200, body: { ran: false } };
  let checked = 0;
  let changed = 0;
  let failed = 0;
  for (const l of due.links ?? []) {
    if (l.status === 'creating' && l.createdMinutesAgo < IN_FLIGHT_MINUTES) continue;
    checked += 1;
    try {
      if (await observe(deps, l.linkId, l.status, l.createdMinutesAgo)) changed += 1;
    } catch {
      failed += 1;
    }
  }
  for (const r of due.refunds ?? []) {
    checked += 1;
    try {
      let value: Record<string, unknown>;
      try {
        const cf = await deps.cashfree.getRefund(r.orderId, r.refundId);
        value = { status: cf.refund_status, cfRefundId: cf.cf_refund_id };
      } catch (e) {
        if (!(e instanceof CashfreeError && e.status === 404 && r.status === 'requested')) throw e;
        if (r.createdMinutesAgo < IN_FLIGHT_MINUTES) continue;
        value = { status: 'FAILED', detail: 'not at Cashfree' };
      }
      const result = (await deps.serviceRpc('billing_refund_result', { p_refund_id: r.refundId, p_value: value })) as {
        status: string;
      };
      if (result.status !== r.status) changed += 1;
    } catch {
      failed += 1;
    }
  }
  await deps.serviceRpc('billing_reconcile_done', { p_value: { checked, changed, failed } });
  return { status: 200, body: { ran: true, checked, changed, failed } };
}

export async function handleBillingApi(req: BillingApiRequest, deps: BillingApiDeps): Promise<Answer> {
  if (req.method !== 'POST') return fail(405, 'POST only');
  const route = req.path.replace(/\/+$/, '').split('/').pop() as Route;
  if (!ROUTES.includes(route)) return fail(404, 'not found');
  try {
    if (route === 'reconcile') return await reconcile(deps, req.authorization);
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'the request body is a JSON object');
    const b = body as Record<string, unknown>;
    if (!bearerFrom(req.authorization)) return fail(401, 'sign in first');
    const auth = req.authorization as string;
    if (route === 'link') return await link(deps, auth, b);
    if (route === 'check') return await check(deps, auth, b);
    if (route === 'void') return await voidInvoice(deps, auth, b);
    return await refund(deps, auth, b);
  } catch (e) {
    return answerFor(e);
  }
}
