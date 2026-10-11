import type { SystemHealth } from '@ai-tutor/admin-client';
import type { Tone } from './tiles.ts';

/**
 * WHAT THE SYSTEM PAGE SAYS about each part of the platform, decided in one
 * place. What the database cannot see reads grey ("not captured", "never"),
 * never green.
 */
export interface Line {
  text: string;
  tone: Tone;
}

/** The audit copy is scheduled hourly (.github/workflows/admin-audit-copy.yml); quiet for 90 minutes, it missed a run. */
export const AUDIT_COPY_STALE_MINUTES = 90;
/** Billing reconciles hourly (spec section 10); older than 120 minutes, it missed a run. */
export const RECONCILE_STALE_MINUTES = 120;
/** A restore drill older than this many days reads amber. */
export const RESTORE_DRILL_WARN_DAYS = 90;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A scheduled job's last run, from pg_cron's status; its message is never shown. */
export function jobLine(lastStatus: string): Line {
  switch (lastStatus) {
    case 'succeeded':
      return { text: 'Succeeded', tone: 'ok' };
    case 'failed':
      return { text: 'Failed', tone: 'bad' };
    case 'never-run':
      return { text: 'Never run', tone: 'grey' };
    case 'not-captured':
      return { text: 'Not captured', tone: 'grey' };
    default:
      return { text: lastStatus, tone: 'grey' };
  }
}

/** An outside checker (the alarm, the audit copy): red once it has been quiet longer than `staleAfter` minutes. */
export function checkedLine(minutesAgo: number | null, staleAfter: number): Line {
  if (minutesAgo === null) return { text: 'Never', tone: 'grey' };
  return { text: `Last checked ${plural(minutesAgo, 'minute', 'minutes')} ago`, tone: minutesAgo > staleAfter ? 'bad' : 'ok' };
}

/**
 * Wrong tokens given to the alarm or the audit copy in the last hour (0075). A
 * guess at the token from someone holding the public key reads amber; so does
 * a checker whose own token was rotated without updating its secret.
 */
export function tokenMissLine(misses: number): Line {
  return misses > 0 ? { text: `${misses} in the last hour`, tone: 'warn' } : { text: 'None in the last hour', tone: 'ok' };
}

export function chainLine(c: SystemHealth['auditChain']): Line {
  const parts: string[] = [];
  if (c.firstBreakSeq !== null) parts.push(`Broken at entry ${c.firstBreakSeq}`);
  if (c.unchained > 0) parts.push(`${plural(c.unchained, 'entry', 'entries')} outside the chain`);
  if (parts.length > 0) return { text: parts.join('; '), tone: 'bad' };
  return { text: `Intact, ${plural(c.entries, 'entry', 'entries')}${c.head ? `, head ${c.head}` : ''}`, tone: 'ok' };
}

export function migrationLine(level: string): Line {
  return level === 'not-captured' ? { text: 'Not captured', tone: 'grey' } : { text: level, tone: 'ok' };
}

const ago = (minutes: number | null): string => (minutes === null ? 'Never' : `${plural(minutes, 'minute', 'minutes')} ago`);

/** Cashfree's four lines (spec section 9), or one grey line until billing is installed. */
export function cashfreeLines(c: SystemHealth['cashfree']): (Line & { label: string })[] {
  if (!c.captured) return [{ label: 'Cashfree', text: 'Not captured: billing is not installed', tone: 'grey' }];
  const failures = c.signatureFailures24h ?? 0;
  const waiting = c.unprocessed ?? 0;
  return [
    { label: 'Last webhook', text: ago(c.lastWebhookMinutesAgo), tone: c.lastWebhookMinutesAgo === null ? 'grey' : 'ok' },
    { label: 'Signature failures', text: failures > 0 ? `${failures} in 24 hours` : 'None in 24 hours', tone: failures > 0 ? 'bad' : 'ok' },
    { label: 'Not yet processed', text: waiting > 0 ? `${waiting}` : 'None', tone: waiting > 0 ? 'warn' : 'ok' },
    {
      label: 'Last reconciliation',
      text: ago(c.reconciledMinutesAgo),
      tone: c.reconciledMinutesAgo === null ? 'grey' : c.reconciledMinutesAgo > RECONCILE_STALE_MINUTES ? 'bad' : 'ok',
    },
  ];
}

export function drillLine(d: SystemHealth['restoreDrill']): Line {
  if (d.on === null || d.daysAgo === null) return { text: 'Never', tone: 'grey' };
  const when = d.daysAgo === 0 ? 'today' : `${plural(d.daysAgo, 'day', 'days')} ago`;
  return { text: `${d.on}, ${when}`, tone: d.daysAgo > RESTORE_DRILL_WARN_DAYS ? 'warn' : 'ok' };
}
