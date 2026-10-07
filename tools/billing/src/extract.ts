import { MoneyError, paiseFromRupees } from './money.ts';

/**
 * WHAT OF A CASHFREE WEBHOOK BILLING KEEPS.
 *
 * Three shapes, with amounts in paise and ids as strings (Cashfree documents
 * cf_link_id, transaction_id and cf_refund_id as numbers in its examples):
 *
 *   { type: 'PAYMENT_LINK_EVENT', eventTime,
 *     link: { linkId, cfLinkId, status, amountPaise, amountPaidPaise, currency, notes: { school, invoice } },
 *     order: { orderId, amountPaise, transactionId, transactionStatus } | null }
 *   { type: 'REFUND_STATUS_WEBHOOK', eventTime,
 *     refund: { refundId, cfRefundId, orderId, status, amountPaise } }
 *   { type, eventTime }   for any other event
 *
 * Everything else, the customer's details, the link's URL and purpose among
 * them, is left behind. The notes keep only school and invoice, each cut to 40
 * characters. admin.billing_webhook_ingest (migration 0059) whitelists the same
 * fields again before storing them.
 */
export type WebhookExtract = Record<string, unknown>;

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A string as itself, a number as its digits, anything else left out. */
const str = (v: unknown, max = 60): string | undefined =>
  typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, max) : undefined;

class Malformed extends Error {}

/** Paise from Cashfree's rupees; absent stays absent; present but malformed stops the extract. */
const paise = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  try {
    return paiseFromRupees(v as string | number);
  } catch (e) {
    if (e instanceof MoneyError) throw new Malformed();
    throw e;
  }
};

/** Drops the keys whose value is undefined, so the JSON says only what was there. */
const compact = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** The whitelisted extract, with amounts in paise; null when the amounts are malformed or the body is not an object. */
export function extractEvent(payload: unknown): WebhookExtract | null {
  const root = obj(payload);
  if (!root) return null;
  const head = compact({ type: str(root.type), eventTime: str(root.event_time, 40) });
  const data = obj(root.data) ?? {};
  try {
    if (root.type === 'PAYMENT_LINK_EVENT') {
      const notes = obj(data.link_notes);
      const order = obj(data.order);
      return {
        ...head,
        link: compact({
          linkId: str(data.link_id, 50),
          cfLinkId: str(data.cf_link_id, 40),
          status: str(data.link_status, 30),
          amountPaise: paise(data.link_amount),
          amountPaidPaise: paise(data.link_amount_paid),
          currency: str(data.link_currency, 3),
          notes: notes ? compact({ school: str(notes.school, 40), invoice: str(notes.invoice, 40) }) : undefined,
        }),
        order: order
          ? compact({
              orderId: str(order.order_id),
              amountPaise: paise(order.order_amount),
              transactionId: str(order.transaction_id, 40),
              transactionStatus: str(order.transaction_status, 30),
            })
          : null,
      };
    }
    if (root.type === 'REFUND_STATUS_WEBHOOK') {
      const r = obj(data.refund) ?? {};
      return {
        ...head,
        refund: compact({
          refundId: str(r.refund_id, 40),
          cfRefundId: str(r.cf_refund_id, 40),
          orderId: str(r.order_id),
          status: str(r.refund_status, 30),
          amountPaise: paise(r.refund_amount),
        }),
      };
    }
  } catch (e) {
    if (e instanceof Malformed) return null;
    throw e;
  }
  return head;
}
