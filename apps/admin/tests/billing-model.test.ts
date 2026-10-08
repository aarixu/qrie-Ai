import type { InvoiceDetail, InvoiceRow, PaymentRow } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import {
  attentionSummary,
  billingRights,
  canVoid,
  invoiceTone,
  linkBlast,
  paymentBlast,
  printModel,
  refundBlast,
  reverseBlast,
  stateLabel,
  todayIst,
  voidBlast,
} from '../src/features/billing/model.ts';

/** What the billing pages show and allow, decided in one pure place. Written first. */

const row: InvoiceRow = {
  id: 'inv-1',
  number: 'QRIE/26-27/0001',
  orgId: 'org-1',
  schoolCode: 'ABC',
  schoolName: 'ABC Public School',
  kind: 'subscription',
  issuedOn: '2026-10-07',
  dueOn: '2026-10-22',
  totalPaise: 2_360_000,
  paidPaise: 0,
  status: 'unpaid',
  unrecordedPaise: 0,
  refundedPaise: 0,
  openLink: null,
};

const detail: InvoiceDetail = {
  ...row,
  subscriptionId: 'sub-1',
  description: 'Standard plan, 40 seats, 01 Apr 2026 to 31 Mar 2027',
  quantity: 40,
  unitPaise: 50_000,
  taxablePaise: 2_000_000,
  gstRateBp: 1800,
  cgstPaise: 180_000,
  sgstPaise: 180_000,
  igstPaise: 0,
  seller: {
    legalName: 'Qrie Learning Private Limited',
    gstin: '27AAAAA0000A1Z5',
    stateCode: '27',
    address: 'Pune, Maharashtra',
    sacCode: '999293',
    title: 'Tax invoice',
  },
  buyer: {
    legalName: 'ABC Education Trust',
    gstin: '27ABCDE1234F1Z5',
    stateCode: '27',
    address: '1 School Road',
    schoolCode: 'ABC',
    schoolName: 'ABC Public School',
  },
  paidOn: null,
  voidedAt: null,
  links: [],
  payments: [],
  creditNotes: [],
};

const payment: PaymentRow = {
  id: 'pay-1',
  orgId: 'org-1',
  schoolCode: 'ABC',
  invoiceId: 'inv-1',
  invoiceNumber: 'QRIE/26-27/0001',
  source: 'cashfree_link',
  amountPaise: 2_360_000,
  receivedOn: '2026-10-07',
  reference: 'CFPay_1',
  counted: true,
  notCountedWhy: null,
  recordedAs: 'Cashfree',
  refundedPaise: 0,
  refundable: true,
  reversedAt: null,
  reversedAs: null,
  reversible: false,
};

