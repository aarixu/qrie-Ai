import { AdminError, toAdminError } from './errors.ts';
import type { AdminTransport } from './transport.ts';

/**
 * BILLING, FOR THE CONSOLE (plan 3).
 *
 * Two doors, one client:
 *   - the admin.billing_* functions (migrations 0057 to 0060) through the same
 *     transport as every other admin call: reads, and the writes that never
 *     reach Cashfree (settings, plans, accounts, subscriptions, invoices,
 *     offline payments, grace days);
 *   - billing-api (supabase/functions/billing-api), the only caller of
 *     Cashfree, for a payment link, a check, a void and a refund. It asks the
 *     database as the signed-in staff member, with their session's token.
 * Every failure of either arrives as an AdminError, sorted by toAdminError.
 * Money is whole paise; days are YYYY-MM-DD.
 */

export type StaffRoleWithFinance = 'owner' | 'ops' | 'safety' | 'finance';
export type InvoiceStatus = 'unpaid' | 'partly_paid' | 'paid' | 'void';
export type SchoolBillingState = 'none' | 'trial' | 'active' | 'grace' | 'suspended' | 'ended';
export type PaymentSource = 'cashfree_link' | 'bank_transfer' | 'cheque';

export interface BillingSettings {
  legalName: string;
  gstin: string | null;
  stateCode: string;
  address: string;
  sacCode: string;
  gstRateBp: number | null;
  title: string;
  ready: boolean;
  updatedAt: string;
}

export interface BillingPlan {
  code: string;
  name: string;
  months: number;
  seatPricePaise: number;
  active: boolean;
}

export interface OpenLink {
  linkId: string;
  url: string | null;
  status: string;
}

export interface InvoiceRow {
  id: string;
  number: string;
  orgId: string;
  schoolCode: string;
  schoolName: string;
  kind: 'subscription' | 'other';
  issuedOn: string;
  dueOn: string;
  totalPaise: number;
  paidPaise: number;
  status: InvoiceStatus;
  openLink: OpenLink | null;
}

export interface LinkRow {
  linkId: string;
  url: string | null;
  status: string;
  amountPaise: number;
  amountPaidPaise: number;
  expiresAt: string;
  createdAt: string;
}

/** A payment as one invoice lists it. */
export interface InvoicePayment {
  id: string;
  source: PaymentSource;
  amountPaise: number;
  receivedOn: string;
  reference: string;
  counted: boolean;
  notCountedWhy: string | null;
  recordedAs: string;
  refundedPaise: number;
}

export interface CreditNoteRow {
  number: string;
  amountPaise: number;
  taxablePaise: number;
  taxPaise: number;
  issuedOn: string;
}

export interface InvoiceDetail extends InvoiceRow {
  subscriptionId: string | null;
  description: string;
  quantity: number;
  unitPaise: number;
  taxablePaise: number;
  gstRateBp: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  seller: Record<string, string | null>;
  buyer: Record<string, string | null>;
  paidOn: string | null;
  voidedAt: string | null;
  links: LinkRow[];
  payments: InvoicePayment[];
  creditNotes: CreditNoteRow[];
}

export interface PaymentRow {
  id: string;
  orgId: string;
  schoolCode: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  source: PaymentSource;
  amountPaise: number;
  receivedOn: string;
  reference: string;
  counted: boolean;
  notCountedWhy: string | null;
  recordedAs: string;
  refundedPaise: number;
  refundable: boolean;
}

export interface SubscriptionRow {
  id: string;
  orgId: string;
  schoolCode: string;
  schoolName: string;
  plan: string;
  planName: string;
  seats: number;
  startsOn: string;
  endsOn: string;
  seatPricePaise: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: InvoiceStatus | null;
  licenceAppliedAt: string | null;
  cancelledAt: string | null;
}

export interface WebhookRow {
  id: number;
  receivedAt: string;
  status: string;
  detail: string | null;
  eventType: string | null;
  linkId: string | null;
  orderId: string | null;
}

export interface BillingOverview {
  collectedThisMonthPaise: number;
  outstandingPaise: number;
  overdue: { count: number; paise: number };
  renewals: { in30: number; in60: number; in90: number };
  states: { grace: number; suspended: number };
  attention: {
    notCounted: number;
    webhookProblems24h: number;
    signatureFailures24h: number;
    lastWebhookMinutesAgo: number | null;
    reconciledMinutesAgo: number | null;
    openLinks: number;
  };
}

