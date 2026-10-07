/**
 * THE CASHFREE CLIENT, FETCH ONLY, BEHIND AN INTERFACE.
 *
 * Only billing-api uses it (supabase/functions/billing-api), and its tests use
 * a fake (tools/billing/tests/fake-cashfree.ts) instead. Paths, methods and
 * headers are Cashfree's documented ones, read 2026-10-07:
 *   POST /links, GET /links/{id}, GET /links/{id}/orders?status=PAID,
 *   POST /links/{id}/cancel (the cancel path is UNVERIFIED beyond the docs'
 *   index), POST /orders/{id}/refunds, GET /orders/{id}/refunds/{refund id};
 *   headers x-client-id, x-client-secret, x-api-version, and
 *   x-idempotency-key on the two creates.
 * Ids that Cashfree documents as numbers (cf_link_id, cf_refund_id) are read
 * back as strings.
 *
 * The client id and secret travel only in request headers. An error carries
 * Cashfree's status, its error code and its message cut to 200 characters;
 * nothing here ever formats a header into a message.
 */

export type CashfreeEnv = 'sandbox' | 'production';

export interface CashfreeConfig {
  env: CashfreeEnv;
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  fetchImpl?: typeof fetch;
}

export interface CashfreeLink {
  link_id: string;
  cf_link_id: string;
  link_url: string;
  link_status: string;
  link_amount: number;
  link_amount_paid: number;
  link_currency: string;
  link_expiry_time?: string;
}

export interface CashfreeLinkOrder {
  order_id: string;
  order_amount: number;
  order_currency: string;
  order_status: string;
}

export interface CashfreeRefund {
  refund_id: string;
  cf_refund_id: string;
  order_id: string;
  refund_amount: number;
  refund_status: string;
}

export interface CreateLinkBody {
  link_id: string;
  link_amount: number;
  link_currency: 'INR';
  link_purpose: string;
  customer_details: { customer_phone: string; customer_email?: string; customer_name?: string };
  link_partial_payments: false;
  link_expiry_time: string;
  link_notes: Record<string, string>;
  link_notify: { send_sms: false; send_email: boolean };
  link_meta: { notify_url: string };
  link_auto_reminders: false;
}

export interface RefundBody {
  refund_amount: number;
  refund_id: string;
  refund_note: string;
  refund_speed: 'STANDARD';
}

export interface CashfreeApi {
  createLink(body: CreateLinkBody, idempotencyKey: string): Promise<CashfreeLink>;
  getLink(linkId: string): Promise<CashfreeLink>;
  linkOrders(linkId: string): Promise<CashfreeLinkOrder[]>;
  cancelLink(linkId: string): Promise<CashfreeLink>;
  createRefund(orderId: string, body: RefundBody, idempotencyKey: string): Promise<CashfreeRefund>;
  getRefund(orderId: string, refundId: string): Promise<CashfreeRefund>;
}

/** What Cashfree (or the network on the way) answered instead. status 0 is no answer at all. */
export class CashfreeError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CashfreeError';
    this.status = status;
    this.code = code;
  }
}

export function cashfreeBaseUrl(env: CashfreeEnv): string {
  if (env === 'sandbox') return 'https://sandbox.cashfree.com/pg';
  if (env === 'production') return 'https://api.cashfree.com/pg';
  throw new Error('CASHFREE_ENV is sandbox or production');
}

const seg = encodeURIComponent;
const asString = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function link(raw: Record<string, unknown>): CashfreeLink {
  return {
    link_id: asString(raw.link_id),
    cf_link_id: asString(raw.cf_link_id),
    link_url: asString(raw.link_url),
    link_status: asString(raw.link_status),
    link_amount: Number(raw.link_amount),
    link_amount_paid: Number(raw.link_amount_paid ?? 0),
    link_currency: asString(raw.link_currency),
    ...(raw.link_expiry_time ? { link_expiry_time: asString(raw.link_expiry_time) } : {}),
  };
}

function refund(raw: Record<string, unknown>): CashfreeRefund {
  return {
    refund_id: asString(raw.refund_id),
    cf_refund_id: asString(raw.cf_refund_id),
    order_id: asString(raw.order_id),
    refund_amount: Number(raw.refund_amount),
    refund_status: asString(raw.refund_status),
  };
}

export function cashfreeHttp(cfg: CashfreeConfig): CashfreeApi {
  if (!cfg.clientId) throw new Error('the Cashfree client id is not set');
  if (!cfg.clientSecret) throw new Error('the Cashfree client secret is not set');
  if (!cfg.apiVersion) throw new Error('the Cashfree API version is not set');
  const base = cashfreeBaseUrl(cfg.env);
  const fetchImpl = cfg.fetchImpl ?? fetch;

  async function call(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      'x-client-id': cfg.clientId,
      'x-client-secret': cfg.clientSecret,
      'x-api-version': cfg.apiVersion,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      // The network error's own text is not passed on: it is not Cashfree's.
      throw new CashfreeError(0, 'network', 'Cashfree did not answer');
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const o = (json && typeof json === 'object' ? json : {}) as { code?: unknown; message?: unknown };
      const code = typeof o.code === 'string' && o.code ? o.code.slice(0, 60) : `http_${res.status}`;
      const said = typeof o.message === 'string' ? `: ${o.message.slice(0, 200)}` : '';
      throw new CashfreeError(res.status, code, `Cashfree answered ${res.status} ${code}${said}`);
    }
    return json;
  }

  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

  return {
    async createLink(body, idempotencyKey) {
      return link(obj(await call('POST', '/links', body, idempotencyKey)));
    },
    async getLink(linkId) {
      return link(obj(await call('GET', `/links/${seg(linkId)}`)));
    },
    async linkOrders(linkId) {
      const answer = await call('GET', `/links/${seg(linkId)}/orders?status=PAID`);
      return (Array.isArray(answer) ? answer : []).map((raw) => {
        const o = obj(raw);
        return {
          order_id: asString(o.order_id),
          order_amount: Number(o.order_amount),
          order_currency: asString(o.order_currency),
          order_status: asString(o.order_status),
        };
      });
    },
    async cancelLink(linkId) {
      return link(obj(await call('POST', `/links/${seg(linkId)}/cancel`, {})));
    },
    async createRefund(orderId, body, idempotencyKey) {
      return refund(obj(await call('POST', `/orders/${seg(orderId)}/refunds`, body, idempotencyKey)));
    },
    async getRefund(orderId, refundId) {
      return refund(obj(await call('GET', `/orders/${seg(orderId)}/refunds/${seg(refundId)}`)));
    },
  };
}
