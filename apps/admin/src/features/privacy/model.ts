import type { ErasureDetail, Fiduciary, Me, Recipient, RequestStatus } from '@ai-tutor/admin-client';
import { formatDay } from '../billing/model.ts';

/**
 * What the Privacy pages show and offer, decided in one pure place.
 *
 * Rights (spec section 3, rulings R19 and R28): the owner does all of it; ops
 * records and verifies erasure requests and reads what is kept; safety reads
 * what is kept; finance sees nothing. Refusing a request, erasing, recording a
 * school's decision and setting the contest purge date are the owner's. The
 * database refuses anyway.
 */

export interface PrivacyRights {
  requests: boolean;
  intake: boolean;
  verify: boolean;
  refuse: boolean;
  erase: boolean;
  decideSchool: boolean;
  retention: boolean;
  contestPurge: boolean;
}

export function privacyRights(role: Me['role']): PrivacyRights {
  const owner = role === 'owner';
  const works = owner || role === 'ops';
  return {
    requests: works,
    intake: works,
    verify: works,
    refuse: owner,
    erase: owner,
    decideSchool: owner,
    retention: works || role === 'safety',
    contestPurge: owner,
  };
}

export const FIDUCIARY_LABEL: Record<Fiduciary, string> = { undecided: 'Not decided', school: 'The school', qrie: 'Qrie' };

export const RECIPIENT_LABEL: Record<Recipient, string> = {
  undecided: 'Not decided',
  school: 'The school',
  parent: 'The parent',
  'school-and-parent': 'The school and the parent',
};

/** Erased or refused: grey. Open: more than 7 days left ok, 0 to 7 warn, past due bad. */
export function dueTone(daysLeft: number, status: RequestStatus): 'grey' | 'ok' | 'warn' | 'bad' {
  if (status === 'erased' || status === 'refused') return 'grey';
  if (daysLeft < 0) return 'bad';
  return daysLeft <= 7 ? 'warn' : 'ok';
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Counts from the request's preview: rows, and tables (schema.table, from each schema.table.column key). */
export function blastErase(d: ErasureDetail): string {
  const rows = d.preview?.rows ?? {};
  const total = Object.values(rows).reduce((a, n) => a + n, 0);
  const tables = new Set(Object.keys(rows).map((k) => k.split('.').slice(0, -1).join('.'))).size;
  const photos = d.preview?.photos ?? 0;
  const lines = d.preview?.activityLogLines ?? 0;
  return (
    `Every record of ${d.displayName ?? 'this user'} is deleted for good: ${plural(total, 'row', 'rows')} in ${plural(tables, 'table', 'tables')},` +
    ` ${plural(photos, 'photo', 'photos')}, and their login ID in ${plural(lines, 'line', 'lines')} of the school's activity log.` +
    ' Staff logs keep the request and its ids. This cannot be undone.'
  );
}

/**
 * The import gate (admin.privacy_import_refusal, ruling R13) holds only on the
 * hosted and staging databases, and only this decision is said here: a school
 * may still be closed to new people for another reason (offboarded, say).
 */
export function blastSchoolPrivacy(code: string, f: Fiduciary, r: Recipient): string {
  const decided = f !== 'undecided' && r !== 'undecided';
  return decided
    ? `${code}'s decision is recorded. It no longer stops people being added to this school.`
    : `${code}'s decision is recorded. On the hosted and staging databases, nobody can be added to this school until both are decided.`;
}

export function blastContestPurge(on: string): string {
  return (
    `On ${formatDay(on)}, the names, phone numbers, addresses, cities and schools in every contest entry made before that day are cleared` +
    ' for good. Class, campaign and the date stay, for counts.'
  );
}