describe('the billing model', () => {
  it('rights by role', () => {
    const all = { read: true, raise: true, sendLink: true, record: true, reverse: true, refund: true, void: true, settings: true, grace: true };
    const none = {
      read: false,
      raise: false,
      sendLink: false,
      record: false,
      reverse: false,
      refund: false,
      void: false,
      settings: false,
      grace: false,
    };
    expect(billingRights('owner')).toEqual(all);
    expect(billingRights('ops')).toEqual({ ...none, read: true, raise: true, sendLink: true });
    expect(billingRights('finance')).toEqual({ ...none, read: true, record: true });
    expect(billingRights('safety')).toEqual(none);
  });

  it('invoice tone: paid ok, void grey, unpaid before its due day grey, 1 to 14 days late warn, later bad', () => {
    expect(invoiceTone('paid', '2026-10-22', '2026-12-01')).toEqual({ tone: 'ok', label: 'Paid' });
    expect(invoiceTone('void', '2026-10-22', '2026-12-01')).toEqual({ tone: 'grey', label: 'Void' });
    expect(invoiceTone('unpaid', '2026-10-22', '2026-10-22')).toEqual({ tone: 'grey', label: 'Unpaid' });
    expect(invoiceTone('partly_paid', '2026-10-22', '2026-10-23')).toEqual({ tone: 'warn', label: 'Partly paid, 1 day late' });
    expect(invoiceTone('unpaid', '2026-10-22', '2026-11-05')).toEqual({ tone: 'warn', label: 'Unpaid, 14 days late' });
    expect(invoiceTone('unpaid', '2026-10-22', '2026-11-06')).toEqual({ tone: 'bad', label: 'Unpaid, 15 days late' });
  });

  it('blast lines name the amount, the licence effect and an open link', () => {
    expect(voidBlast(row)).toBe('Invoice QRIE/26-27/0001 is cancelled for good. Its number stays used. The licence does not change.');
    expect(voidBlast({ ...row, openLink: { linkId: 'L', url: 'https://x', status: 'active' } })).toBe(
      'Invoice QRIE/26-27/0001 is cancelled for good. Its number stays used. Its payment link is cancelled at Cashfree first. The licence does not change.',
    );
    expect(refundBlast(payment, 1_000_000)).toBe(
      '₹10,000.00 goes back to the payer through Cashfree. A credit note is issued when Cashfree confirms. The licence does not change; change it on the school\'s page if needed.',
    );
    expect(refundBlast({ ...payment, counted: false }, 1000)).toContain('No credit note: this payment was never counted against an invoice.');
    expect(paymentBlast(detail, 2_360_000, { seats: 40, endsOn: '2027-03-31' })).toBe(
      '₹23,600.00 is recorded against QRIE/26-27/0001. This pays it in full and sets ABC Public School\'s licence to 40 seats until 31 Mar 2027, unless a later period is already paid.',
    );
    expect(paymentBlast(detail, 1_000_000)).toBe('₹10,000.00 is recorded against QRIE/26-27/0001. ₹13,600.00 stays due.');
    const withLink: InvoiceDetail = {
      ...detail,
      kind: 'other',
      subscriptionId: null,
      links: [{ linkId: 'L', url: 'https://x', status: 'active', amountPaise: 2_360_000, amountPaidPaise: 0, unrecordedPaise: 0, expiresAt: 'x', createdAt: 'x' }],
    };
    expect(paymentBlast(withLink, 2_360_000)).toBe(
      '₹23,600.00 is recorded against QRIE/26-27/0001. This pays it in full. Its payment link for ₹23,600.00 is cancelled at Cashfree first, so the school cannot pay it as well.',
    );
    expect(paymentBlast(withLink, 1_000_000)).toBe(
      '₹10,000.00 is recorded against QRIE/26-27/0001. ₹13,600.00 stays due. Its payment link for ₹23,600.00 is cancelled at Cashfree first, so the school cannot pay it as well; send a new link for what stays due.',
    );
    expect(linkBlast(row, true)).toBe('Cashfree makes a payment page for ₹23,600.00. Cashfree emails it to the billing contact.');
    expect(linkBlast({ ...row, paidPaise: 360_000 }, false)).toBe('Cashfree makes a payment page for ₹20,000.00.');
  });

  it('an invoice can be voided only when no money is kept on it: nothing paid, or all of it refunded, and nothing Cashfree reported is unrecorded', () => {
    expect(canVoid(row)).toBe(true);
    expect(canVoid({ ...row, status: 'partly_paid', paidPaise: 100 })).toBe(false);
    expect(canVoid({ ...row, status: 'paid', paidPaise: 2_360_000, refundedPaise: 2_360_000 })).toBe(true);
    expect(canVoid({ ...row, status: 'paid', paidPaise: 2_360_000, refundedPaise: 2_359_999 })).toBe(false);
    expect(canVoid({ ...row, status: 'void' })).toBe(false);
    expect(canVoid({ ...row, unrecordedPaise: 1 })).toBe(false);
    expect(voidBlast({ ...row, status: 'paid', paidPaise: 2_360_000, refundedPaise: 2_360_000 })).toBe(
      'Invoice QRIE/26-27/0001 is cancelled for good. Its number stays used. What was paid on it went back in full; its credit notes stand. The licence does not change.',
    );
  });

  it('reversing a payment by hand: what stops counting, that no money moves, and that the licence stays', () => {
    const byHand: PaymentRow = { ...payment, source: 'cheque', amountPaise: 11_800, reference: 'CHQ 777', refundable: false, reversible: true };
    expect(reverseBlast(byHand)).toBe(
      "₹118.00 recorded by hand against QRIE/26-27/0001 stops counting; the payment stays listed, marked reversed. No money moves: if it was received and must go back, send it back by bank. A licence it set stays; change it on the school's page if needed.",
    );
  });

  it('print model: CGST and SGST inside one state, IGST across, lines add up to the total, "Not registered under GST" when the seller has no GSTIN, both GSTINs when present, SAC and rate printed', () => {
    const inside = printModel(detail);
    expect(inside.title).toBe('Tax invoice');
    expect(inside.number).toBe('QRIE/26-27/0001');
    expect(inside.lines).toEqual([
      { label: 'Standard plan, 40 seats, 01 Apr 2026 to 31 Mar 2027 (40 × ₹500.00)', amount: '₹20,000.00' },
      { label: 'CGST at 9%', amount: '₹1,800.00' },
      { label: 'SGST at 9%', amount: '₹1,800.00' },
    ]);
    expect(inside.total).toBe('₹23,600.00');
    expect(inside.sac).toBe('999293');
    expect(inside.rate).toBe('18%');
    expect(inside.seller).toContain('GSTIN 27AAAAA0000A1Z5');
    expect(inside.buyer).toContain('GSTIN 27ABCDE1234F1Z5');
    expect(inside.status).toBe('Unpaid');

    const across = printModel({ ...detail, cgstPaise: 0, sgstPaise: 0, igstPaise: 360_000, buyer: { ...detail.buyer, stateCode: '29', gstin: null } });
    expect(across.lines.slice(1)).toEqual([{ label: 'IGST at 18%', amount: '₹3,600.00' }]);
    expect(across.buyer).toContain('Unregistered');

    const unregistered = printModel({
      ...detail,
      gstRateBp: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      totalPaise: 2_000_000,
      seller: { ...detail.seller, gstin: null },
      status: 'paid',
      paidOn: '2026-10-08',
    });
    expect(unregistered.seller).toContain('Not registered under GST');
    expect(unregistered.lines).toHaveLength(1);
    expect(unregistered.total).toBe('₹20,000.00');
    expect(unregistered.status).toBe('Paid on 08 Oct 2026');
  });

  it('state labels: grace says its last day, suspended and ended say the tutor is off', () => {
    expect(stateLabel('grace', '2026-10-21')).toEqual({ tone: 'warn', text: 'Grace until 21 Oct 2026' });
    expect(stateLabel('suspended', null)).toEqual({ tone: 'bad', text: 'Suspended: the tutor is off' });
    expect(stateLabel('ended', null)).toEqual({ tone: 'bad', text: 'Ended: the tutor is off' });
    expect(stateLabel('active', null)).toEqual({ tone: 'ok', text: 'Active' });
    expect(stateLabel('trial', null)).toEqual({ tone: 'ok', text: 'Trial' });
    expect(stateLabel('none', null)).toEqual({ tone: 'grey', text: 'No licence' });
  });

  it('needs attention adds up money not counted, money Cashfree reported that is not recorded, webhook problems and signature failures', () => {
    const a = {
      notCounted: 1,
      linksUnrecorded: 2,
      webhookProblems24h: 3,
      signatureFailures24h: 4,
      lastWebhookMinutesAgo: null,
      reconciledMinutesAgo: null,
      openLinks: 0,
    };
    expect(attentionSummary(a)).toEqual({
      count: 10,
      detail:
        '1 payments not counted · 2 links Cashfree says are paid with no payment recorded · 3 webhook problems · 4 signature failures (24 h)',
    });
  });

  it('todayIst turns at midnight India time', () => {
    expect(todayIst(new Date('2026-03-31T18:29:00Z'))).toBe('2026-03-31');
    expect(todayIst(new Date('2026-03-31T18:30:00Z'))).toBe('2026-04-01');
  });
});