export interface AccountRow {
  orgId: string;
  code: string;
  name: string;
  hasAccount: boolean;
  state: SchoolBillingState;
  licenceUntil: string | null;
  outstandingPaise: number;
  overdueDays: number;
}

export interface BillingAccount {
  legalName: string;
  gstin: string | null;
  stateCode: string;
  address: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  graceDays: number;
  updatedAt: string;
}

export interface PaymentSignal {
  level: 'green' | 'amber' | 'red' | 'grey';
  reason: string;
}

export interface SchoolBilling {
  school: { orgId: string; code: string; name: string };
  account: BillingAccount | null;
  state: { state: SchoolBillingState; graceUntil: string | null };
  licence: { plan: string; seats: number; seatsUsed: number; validUntil: string } | null;
  subscriptions: SubscriptionRow[];
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  signal: PaymentSignal;
}

export interface SettingsSetInput {
  legalName: string;
  gstin: string | null;
  stateCode: string;
  address: string;
  sacCode: string;
  gstRateBp: number;
  title: string;
  reason: string;
  env: string;
}

export interface PlanSetInput {
  code: string;
  name: string;
  months: number;
  seatPricePaise: number;
  active: boolean;
  reason: string;
  env: string;
}

export interface AccountSetInput {
  orgId: string;
  legalName: string;
  gstin: string | null;
  stateCode: string;
  address: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  reason: string;
  env: string;
}

/** billing-api, as the console reaches it. */
export interface BillingApi {
  post(route: 'link' | 'check' | 'void' | 'refund', body: Record<string, unknown>): Promise<unknown>;
}

/**
 * billing-api over fetch, with the signed-in staff member's session token.
 * With no session nothing is sent. A refusal's message is billing-api's
 * `error`, which toAdminError sorts.
 */
