import type { BillingOverview, InvoiceDetail, InvoiceRow, InvoiceStatus, PaymentRow, SchoolBillingState } from '@ai-tutor/admin-client';
import { formatPaise } from './money.ts';

/**
 * What the billing pages show and offer, decided in one pure place.
 *
 * Rights (spec section 3, ruling R9): the owner may do everything; ops read,
 * raise invoices (and set a school's billing account) and send links; finance
 * reads and records money received by hand; safety sees no billing. Reversing
 * a payment by hand, refunds and voids are the owner's. A button a role may
 * not use is not shown, and the database refuses it anyway.
 */

export type StaffRole = 'owner' | 'ops' | 'safety' | 'finance';

export interface BillingRights {
  read: boolean;
  raise: boolean;
  sendLink: boolean;
  record: boolean;
  reverse: boolean;
  refund: boolean;
  void: boolean;
  settings: boolean;
  grace: boolean;
}

export function billingRights(role: StaffRole): BillingRights {
  const owner = role === 'owner';
  return {
    read: owner || role === 'ops' || role === 'finance',
    raise: owner || role === 'ops',
    sendLink: owner || role === 'ops',
    record: owner || role === 'finance',
    reverse: owner,
    refund: owner,
    void: owner,
    settings: owner,
    grace: owner,
  };
}

export type Tone = 'ok' | 'warn' | 'bad' | 'grey';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' -> 'DD Mon YYYY'; anything else as it is. */
export function formatDay(day: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? '');
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : (day ?? '');
}

/** Whole days from one 'YYYY-MM-DD' to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const STATUS_LABEL: Record<InvoiceStatus, string> = { unpaid: 'Unpaid', partly_paid: 'Partly paid', paid: 'Paid', void: 'Void' };

/** Paid is ok, void grey; an unpaid one is grey until its due day passes, then warn for 14 days, then bad. */
export function invoiceTone(status: InvoiceStatus, dueOn: string, today: string): { tone: Tone; label: string } {
  if (status === 'paid') return { tone: 'ok', label: 'Paid' };
  if (status === 'void') return { tone: 'grey', label: 'Void' };
  const late = daysBetween(dueOn, today);
  if (late <= 0) return { tone: 'grey', label: STATUS_LABEL[status] };
  return { tone: late <= 14 ? 'warn' : 'bad', label: `${STATUS_LABEL[status]}, ${late} day${late === 1 ? '' : 's'} late` };
}

/**
 * Void is offered only while no money is kept on the invoice: nothing paid, or
 * all of it refunded (Cashfree reported SUCCESS), and nothing Cashfree reported
 * paid is still unrecorded. The database checks the same, and also waits for
 * any refund still pending.
 */
export function canVoid(i: InvoiceRow): boolean {
  return i.status !== 'void' && i.paidPaise - i.refundedPaise <= 0 && i.unrecordedPaise === 0;
}

