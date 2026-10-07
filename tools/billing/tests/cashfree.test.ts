// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CashfreeError, cashfreeBaseUrl, cashfreeHttp, type CashfreeConfig, type CreateLinkBody } from '../src/cashfree.ts';

/**
 * THE CASHFREE CLIENT. Written first.
 *
 * Paths, methods and headers as Cashfree documents them (read 2026-10-07; see
 * the plan's table). No call here reaches Cashfree: every test hands the
 * client a recording fetch.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}
function recorder(answer: (url: string) => { status: number; json?: unknown; text?: string } | Error) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const a = answer(url);
    if (a instanceof Error) throw a;
    const text = a.text ?? JSON.stringify(a.json ?? {});
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => text };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const CFG: CashfreeConfig = {
  env: 'sandbox',
  clientId: 'TEST-CLIENT-ID-123',
  clientSecret: 'test-client-secret',
  apiVersion: '2026-01-01',
};

const LINK = {
  link_id: 'QRIE-26-27-0001',
  cf_link_id: 1576977,
  link_url: 'https://payments-test.cashfree.com/links/abc',
  link_status: 'ACTIVE',
  link_amount: 23600,
  link_amount_paid: 0,
  link_currency: 'INR',
  link_expiry_time: '2026-11-06T23:59:59+05:30',
};

const BODY: CreateLinkBody = {
  link_id: 'QRIE-26-27-0001',
  link_amount: 23600,
  link_currency: 'INR',
  link_purpose: 'Qrie invoice QRIE/26-27/0001 for ABC Public School',
  customer_details: { customer_phone: '9876543210', customer_email: 'accounts@school.example', customer_name: 'Meera Rao' },
  link_partial_payments: false,
  link_expiry_time: '2026-11-06T23:59:59+05:30',
  link_notes: { school: 'ABC', invoice: 'QRIE/26-27/0001' },
  link_notify: { send_sms: false, send_email: true },
  link_meta: { notify_url: 'https://p.supabase.co/functions/v1/cashfree-webhook' },
  link_auto_reminders: false,
};

describe('the Cashfree client', () => {
  it('sandbox and production base URLs', () => {
    expect(cashfreeBaseUrl('sandbox')).toBe('https://sandbox.cashfree.com/pg');
    expect(cashfreeBaseUrl('production')).toBe('https://api.cashfree.com/pg');
  });

  it('createLink posts /links with x-client-id, x-client-secret, x-api-version, x-idempotency-key and the JSON body', async () => {
    const { calls, fetchImpl } = recorder(() => ({ status: 200, json: LINK }));
    const link = await cashfreeHttp({ ...CFG, fetchImpl }).createLink(BODY, '9b2f3a4e-0000-4000-8000-000000000001');
    expect(link).toMatchObject({ link_id: 'QRIE-26-27-0001', cf_link_id: '1576977', link_url: LINK.link_url, link_amount: 23600 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://sandbox.cashfree.com/pg/links');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers).toMatchObject({
      'x-client-id': 'TEST-CLIENT-ID-123',
      'x-client-secret': 'test-client-secret',
      'x-api-version': '2026-01-01',
      'x-idempotency-key': '9b2f3a4e-0000-4000-8000-000000000001',
      'content-type': 'application/json',
      accept: 'application/json',
    });
    expect(calls[0].body).toEqual(BODY);
  });

  it('getLink, linkOrders (status=PAID), cancelLink, createRefund and getRefund use the documented paths and methods', async () => {
    const { calls, fetchImpl } = recorder((url) => {
      if (url.includes('/orders?')) return { status: 200, json: [{ order_id: 'CF1', order_amount: 236, order_currency: 'INR', order_status: 'PAID' }] };
      if (url.includes('/refunds')) {
        return {
          status: 200,
          json: { refund_id: 'qrierf1', cf_refund_id: 11325632, order_id: 'CF 1', refund_amount: 10, refund_status: 'PENDING' },
        };
      }
      return { status: 200, json: LINK };
    });
    const cf = cashfreeHttp({ ...CFG, env: 'production', fetchImpl });
    await cf.getLink('QRIE-26-27-0001');
    expect(await cf.linkOrders('QRIE-26-27-0001')).toEqual([{ order_id: 'CF1', order_amount: 236, order_currency: 'INR', order_status: 'PAID' }]);
    await cf.cancelLink('QRIE-26-27-0001');
    const refund = await cf.createRefund(
      'CF 1',
      { refund_amount: 10, refund_id: 'qrierf1', refund_note: 'Refund for QRIE/26-27/0001', refund_speed: 'STANDARD' },
      'idem-1',
    );
    expect(refund.cf_refund_id).toBe('11325632');
    await cf.getRefund('CF 1', 'qrierf1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.cashfree.com/pg/links/QRIE-26-27-0001',
      'GET https://api.cashfree.com/pg/links/QRIE-26-27-0001/orders?status=PAID',
      'POST https://api.cashfree.com/pg/links/QRIE-26-27-0001/cancel',
      'POST https://api.cashfree.com/pg/orders/CF%201/refunds',
      'GET https://api.cashfree.com/pg/orders/CF%201/refunds/qrierf1',
    ]);
    expect(calls[3].headers['x-idempotency-key']).toBe('idem-1');
    expect(calls[3].body).toEqual({ refund_amount: 10, refund_id: 'qrierf1', refund_note: 'Refund for QRIE/26-27/0001', refund_speed: 'STANDARD' });
    expect(calls[0].headers['x-idempotency-key']).toBeUndefined();
    expect(calls[0].headers['content-type']).toBeUndefined();
  });

  it('an error answer becomes CashfreeError with the status and Cashfree\'s code, and no message carries the secret or the client id', async () => {
    const refusing = recorder(() => ({ status: 400, json: { code: 'link_post_failed', message: 'link_id already exists', type: 'invalid_request_error' } }));
    let e: unknown;
    try {
      await cashfreeHttp({ ...CFG, fetchImpl: refusing.fetchImpl }).createLink(BODY, 'k');
    } catch (err) {
      e = err;
    }
    expect(e).toBeInstanceOf(CashfreeError);
    const ce = e as CashfreeError;
    expect(ce.status).toBe(400);
    expect(ce.code).toBe('link_post_failed');
    expect(ce.message).toContain('Cashfree answered 400 link_post_failed');
    for (const secret of [CFG.clientSecret, CFG.clientId]) expect(`${ce.message} ${ce.stack}`).not.toContain(secret);

    const down = recorder(() => new Error(`connect ECONNREFUSED with ${CFG.clientSecret}`));
    try {
      await cashfreeHttp({ ...CFG, fetchImpl: down.fetchImpl }).getLink('L');
    } catch (err) {
      e = err;
    }
    expect(e).toBeInstanceOf(CashfreeError);
    expect((e as CashfreeError).status).toBe(0);
    expect((e as CashfreeError).code).toBe('network');
    expect((e as CashfreeError).message).not.toContain(CFG.clientSecret);

    const html = recorder(() => ({ status: 502, text: '<html>bad gateway</html>' }));
    try {
      await cashfreeHttp({ ...CFG, fetchImpl: html.fetchImpl }).getLink('L');
    } catch (err) {
      e = err;
    }
    expect((e as CashfreeError).status).toBe(502);
    expect((e as CashfreeError).code).toBe('http_502');
  });

  it('refuses to build without an id, a secret, a version, or an env other than sandbox or production', () => {
    expect(() => cashfreeHttp({ ...CFG, clientId: '' })).toThrow(/client id/);
    expect(() => cashfreeHttp({ ...CFG, clientSecret: '' })).toThrow(/client secret/);
    expect(() => cashfreeHttp({ ...CFG, apiVersion: '' })).toThrow(/API version/);
    expect(() => cashfreeHttp({ ...CFG, env: 'staging' as never })).toThrow(/sandbox or production/);
  });
});