export function billingApiFetch(o: {
  functionsUrl: string;
  accessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): BillingApi {
  const base = o.functionsUrl.replace(/\/+$/, '');
  return {
    async post(route, body) {
      const token = await o.accessToken();
      if (!token) throw new AdminError('You do not have access to this.', 'not-allowed');
      const res = await (o.fetchImpl ?? fetch)(`${base}/${route}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        throw new Error(typeof answer?.error === 'string' ? answer.error : `billing-api answered ${res.status}`);
      }
      return answer;
    },
  };
}

export interface BillingClient {
  overview(): Promise<BillingOverview>;
  accounts(): Promise<AccountRow[]>;
  school(orgId: string): Promise<SchoolBilling>;
  settings(): Promise<BillingSettings>;
  settingsSet(i: SettingsSetInput): Promise<void>;
  plans(): Promise<BillingPlan[]>;
  planSet(i: PlanSetInput): Promise<void>;
  accountSet(i: AccountSetInput): Promise<void>;
  graceSet(orgId: string, days: number, reason: string, env: string): Promise<void>;
  subscriptions(orgId?: string): Promise<SubscriptionRow[]>;
  subscriptionCreate(i: {
    orgId: string;
    plan: string;
    seats: number;
    startsOn: string;
    dueDays?: number;
    reason: string;
    env: string;
  }): Promise<{ subscriptionId: string; invoiceId: string; number: string }>;
  invoiceRaise(i: {
    orgId: string;
    description: string;
    amountPaise: number;
    dueDays?: number;
    reason: string;
    env: string;
  }): Promise<{ invoiceId: string; number: string }>;
  invoices(f?: { orgId?: string; status?: InvoiceStatus }): Promise<InvoiceRow[]>;
  invoice(id: string): Promise<InvoiceDetail>;
  payments(orgId?: string): Promise<PaymentRow[]>;
  paymentRecord(i: {
    invoiceId: string;
    source: 'bank_transfer' | 'cheque';
    amountPaise: number;
    receivedOn: string;
    reference: string;
    reason: string;
    env: string;
  }): Promise<{ paymentId: string; invoiceStatus: InvoiceStatus; licenceSet: boolean }>;
  webhookLog(problemsOnly?: boolean): Promise<WebhookRow[]>;
  sendLink(i: { invoiceId: string; reason: string; env: string }): Promise<{ linkId: string; url: string; existing: boolean }>;
  checkLink(invoiceId: string): Promise<{ checked: number; changed: number }>;
  voidInvoice(i: { invoiceId: string; reason: string; env: string }): Promise<{ voided: true }>;
  refund(i: { paymentId: string; amountPaise: number; reason: string; env: string }): Promise<{ status: string; creditNote: string | null }>;
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Every method sorts its failure into an AdminError, as createAdminClient does. */
export function createBillingClient(t: AdminTransport, api: BillingApi): BillingClient {
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (e) {
      throw toAdminError(e);
    }
  };
  const value = <T>(fn: string, args?: Record<string, unknown>) => guard(async () => (await t.value(fn, args)) as T);
  const write = async (fn: string, args: Record<string, unknown>) => {
    await guard(() => t.value(fn, args));
  };
  return {
    overview: () => value<BillingOverview>('billing_overview'),
    accounts: () => guard(async () => list<AccountRow>(await t.value('billing_accounts'))),
    school: (orgId) => value<SchoolBilling>('billing_school', { p_org: orgId }),
    settings: () => value<BillingSettings>('billing_settings'),
    settingsSet: (i) =>
      write('billing_settings_set', {
        p_legal_name: i.legalName,
        p_gstin: i.gstin,
        p_state: i.stateCode,
        p_address: i.address,
        p_sac: i.sacCode,
        p_gst_rate_bp: i.gstRateBp,
        p_title: i.title,
        p_reason: i.reason,
        p_env: i.env,
      }),
    plans: () => guard(async () => list<BillingPlan>(await t.value('billing_plans'))),
    planSet: (i) =>
      write('billing_plan_set', {
        p_code: i.code,
        p_name: i.name,
        p_months: i.months,
        p_seat_price_paise: i.seatPricePaise,
        p_active: i.active,
        p_reason: i.reason,
        p_env: i.env,
      }),
    accountSet: (i) =>
      write('billing_account_set', {
        p_org: i.orgId,
        p_legal_name: i.legalName,
        p_gstin: i.gstin,
        p_state: i.stateCode,
        p_address: i.address,
        p_contact_name: i.contactName,
        p_contact_email: i.contactEmail,
        p_contact_phone: i.contactPhone,
        p_reason: i.reason,
        p_env: i.env,
      }),
    graceSet: (orgId, days, reason, env) =>
      write('billing_grace_set', { p_org: orgId, p_days: days, p_reason: reason, p_env: env }),
    subscriptions: (orgId) => guard(async () => list<SubscriptionRow>(await t.value('billing_subscriptions', { p_org: orgId }))),
    // An unset due day goes as null, which the functions read as 15 days.
    subscriptionCreate: (i) =>
      value('billing_subscription_create', {
        p_org: i.orgId,
        p_plan: i.plan,
        p_seats: i.seats,
        p_starts_on: i.startsOn,
        p_due_days: i.dueDays ?? null,
        p_reason: i.reason,
        p_env: i.env,
      }),
    invoiceRaise: (i) =>
      value('billing_invoice_raise', {
        p_org: i.orgId,
        p_description: i.description,
        p_amount_paise: i.amountPaise,
        p_due_days: i.dueDays ?? null,
        p_reason: i.reason,
        p_env: i.env,
      }),
    invoices: (f) =>
      guard(async () => list<InvoiceRow>(await t.value('billing_invoices', { p_org: f?.orgId, p_status: f?.status }))),
    invoice: (id) => value<InvoiceDetail>('billing_invoice', { p_invoice: id }),
    payments: (orgId) => guard(async () => list<PaymentRow>(await t.value('billing_payments', { p_org: orgId }))),
    paymentRecord: (i) =>
      value('billing_payment_record', {
        p_invoice: i.invoiceId,
        p_source: i.source,
        p_amount_paise: i.amountPaise,
        p_received_on: i.receivedOn,
        p_reference: i.reference,
        p_reason: i.reason,
        p_env: i.env,
      }),
    webhookLog: (problemsOnly) =>
      guard(async () => list<WebhookRow>(await t.value('billing_webhook_log', { p_problems: problemsOnly }))),
    sendLink: (i) =>
      guard(async () => (await api.post('link', { invoiceId: i.invoiceId, reason: i.reason, env: i.env })) as {
        linkId: string;
        url: string;
        existing: boolean;
      }),
    checkLink: (invoiceId) =>
      guard(async () => (await api.post('check', { invoiceId })) as { checked: number; changed: number }),
    voidInvoice: (i) =>
      guard(async () => (await api.post('void', { invoiceId: i.invoiceId, reason: i.reason, env: i.env })) as { voided: true }),
    refund: (i) =>
      guard(async () =>
        (await api.post('refund', { paymentId: i.paymentId, amountPaise: i.amountPaise, reason: i.reason, env: i.env })) as {
          status: string;
          creditNote: string | null;
        },
      ),
  };
}
