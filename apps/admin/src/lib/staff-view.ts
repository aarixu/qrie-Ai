import type { AuditRow, FactorState, RosterRow, StaffStatus } from '@ai-tutor/admin-client';
import { toCsv } from './csv.ts';
import { istStamp } from './time.ts';

/** How the Staff and audit page words a person's state. */
export const STATUS_TITLE: Record<StaffStatus, string> = {
  active: 'Active',
  invited: 'Invited, waiting',
  off: 'Switched off',
  'account-only': 'Account made, not on the list',
};

export const FACTOR_TITLE: Record<FactorState, string> = {
  verified: 'Set up',
  none: 'Not yet',
  'not-captured': 'Not captured',
};

/**
 * "Turn on" is offered to a person on the list who is not active, once their
 * authenticator is set up, or when the database cannot see authenticators
 * (not captured). admin.staff_set refuses the same person without one.
 */
export const mayTurnOn = (r: RosterRow): boolean => (r.status === 'invited' || r.status === 'off') && r.factor !== 'none';

/** admin.audit_list gives at most this many entries per call. */
export const AUDIT_PAGE = 1000;
/** The most the CSV download holds. */
export const AUDIT_DOWNLOAD_MAX = 5000;

/**
 * Reads the audit log newest first, one page at a time, each page older than
 * the smallest id so far, until a short page or AUDIT_DOWNLOAD_MAX entries.
 */
export async function collectAudit(page: (before: number | undefined) => Promise<AuditRow[]>): Promise<AuditRow[]> {
  const out: AuditRow[] = [];
  let before: number | undefined;
  while (out.length < AUDIT_DOWNLOAD_MAX) {
    const rows = await page(before);
    out.push(...rows.slice(0, AUDIT_DOWNLOAD_MAX - out.length));
    if (rows.length < AUDIT_PAGE) break;
    before = Math.min(...rows.map((r) => r.id));
  }
  return out;
}

/** The audit log as a CSV file's text: one row per entry, India's time, the details as JSON. */
export function auditCsv(rows: AuditRow[]): string {
  return toCsv(
    ['ID', 'Time (India)', 'Who', 'Role', 'Action', 'Target kind', 'Target', 'Reason', 'Details', 'Environment'],
    rows.map((r) => [
      r.id,
      istStamp(r.at),
      r.actorName,
      r.actorRole,
      r.action,
      r.targetKind,
      r.targetId,
      r.reason,
      JSON.stringify(r.details),
      r.environment,
    ]),
  );
}