export function voidBlast(i: InvoiceRow): string {
  return [
    `Invoice ${i.number} is cancelled for good.`,
    'Its number stays used.',
    i.paidPaise > 0 ? 'What was paid on it went back in full; its credit notes stand.' : '',
    i.openLink ? 'Its payment link is cancelled at Cashfree first.' : '',
    'The licence does not change.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function reverseBlast(p: PaymentRow): string {
  return [
    `${formatPaise(p.amountPaise)} recorded by hand against ${p.invoiceNumber ?? 'its invoice'} stops counting; the payment stays listed, marked reversed.`,
    'No money moves: if it was received and must go back, send it back by bank.',
    "A licence it set stays; change it on the school's page if needed.",
  ].join(' ');
}

export function refundBlast(p: PaymentRow, amountPaise: number): string {
  return [
    `${formatPaise(amountPaise)} goes back to the payer through Cashfree.`,
    p.counted
      ? 'A credit note is issued when Cashfree confirms.'
      : 'No credit note: this payment was never counted against an invoice.',
    "The licence does not change; change it on the school's page if needed.",
  ].join(' ');
}

/** `sub` is the invoice's subscription, when it has one, for the licence it would set. */
export function paymentBlast(i: InvoiceDetail, amountPaise: number, sub?: { seats: number; endsOn: string } | null): string {
  const left = i.totalPaise - i.paidPaise - amountPaise;
  const parts = [`${formatPaise(amountPaise)} is recorded against ${i.number}.`];
  if (left > 0) {
    parts.push(`${formatPaise(left)} stays due.`);
  } else if (i.kind === 'subscription' && sub) {
    parts.push(
      `This pays it in full and sets ${i.schoolName}'s licence to ${sub.seats} seats until ${formatDay(sub.endsOn)}, unless a later period is already paid.`,
    );
  } else {
    parts.push('This pays it in full.');
  }
  const open = i.links.find((l) => ['creating', 'active', 'partly_paid'].includes(l.status));
  if (open) {
    parts.push(
      `Its payment link for ${formatPaise(open.amountPaise)} is cancelled at Cashfree first, so the school cannot pay it as well${left > 0 ? '; send a new link for what stays due.' : '.'}`,
    );
  }
  return parts.join(' ');
}

export function linkBlast(i: InvoiceRow, hasEmail: boolean): string {
  return `Cashfree makes a payment page for ${formatPaise(i.totalPaise - i.paidPaise)}.${hasEmail ? ' Cashfree emails it to the billing contact.' : ''}`;
}

export interface PrintLine {
  label: string;
  amount: string;
}

const percent = (bp: number) => `${Number((bp / 100).toFixed(2))}%`;

/** The printable invoice: what each block says, with the tax lines that apply. */
export function printModel(d: InvoiceDetail): {
  title: string;
  number: string;
  seller: string[];
  buyer: string[];
  lines: PrintLine[];
  total: string;
  sac: string;
  rate: string;
  status: string;
} {
  const s = d.seller;
  const b = d.buyer;
  const lines: PrintLine[] = [
    {
      label: `${d.description} (${d.quantity} × ${formatPaise(d.unitPaise)})`,
      amount: formatPaise(d.taxablePaise),
    },
  ];
  if (d.igstPaise > 0) {
    lines.push({ label: `IGST at ${percent(d.gstRateBp)}`, amount: formatPaise(d.igstPaise) });
  } else if (d.cgstPaise > 0 || d.sgstPaise > 0) {
    lines.push({ label: `CGST at ${percent(d.gstRateBp / 2)}`, amount: formatPaise(d.cgstPaise) });
    lines.push({ label: `SGST at ${percent(d.gstRateBp / 2)}`, amount: formatPaise(d.sgstPaise) });
  }
  const status =
    d.status === 'paid' ? `Paid on ${formatDay(d.paidOn)}` : d.status === 'partly_paid' ? `Partly paid: ${formatPaise(d.paidPaise)} received` : STATUS_LABEL[d.status];
  return {
    title: s.title || 'Tax invoice',
    number: d.number,
    seller: [
      s.legalName ?? '',
      s.address ?? '',
      s.gstin ? `GSTIN ${s.gstin}` : 'Not registered under GST',
      `State code ${s.stateCode ?? ''}`,
    ],
    buyer: [
      b.legalName ?? '',
      b.address ?? '',
      b.gstin ? `GSTIN ${b.gstin}` : 'Unregistered',
      `State code ${b.stateCode ?? ''}`,
      `School code ${b.schoolCode ?? ''}`,
    ],
    lines,
    total: formatPaise(d.totalPaise),
    sac: s.sacCode ?? '',
    rate: percent(d.gstRateBp),
    status,
  };
}

/** The overview's "Needs attention": every count a person has to look at, and what each is. */
export function attentionSummary(a: BillingOverview['attention']): { count: number; detail: string } {
  return {
    count: a.notCounted + a.linksUnrecorded + a.webhookProblems24h + a.signatureFailures24h,
    detail: [
      `${a.notCounted} payments not counted`,
      `${a.linksUnrecorded} links Cashfree says are paid with no payment recorded`,
      `${a.webhookProblems24h} webhook problems`,
      `${a.signatureFailures24h} signature failures (24 h)`,
    ].join(' · '),
  };
}

export function stateLabel(state: SchoolBillingState | string, graceUntil: string | null): { tone: Tone; text: string } {
  switch (state) {
    case 'trial':
      return { tone: 'ok', text: 'Trial' };
    case 'active':
      return { tone: 'ok', text: 'Active' };
    case 'grace':
      return { tone: 'warn', text: `Grace until ${formatDay(graceUntil)}` };
    case 'suspended':
      return { tone: 'bad', text: 'Suspended: the tutor is off' };
    case 'ended':
      return { tone: 'bad', text: 'Ended: the tutor is off' };
    default:
      return { tone: 'grey', text: 'No licence' };
  }
}

/** Today's date in India, YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
