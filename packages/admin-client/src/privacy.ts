import type { AdminApiCaller } from './admin-api.ts';
import { day, guard, num, str, strOrNull } from './read.ts';
import { captureOf, type Capture } from './safety.ts';
import type { Write } from './schools.ts';
import type { AdminTransport } from './transport.ts';

/**
 * Privacy (migrations 0066 and 0069): each school's data-protection decision,
 * erasure requests, what is kept and which job keeps to it, and the contest
 * purge date. The list of requests carries no names; one request carries the
 * school student's name and what would be erased. Erasing goes through
 * admin-api's erase, which deletes the child's photos from Storage first.
 */

export type Fiduciary = 'undecided' | 'school' | 'qrie';
export type Recipient = 'undecided' | 'school' | 'parent' | 'school-and-parent';

export interface SchoolPrivacyRow {
  code: string;
  name: string;
  fiduciary: Fiduciary;
  recipient: Recipient;
  basis: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  importBlocked: boolean;
}

export type RequestStatus = 'received' | 'verified' | 'erasing' | 'erased' | 'refused';

export interface ErasureRow {
  id: string;
  receivedOn: string;
  dueOn: string;
  daysLeft: number;
  channel: string;
  requester: string;
  reference: string;
  subjectKind: 'school-student' | 'direct';
  school: { code: string } | null;
  loginId: string | null;
  status: RequestStatus;
}

export interface ErasureDetail extends ErasureRow {
  displayName: string | null;
  left: boolean | null;
  verifiedHow: string | null;
  verifiedByName: string | null;
  refusedReason: string | null;
  tallies: unknown;
  preview: { rows: Record<string, number>; photos: number; activityLogLines: number } | null;
}

export interface RetentionRow {
  what: string;
  tables: string[];
  holds: string;
  kept: string;
  enforcedBy: string;
  job: { name: string; schedule: string; lastStatus: string } | null;
}

export interface RetentionTruth {
  rows: RetentionRow[];
  contest: { purgeOn: string | null; purgedAt: string | null };
  distressCapture: Capture;
}

export interface Erased {
  requestId: string;
  rows: Record<string, number>;
  photos: number;
  activityLogLines: number;
}

export interface PrivacyClient {
  schools(): Promise<SchoolPrivacyRow[]>;
  setSchool(i: { code: string; fiduciary: Fiduciary; recipient: Recipient; basis: string } & Write): Promise<void>;
  requests(openOnly?: boolean): Promise<ErasureRow[]>;
  request(id: string): Promise<ErasureDetail>;
  intake(
    i: { channel: string; requester: string; reference: string; receivedOn: string; code?: string; loginId?: string; userId?: string } & Write,
  ): Promise<{ requestId: string }>;
  verify(i: { requestId: string; how: string } & Write): Promise<void>;
  refuse(i: { requestId: string } & Write): Promise<void>;
  /** admin-api's erase. */
  erase(i: { requestId: string } & Write): Promise<Erased>;
  retention(): Promise<RetentionTruth>;
  setContestPurge(i: { on: string } & Write): Promise<void>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const counts = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, num(n)]));

const erasureRow = (r: Obj): ErasureRow => ({
  id: str(r.id),
  receivedOn: day(r.receivedOn) as string,
  dueOn: day(r.dueOn) as string,
  daysLeft: num(r.daysLeft),
  channel: str(r.channel),
  requester: str(r.requester),
  reference: str(r.reference),
  subjectKind: r.subjectKind === 'direct' ? 'direct' : 'school-student',
  school: r.school ? { code: str(obj(r.school).code) } : null,
  loginId: strOrNull(r.loginId),
  status: r.status as RequestStatus,
});

export function createPrivacyClient(t: AdminTransport, api: AdminApiCaller): PrivacyClient {
  return {
    schools: () =>
      guard(async () =>
        list(await t.value('school_privacy_list')).map((r) => ({
          code: str(r.code),
          name: str(r.name),
          fiduciary: r.fiduciary as Fiduciary,
          recipient: r.recipient as Recipient,
          basis: strOrNull(r.basis),
          decidedAt: strOrNull(r.decidedAt),
          decidedByName: strOrNull(r.decidedByName),
          importBlocked: r.importBlocked === true,
        })),
      ),
    async setSchool(i) {
      await guard(() =>
        t.value('school_privacy_set', {
          p_code: i.code,
          p_fiduciary: i.fiduciary,
          p_recipient: i.recipient,
          p_basis: i.basis,
          p_reason: i.reason,
          p_env: i.env,
        }),
      );
    },
    requests: (openOnly) =>
      guard(async () => list(await t.value('erasure_requests', { p_open_only: openOnly })).map(erasureRow)),
    request: (id) =>
      guard(async () => {
        const o = obj(await t.value('erasure_request', { p_request: id }));
        const p = o.preview ? obj(o.preview) : null;
        return {
          ...erasureRow(o),
          displayName: strOrNull(o.displayName),
          left: typeof o.left === 'boolean' ? o.left : null,
          verifiedHow: strOrNull(o.verifiedHow),
          verifiedByName: strOrNull(o.verifiedByName),
          refusedReason: strOrNull(o.refusedReason),
          tallies: o.tallies ?? null,
          preview: p ? { rows: counts(p.rows), photos: num(p.photos ?? 0), activityLogLines: num(p.activityLogLines ?? 0) } : null,
        };
      }),
    intake: (i) =>
      guard(async () => ({
        requestId: str(
          obj(
            await t.value('erasure_intake', {
              p_channel: i.channel,
              p_requester: i.requester,
              p_reference: i.reference,
              // No SQL defaults on these: null, not left out.
              p_code: i.code ?? null,
              p_login: i.loginId ?? null,
              p_user: i.userId ?? null,
              p_received_on: i.receivedOn,
              p_reason: i.reason,
              p_env: i.env,
            }),
          ).requestId,
        ),
      })),
    async verify(i) {
      await guard(() => t.value('erasure_verify', { p_request: i.requestId, p_how: i.how, p_reason: i.reason, p_env: i.env }));
    },
    async refuse(i) {
      await guard(() => t.value('erasure_refuse', { p_request: i.requestId, p_reason: i.reason, p_env: i.env }));
    },
    erase: (i) =>
      guard(async () => {
        const o = obj(await api.post('erase', { requestId: i.requestId, reason: i.reason, env: i.env }));
        return {
          requestId: str(o.requestId),
          rows: counts(o.rows),
          photos: num(o.photos ?? 0),
          activityLogLines: num(o.activityLogLines ?? 0),
        };
      }),
    retention: () =>
      guard(async () => {
        const o = obj(await t.value('retention_truth'));
        const contest = obj(o.contest);
        return {
          rows: list(o.rows).map((r) => {
            const job = r.job ? obj(r.job) : null;
            return {
              what: str(r.what),
              tables: Array.isArray(r.tables) ? r.tables.map(str) : [],
              holds: str(r.holds ?? ''),
              kept: str(r.kept ?? ''),
              enforcedBy: str(r.enforcedBy ?? ''),
              job: job ? { name: str(job.name), schedule: str(job.schedule ?? ''), lastStatus: str(job.lastStatus ?? '') } : null,
            };
          }),
          contest: { purgeOn: strOrNull(contest.purgeOn), purgedAt: strOrNull(contest.purgedAt) },
          distressCapture: captureOf(o.distressCapture),
        };
      }),
    async setContestPurge(i) {
      await guard(() => t.value('contest_purge_set', { p_on: i.on, p_reason: i.reason, p_env: i.env }));
    },
  };
}
