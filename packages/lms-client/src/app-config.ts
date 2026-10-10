/**
 * WHAT THE STUDENT AND TEACHER APPS READ FROM QRIE CONTROL (public.app_config),
 * and what they assume when they cannot read it. Nothing here turns a feature
 * on: no banner, no notice and no minimum build are the defaults, and the
 * things a client could skip (the tutor, imports) are refused by the database.
 */

/** Three whole numbers of up to four digits each, as admin.flag_valid's 'version' kind (0062). */
export const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

export function parseVersion(v: unknown): [number, number, number] | null {
  const m = typeof v === 'string' ? VERSION.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True only when both are well formed and the build is older: a typo never locks anyone out. */
export function isBelowMinimum(build: string, minimum: unknown): boolean {
  const b = parseVersion(build);
  const m = parseVersion(minimum);
  if (!b || !m) return false;
  for (let i = 0; i < 3; i += 1) if (b[i] !== m[i]) return b[i] < m[i];
  return false;
}

export interface SchoolAppConfig {
  bannerMessage: string;
  bannerTone: 'info' | 'warning';
  minVersion: string;
  /** Coarse, as plan 3's app_config says it: anyone who guesses a school code can read it. */
  billingState: 'ok' | 'grace' | 'suspended';
  graceUntil: string | null;
}

export const SCHOOL_APP_DEFAULTS: SchoolAppConfig = {
  bannerMessage: '',
  bannerTone: 'info',
  minVersion: '0.0.0',
  billingState: 'ok',
  graceUntil: null,
};

/**
 * One app's view of app_config: each key it reads, when it has the right type,
 * else that key's safe default. Anything that is not an object reads as the
 * defaults.
 */
export function parseSchoolAppConfig(raw: unknown, app: 'student' | 'lms'): SchoolAppConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...SCHOOL_APP_DEFAULTS };
  const c = raw as Record<string, unknown>;
  const message = c['banner.message'];
  const tone = c['banner.tone'];
  const minimum = c[`app.min_version.${app}`];
  const state = c['billing.state'];
  const until = c['billing.grace_until'];
  return {
    bannerMessage: typeof message === 'string' ? message : SCHOOL_APP_DEFAULTS.bannerMessage,
    bannerTone: tone === 'info' || tone === 'warning' ? tone : SCHOOL_APP_DEFAULTS.bannerTone,
    minVersion: typeof minimum === 'string' ? minimum : SCHOOL_APP_DEFAULTS.minVersion,
    billingState: state === 'ok' || state === 'grace' || state === 'suspended' ? state : SCHOOL_APP_DEFAULTS.billingState,
    graceUntil: typeof until === 'string' && until !== '' ? until : SCHOOL_APP_DEFAULTS.graceUntil,
  };
}

/** The school admin's licence and invoice state (lms.school_billing, 0064). */
export interface SchoolBilling {
  state: 'ok' | 'grace' | 'suspended';
  graceUntil: string | null;
  openInvoices: number;
  duePaise: number;
  earliestDueOn: string | null;
}

export interface BillingNotice {
  kind: 'grace' | 'suspended' | 'invoice-due' | 'invoice-overdue';
  title: string;
  text: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYY-MM-DD as "1 Oct 2026"; anything else as it came. */
function day(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

const RUPEES = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupees = (paise: number): string => `Rs ${RUPEES.format(paise / 100)}`;

/** `today` is India's day, YYYY-MM-DD. The state's notice first, then the invoice's. */
export function billingNotices(b: SchoolBilling, today: string): BillingNotice[] {
  const out: BillingNotice[] = [];
  if (b.state === 'grace') {
    out.push({
      kind: 'grace',
      title: 'Your licence has ended',
      text:
        `Qrie keeps working until ${b.graceUntil ? day(b.graceUntil) : 'the end of its grace period'}. ` +
        'After that the tutor switches off for your school and no new people can be added; homework, marks and exports stay. ' +
        'Ask Qrie to renew it.',
    });
  } else if (b.state === 'suspended') {
    out.push({
      kind: 'suspended',
      title: 'Your licence has ended and its grace period is over',
      text: 'The tutor is off for your school and no new people can be added. Homework, marks and exports still work. Ask Qrie to renew it.',
    });
  }
  if (b.openInvoices > 0 && b.earliestDueOn) {
    // YYYY-MM-DD strings compare as days.
    const overdue = b.earliestDueOn < today;
    const amount = rupees(b.duePaise);
    const when = day(b.earliestDueOn);
    const text =
      b.openInvoices === 1
        ? overdue
          ? `${amount} was due on ${when}.`
          : `${amount} is due by ${when}.`
        : overdue
          ? `${amount} on ${b.openInvoices} invoices is due; the first was due on ${when}.`
          : `${amount} on ${b.openInvoices} invoices is due, the first by ${when}.`;
    out.push(
      overdue
        ? { kind: 'invoice-overdue', title: 'An invoice from Qrie is overdue', text }
        : { kind: 'invoice-due', title: 'An invoice from Qrie is due', text },
    );
  }
  return out;
}
