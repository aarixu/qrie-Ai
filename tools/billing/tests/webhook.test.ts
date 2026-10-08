// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aal2, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { billedSchool, readyPlan, readySeller, rpc, serviceRpc } from '../../../supabase/tests/billing-fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { sha256Hex, signWebhook } from '../src/signature.ts';
import { handleWebhook, MAX_BODY_BYTES, type WebhookDeps } from '../src/webhook.ts';

/**
 * THE CASHFREE WEBHOOK (supabase/functions/cashfree-webhook). Written first.
 *
 * Over the real migrations: the signature is checked on the raw bytes before
 * anything else, a failure is stored as a hash and a length and answered 401,
 * an event is stored once by its key and answered 200 so Cashfree stops
 * retrying, and a database failure is answered 500 so Cashfree retries.
 */

const SECRET = 'test-client-secret';
const enc = new TextEncoder();

let db: PGlite;
let owner: Staff;
let ops: Staff;
let org: string;

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops');
  await readySeller(db, owner);
  await readyPlan(db, owner);
  org = (await billedSchool(db, ops, 'ABC')).org;
});
afterAll(async () => {
  await db.close();
});

const deps = (over: Partial<WebhookDeps> = {}): WebhookDeps => ({
  secret: SECRET,
  rpc: (fn, args) => serviceRpc(db, fn, args),
  ...over,
});

interface Linked {
  invoiceId: string;
  number: string;
  linkId: string;
}
/** An ad hoc invoice of 10,000 paise (11,800 with GST) with an active link, made as billing-api would. */
async function linkedInvoice(): Promise<Linked> {
  const inv = await rpc<{ invoiceId: string; number: string }>(db, aal2(ops), 'billing_invoice_raise', {
    p_org: org,
    p_description: 'Teacher training day',
    p_amount_paise: 10_000,
    p_due_days: 15,
    p_reason: 'test raise',
    p_env: 'TEST',
  });
  const p = await rpc<{ linkId: string }>(db, aal2(ops), 'billing_link_prepare', {
    p_invoice: inv.invoiceId,
    p_reason: 'send',
    p_env: 'TEST',
  });
  await serviceRpc(db, 'billing_link_created', {
    p_link_id: p.linkId,
    p_cf_link_id: '1576977',
    p_url: `https://payments-test.cashfree.com/links/${p.linkId}`,
    p_expires_at: null,
  });
  return { invoiceId: inv.invoiceId, number: inv.number, linkId: p.linkId };
}

/** Cashfree's documented payment-link webhook, re-pointed at a link, as the raw text it sends. */
function body(l: Linked, orderId: string, status = 'PAID'): string {
  const order =
    status === 'PAID'
      ? `{"order_amount":"118.00", "order_id":"${orderId}", "order_expiry_time":"2026-10-07T13:34:50",
          "order_hash":"Gb2gC7z0tILhGbZUIeds", "transaction_amount":"118.00", "transaction_id":1021206, "transaction_status":"SUCCESS"}`
      : 'null';
  return `{"data":{"cf_link_id":1576977, "link_id":"${l.linkId}", "link_status":"${status}", "link_currency":"INR",
    "link_amount":"118.00", "link_amount_paid":"${status === 'PAID' ? '118.00' : '0.00'}", "link_partial_payments":false,
    "link_purpose":"Qrie invoice ${l.number}", "customer_details":{"customer_phone":"9876543210","customer_email":"accounts@school.example","customer_name":"Meera Rao"},
    "link_url":"https://payments-test.cashfree.com/links/x", "link_notes":{"school":"ABC","invoice":"${l.number}"},
    "order":${order}},
  "type":"PAYMENT_LINK_EVENT", "version":1, "event_time":"${new Date().toISOString()}"}`;
}

async function signed(text: string, over: Record<string, string | undefined> = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const bytes = enc.encode(text);
  return {
    method: 'POST',
    headers: { 'x-webhook-timestamp': ts, 'x-webhook-signature': await signWebhook(SECRET, ts, bytes), ...over },
    body: bytes,
  };
}

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => (await one<{ n: number }>(sql, params)).n;
const status = async (invoiceId: string) =>
  (await one<{ status: string }>(`select status from billing.invoice where id = $1`, [invoiceId])).status;

