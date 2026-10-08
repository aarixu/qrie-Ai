// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractEvent } from '../src/extract.ts';

/**
 * WHAT OF A WEBHOOK IS KEPT. Written first.
 *
 * The extract is what admin.billing_webhook_ingest stores (migration 0059
 * whitelists it again): the link, its order and the two notes Qrie set, in
 * paise. Never the customer's details, the link's URL or its purpose.
 */

// The shape of Cashfree's documented payment-link webhook
// (https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/webhooks.md):
// cf_link_id and transaction_id as numbers, amounts as rupee strings.
const LINK_EVENT = {
  data: {
    cf_link_id: 1576977,
    link_id: 'QRIE-26-27-0001',
    link_status: 'PARTIALLY_PAID',
    link_currency: 'INR',
    link_amount: '200.12',
    link_amount_paid: '55.00',
    link_partial_payments: true,
    link_minimum_partial_amount: '11.00',
    link_purpose: 'Payment for order',
    link_created_at: '2021-08-18T07:13:41',
    customer_details: { customer_phone: '9000000000', customer_email: 'john@gmail.com', customer_name: 'John' },
    link_meta: { notify_url: 'https://example.com/notify' },
    link_url: 'https://payments-test.cashfree.com/links/o1tf1nvcvjhg',
    link_expiry_time: '2021-11-28T21:46:20',
    link_notes: { school: 'ABC', invoice: 'QRIE/26-27/0001', other: 'dropped' },
    link_auto_reminders: true,
    link_notify: { send_sms: true, send_email: true },
    order: {
      order_amount: '22.00',
      order_id: 'CFPay_U1mgll3c0e9g_ehdcjjbtckf',
      order_expiry_time: '2021-08-18T07:34:50',
      order_hash: 'Gb2gC7z0tILhGbZUIeds',
      transaction_amount: '22.00',
      transaction_id: 1021206,
      transaction_status: 'SUCCESS',
    },
  },
  type: 'PAYMENT_LINK_EVENT',
  version: 1,
  event_time: '2021-08-18T12:55:06+05:30',
};

const REFUND_EVENT = {
  data: {
    refund: {
      cf_refund_id: 11325632,
      cf_payment_id: 789727431,
      refund_id: 'qrierf0123456789abcdef0123456789abcdef',
      order_id: 'CFPay_U1mgll3c0e9g_ehdcjjbtckf',
      refund_amount: 2,
      refund_currency: 'INR',
      refund_note: 'Refund for QRIE/26-27/0001',
      refund_status: 'SUCCESS',
      refund_arn: '205907959',
    },
  },
  event_time: '2022-02-28T13:04:28+05:30',
  type: 'REFUND_STATUS_WEBHOOK',
};

describe('the extract', () => {
  it('a PAYMENT_LINK_EVENT keeps the link, its order and the two notes, in paise', () => {
    expect(extractEvent(LINK_EVENT)).toEqual({
      type: 'PAYMENT_LINK_EVENT',
      eventTime: '2021-08-18T12:55:06+05:30',
      link: {
        linkId: 'QRIE-26-27-0001',
        cfLinkId: '1576977',
        status: 'PARTIALLY_PAID',
        amountPaise: 20012,
        amountPaidPaise: 5500,
        currency: 'INR',
        notes: { school: 'ABC', invoice: 'QRIE/26-27/0001' },
      },
      order: {
        orderId: 'CFPay_U1mgll3c0e9g_ehdcjjbtckf',
        amountPaise: 2200,
        transactionId: '1021206',
        transactionStatus: 'SUCCESS',
      },
    });
    const expired = extractEvent({ ...LINK_EVENT, data: { ...LINK_EVENT.data, link_status: 'EXPIRED', order: null } });
    expect((expired as { order: unknown }).order).toBeNull();
  });

  it('customer details, the link URL, the purpose and any other field are dropped', () => {
    const text = JSON.stringify(extractEvent(LINK_EVENT));
    for (const gone of ['9000000000', 'john@gmail.com', 'John', 'link_url', 'payments-test', 'Payment for order', 'dropped', 'order_hash']) {
      expect(text).not.toContain(gone);
    }
  });

  it('a REFUND_STATUS_WEBHOOK keeps refund id, order id, status and amount in paise', () => {
    expect(extractEvent(REFUND_EVENT)).toEqual({
      type: 'REFUND_STATUS_WEBHOOK',
      eventTime: '2022-02-28T13:04:28+05:30',
      refund: {
        refundId: 'qrierf0123456789abcdef0123456789abcdef',
        cfRefundId: '11325632',
        orderId: 'CFPay_U1mgll3c0e9g_ehdcjjbtckf',
        status: 'SUCCESS',
        amountPaise: 200,
      },
    });
  });

  it('anything else keeps only its type and time', () => {
    expect(extractEvent({ type: 'SUBSCRIPTION_STATUS_CHANGED', event_time: 't', data: { customer_phone: '9000000000' } })).toEqual({
      type: 'SUBSCRIPTION_STATUS_CHANGED',
      eventTime: 't',
    });
    expect(extractEvent({ data: {} })).toEqual({});
    expect(extractEvent(42)).toBeNull();
    expect(extractEvent(null)).toBeNull();
  });

  it('a malformed amount gives null', () => {
    expect(extractEvent({ ...LINK_EVENT, data: { ...LINK_EVENT.data, link_amount: '200.123' } })).toBeNull();
    expect(
      extractEvent({ ...LINK_EVENT, data: { ...LINK_EVENT.data, order: { ...LINK_EVENT.data.order, order_amount: 'lots' } } }),
    ).toBeNull();
    expect(extractEvent({ ...REFUND_EVENT, data: { refund: { ...REFUND_EVENT.data.refund, refund_amount: -2 } } })).toBeNull();
  });
});
