import type { Capture, CaseOutcome, Me, ReportKind, ReportStatus } from '@ai-tutor/admin-client';
import { formatDay } from '../billing/model.ts';

/**
 * What the Safety pages show and offer, decided in one pure place.
 *
 * Rights (spec section 3, ruling R28): the owner and the safety reviewer read
 * the report list, open a case, mark reports and close cases; only the owner
 * records the day capture went live and reads the read log; ops and finance
 * see none of it. A button a role may not use is not shown, and the database
 * refuses it anyway.
 */

export const STATUS_LABEL: Record<ReportStatus, string> = { new: 'Unread', seen: 'Read', triaged: 'Triaged', closed: 'Closed' };

export const KIND_LABEL: Record<ReportKind, string> = { wrong: 'Something wrong', rude: 'Upsetting', unsafe: 'Unsafe', other: 'Other' };

export const OUTCOME_LABEL: Record<CaseOutcome, string> = {
  'no-action': 'No action needed',
  'content-fixed': 'Content fixed',
  disclosed: 'Disclosed to the agreed person',
  referred: 'Referred onward',
  other: 'Other',
};

export interface SafetyRights {
  readList: boolean;
  openCase: boolean;
  mark: boolean;
  closeCase: boolean;
  captureSince: boolean;
  readLog: boolean;
}

export function safetyRights(role: Me['role']): SafetyRights {
  const owner = role === 'owner';
  const reviewer = owner || role === 'safety';
  return { readList: reviewer, openCase: reviewer, mark: reviewer, closeCase: reviewer, captureSince: owner, readLog: owner };
}

/** '12 min', '3 h', '1 day', '2 days'. */
export function ageText(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  const days = Math.floor(m / 1440);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Never a bare zero before capture is live: grey "Not captured". */
export function captureText(c: Capture): { tone: 'grey' | 'ok'; text: string } {
  if (c.state !== 'captured') return { tone: 'grey', text: 'Not captured' };
  return { tone: 'ok', text: `${c.last7d ?? 0} in 7 days, captured since ${formatDay(c.since)}` };
}

const ORDER: ('seen' | 'triaged' | 'closed')[] = ['seen', 'triaged', 'closed'];
const RANK: Record<ReportStatus, number> = { new: 0, seen: 1, triaged: 2, closed: 3 };

/** A report only moves forward (admin.report_mark refuses anything else). */
export function nextStatuses(s: ReportStatus): ('seen' | 'triaged' | 'closed')[] {
  return ORDER.filter((n) => RANK[n] > RANK[s]);
}

export function blastOpenCase(): string {
  return (
    "You will see this child's words. The opening is recorded with your reason, and each reading counts against today's 30 reads." +
    ' Close your case when you are done: you can hold one at a time.'
  );
}

export function blastCloseCase(outcome: CaseOutcome, schoolCode: string | null): string {
  const closed = 'The case and its report are closed.';
  if (outcome !== 'disclosed') return closed;
  return (
    `${closed} Record here only that the agreed person at ${schoolCode ?? 'the school'} was told;` +
    " their name and number stay in the school's contacts."
  );
}