describe('the webhook', () => {
  it('a signed PAID event is stored, processed and answered 200, and the invoice is paid', async () => {
    const l = await linkedInvoice();
    const out = await handleWebhook(await signed(body(l, 'CF_one')), deps());
    expect(out).toEqual({ status: 200, body: { ok: true } });
    expect(await status(l.invoiceId)).toBe('paid');
    const row = await one<{ status: string; payload: string }>(
      `select status, payload::text as payload from billing.webhook_event where order_id = 'CF_one'`,
    );
    expect(row.status).toBe('processed');
    expect(row.payload).not.toContain('9876543210');
  });

  it('a wrong signature is answered 401, stored as a signature failure, and changes nothing else', async () => {
    const l = await linkedInvoice();
    const text = body(l, 'CF_forged');
    const req = await signed(text, { 'x-webhook-signature': await signWebhook('not-the-secret', '1', enc.encode(text)) });
    const before = await count(`select count(*)::int as n from billing.payment`);
    expect(await handleWebhook(req, deps())).toEqual({ status: 401, body: { error: 'signature' } });
    expect(await status(l.invoiceId)).toBe('unpaid');
    expect(await count(`select count(*)::int as n from billing.payment`)).toBe(before);
    const row = await one<Record<string, unknown>>(
      `select signature_ok, status, payload, idem_key, body_length, detail from billing.webhook_event where body_sha256 = $1`,
      [await sha256Hex(enc.encode(text))],
    );
    expect(row).toEqual({
      signature_ok: false,
      status: 'signature_failed',
      payload: {},
      idem_key: null,
      body_length: enc.encode(text).length,
      detail: 'signature does not match',
    });
  });

  it('missing timestamp or signature headers are a signature failure', async () => {
    const l = await linkedInvoice();
    for (const over of [{ 'x-webhook-timestamp': undefined }, { 'x-webhook-signature': undefined }]) {
      const text = body(l, `CF_missing_${Object.keys(over)[0]}`);
      expect((await handleWebhook(await signed(text, over), deps())).status).toBe(401);
      const row = await one<{ detail: string }>(`select detail from billing.webhook_event where body_sha256 = $1`, [
        await sha256Hex(enc.encode(text)),
      ]);
      expect(row.detail).toBe('missing signature headers');
    }
    expect(await status(l.invoiceId)).toBe('unpaid');
  });

  it('the same delivery twice is answered 200 both times and pays once', async () => {
    const l = await linkedInvoice();
    const req = await signed(body(l, 'CF_twice'), { 'x-idempotency-key': 'idem-twice' });
    expect((await handleWebhook(req, deps())).status).toBe(200);
    expect((await handleWebhook(req, deps())).status).toBe(200);
    expect(await count(`select count(*)::int as n from billing.payment where cf_order_id = 'CF_twice'`)).toBe(1);
    expect(await count(`select count(*)::int as n from billing.webhook_event where idem_key = 'idem-twice'`)).toBe(1);
  });

  it('the idempotency header is the key when Cashfree sends one, else the body\'s hash', async () => {
    const l = await linkedInvoice();
    const text = body(l, 'CF_keys');
    await handleWebhook(await signed(text, { 'x-idempotency-key': 'idem-a' }), deps());
    await handleWebhook(await signed(text, { 'X-Idempotency-Key': 'idem-b' }), deps());
    expect(await count(`select count(*)::int as n from billing.webhook_event where idem_key in ('idem-a', 'idem-b')`)).toBe(2);
    expect(await count(`select count(*)::int as n from billing.payment where cf_order_id = 'CF_keys'`)).toBe(1);
    const other = await linkedInvoice();
    const plain = body(other, 'CF_nokey');
    await handleWebhook(await signed(plain), deps());
    expect(
      await count(`select count(*)::int as n from billing.webhook_event where idem_key = $1`, [
        `sha256:${await sha256Hex(enc.encode(plain))}`,
      ]),
    ).toBe(1);
  });

  it('an EXPIRED event after PAID leaves the invoice paid', async () => {
    const l = await linkedInvoice();
    await handleWebhook(await signed(body(l, 'CF_then_expired')), deps());
    expect((await handleWebhook(await signed(body(l, '', 'EXPIRED')), deps())).status).toBe(200);
    expect(await status(l.invoiceId)).toBe('paid');
    expect((await one<{ status: string }>(`select status from billing.payment_link where link_id = $1`, [l.linkId])).status).toBe('paid');
  });

  it('a signed body that is not JSON is stored as unparsed and answered 200', async () => {
    const text = 'type=PAYMENT_LINK_EVENT&data[link_id]=QRIE-26-27-0001';
    expect(await handleWebhook(await signed(text), deps())).toEqual({ status: 200, body: { ok: true } });
    const row = await one<{ status: string }>(`select status from billing.webhook_event where body_sha256 = $1`, [
      await sha256Hex(enc.encode(text)),
    ]);
    expect(row.status).toBe('unparsed');
  });

  it('when the database fails, the answer is 500 so Cashfree retries', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const l = await linkedInvoice();
    const text = body(l, 'CF_db_down');
    const out = await handleWebhook(await signed(text), deps({ rpc: async () => Promise.reject(new Error('connection refused')) }));
    expect(out).toEqual({ status: 500, body: { error: 'not stored' } });
    expect(quiet.mock.calls.flat().join(' ')).not.toContain('9876543210');
    quiet.mockRestore();
  });

  it('no secret answers 503 and a GET answers 405', async () => {
    const req = await signed('{}');
    expect(await handleWebhook(req, deps({ secret: '' }))).toEqual({
      status: 503,
      body: { error: 'cashfree-webhook is missing CASHFREE_CLIENT_SECRET' },
    });
    expect((await handleWebhook({ ...req, method: 'GET' }, deps())).status).toBe(405);
  });

  it('a body over 256 KiB is answered 413 and nothing is stored', async () => {
    const before = await count(`select count(*)::int as n from billing.webhook_event`);
    const big = `{"pad":"${'x'.repeat(MAX_BODY_BYTES)}"}`;
    expect((await handleWebhook(await signed(big), deps())).status).toBe(413);
    expect(await count(`select count(*)::int as n from billing.webhook_event`)).toBe(before);
  });
});
