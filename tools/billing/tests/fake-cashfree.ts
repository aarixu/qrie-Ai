import {
  CashfreeError,
  type CashfreeApi,
  type CashfreeLink,
  type CashfreeLinkOrder,
  type CashfreeRefund,
} from '../src/cashfree.ts';

/**
 * A STAND-IN FOR CASHFREE, IN MEMORY, WITH CASHFREE'S FIELD NAMES.
 *
 * Links and refunds live in two maps. A repeated link id is refused with 409
 * (what Cashfree answers for one is UNVERIFIED), a link that is not there is
 * 404, and only an ACTIVE link can be cancelled (Cashfree's documented rule).
 * failNext makes the next call fail the way Cashfree or the network would.
 * pay records a paid order on a link, as a school paying would.
 */

interface FakeLink extends CashfreeLink {
  orders: CashfreeLinkOrder[];
}

export interface FakeCashfree {
  api: CashfreeApi;
  calls: { method: string; args: unknown[] }[];
  links: Map<string, FakeLink>;
  refunds: Map<string, CashfreeRefund>;
  /** The status the next created refund answers with: SUCCESS unless set. */
  nextRefundStatus: string;
  failNext(status: number, code: string): void;
  pay(linkId: string, orderId: string, amountPaise: number): void;
}

export function fakeCashfree(): FakeCashfree {
  const calls: FakeCashfree['calls'] = [];
  const links = new Map<string, FakeLink>();
  const refunds = new Map<string, CashfreeRefund>();
  let failure: { status: number; code: string } | null = null;
  let seq = 1_576_977;

  const step = (method: string, args: unknown[]) => {
    calls.push({ method, args });
    if (failure) {
      const f = failure;
      failure = null;
      throw new CashfreeError(f.status, f.code, `Cashfree answered ${f.status} ${f.code}`);
    }
  };
  const view = (l: FakeLink): CashfreeLink => ({
    link_id: l.link_id,
    cf_link_id: l.cf_link_id,
    link_url: l.link_url,
    link_status: l.link_status,
    link_amount: l.link_amount,
    link_amount_paid: l.link_amount_paid,
    link_currency: l.link_currency,
    ...(l.link_expiry_time ? { link_expiry_time: l.link_expiry_time } : {}),
  });
  const find = (linkId: string): FakeLink => {
    const l = links.get(linkId);
    if (!l) throw new CashfreeError(404, 'link_not_found', 'Cashfree answered 404 link_not_found');
    return l;
  };

  const fake: FakeCashfree = {
    calls,
    links,
    refunds,
    nextRefundStatus: 'SUCCESS',
    failNext(status, code) {
      failure = { status, code };
    },
    pay(linkId, orderId, amountPaise) {
      const l = find(linkId);
      l.orders.push({ order_id: orderId, order_amount: amountPaise / 100, order_currency: 'INR', order_status: 'PAID' });
      l.link_amount_paid = Math.round(l.link_amount_paid * 100 + amountPaise) / 100;
      l.link_status = l.link_amount_paid >= l.link_amount ? 'PAID' : 'PARTIALLY_PAID';
    },
    api: {
      async createLink(body, idempotencyKey) {
        step('createLink', [body, idempotencyKey]);
        if (links.has(body.link_id)) throw new CashfreeError(409, 'link_already_exists', 'Cashfree answered 409 link_already_exists');
        const l: FakeLink = {
          link_id: body.link_id,
          cf_link_id: String(seq++),
          link_url: `https://payments-test.cashfree.com/links/${body.link_id.toLowerCase()}`,
          link_status: 'ACTIVE',
          link_amount: body.link_amount,
          link_amount_paid: 0,
          link_currency: body.link_currency,
          link_expiry_time: body.link_expiry_time,
          orders: [],
        };
        links.set(l.link_id, l);
        return view(l);
      },
      async getLink(linkId) {
        step('getLink', [linkId]);
        return view(find(linkId));
      },
      async linkOrders(linkId) {
        step('linkOrders', [linkId]);
        return find(linkId).orders.map((o) => ({ ...o }));
      },
      async cancelLink(linkId) {
        step('cancelLink', [linkId]);
        const l = find(linkId);
        if (l.link_status !== 'ACTIVE') throw new CashfreeError(400, 'link_not_active', 'Cashfree answered 400 link_not_active');
        l.link_status = 'CANCELLED';
        return view(l);
      },
      async createRefund(orderId, body, idempotencyKey) {
        step('createRefund', [orderId, body, idempotencyKey]);
        const r: CashfreeRefund = {
          refund_id: body.refund_id,
          cf_refund_id: String(seq++),
          order_id: orderId,
          refund_amount: body.refund_amount,
          refund_status: fake.nextRefundStatus,
        };
        refunds.set(r.refund_id, r);
        return { ...r };
      },
      async getRefund(orderId, refundId) {
        step('getRefund', [orderId, refundId]);
        const r = refunds.get(refundId);
        if (!r || r.order_id !== orderId) throw new CashfreeError(404, 'refund_not_found', 'Cashfree answered 404 refund_not_found');
        return { ...r };
      },
    },
  };
  return fake;
}
