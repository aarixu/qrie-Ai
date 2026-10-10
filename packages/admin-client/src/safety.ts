import { guard, num, numOrNull, str, strOrNull } from './read.ts';
import type { Write } from './schools.ts';
import type { AdminTransport } from './transport.ts';

/**
 * Safety (migrations 0065 and 0067): the report queue by kind, status and
 * age; cases; the read log. The list, the overview, a case's page and the
 * read log never carry a child's words. caseReport is the one call that does:
 * one report, inside an open case held by the caller, logged by the database
 * before it answers, within the day's quota.
 */

export type ReportStatus = 'new' | 'seen' | 'triaged' | 'closed';
export type ReportKind = 'wrong' | 'rude' | 'unsafe' | 'other';
export type CaseOutcome = 'no-action' | 'content-fixed' | 'disclosed' | 'referred' | 'other';

/** Distress capture: counts only once capture is live, never a bare zero before. */
export interface Capture {
  state: 'not-captured' | 'captured';
  since: string | null;
  last24h: number | null;
  last7d: number | null;
}

export interface SafetyOverview {
  generatedAt: string;
  counts: Record<'unread' | 'read' | 'triaged' | 'closed', number>;
  unreadByKind: Record<ReportKind, number>;
  unreadAges: { underHour: number; underDay: number; underWeek: number; older: number };
  firstLook: { reports30d: number; looked30d: number; medianMinutes: number | null; maxMinutes: number | null };
  cases: { open: number; mineOpen: number };
  capture: Capture;
  quota: { readsToday: number; perDay: number };
}

export interface SchoolRef {
  code: string;
  name: string;
}

export interface ReportRow {
  id: string;
  kind: ReportKind;
  status: ReportStatus;
  receivedAt: string;
  ageMinutes: number;
  seenAt: string | null;
  firstLookMinutes: number | null;
  school: SchoolRef | null;
  lessonId: string;
  platform: string | null;
  openCaseId: string | null;
}

export interface CaseRow {
  id: string;
  reportId: string | null;
  kind: ReportKind | null;
  school: SchoolRef | null;
  openedByName: string;
  openedAt: string;
  status: 'open' | 'closed';
  outcome: CaseOutcome | null;
  closedAt: string | null;
}

export interface CaseDetail extends CaseRow {
  reason: string;
  closeReason: string | null;
  closedByName: string | null;
  reportStatus: ReportStatus | null;
  receivedAt: string | null;
  reads: { at: string; staffName: string; what: 'report' | 'context'; reason: string }[];
}

export interface CaseReport {
  caseId: string;
  readsLeftToday: number;
  report: {
    id: string;
    kind: ReportKind;
    status: ReportStatus;
    note: string;
    lessonId: string;
    topicRef: string | null;
    beatId: string | null;
    spokenLine: string | null;
    platform: string | null;
    release: string | null;
    at: string;
    receivedAt: string;
    school: SchoolRef | null;
  };
}

export interface CaseContext {
  caseId: string;
  readsLeftToday: number;
  class: { id: string; title: string; status: string; version: number } | null;
  sitting: { source: string; startedAt: string; endedAt: string | null; activeMinutes: number | null } | null;
  sameLesson: { reports: number; unsafe: number };
}

export interface ReadLogRow {
  at: string;
  staffName: string;
  staffRole: string;
  caseId: string;
  reportId: string | null;
  what: 'report' | 'context';
  reason: string;
}

export interface SafetyClient {
  overview(): Promise<SafetyOverview>;
  reports(f?: { status?: ReportStatus; kind?: ReportKind; school?: string; limit?: number }): Promise<{ rows: ReportRow[]; more: boolean }>;
  mark(i: { reportId: string; status: 'seen' | 'triaged' | 'closed' } & Write): Promise<void>;
  openCase(i: { reportId: string } & Write): Promise<{ caseId: string }>;
  caseReport(caseId: string): Promise<CaseReport>;
  caseContext(caseId: string, reason: string): Promise<CaseContext>;
  closeCase(i: { caseId: string; outcome: CaseOutcome } & Write): Promise<void>;
  cases(openOnly?: boolean): Promise<CaseRow[]>;
  caseDetail(caseId: string): Promise<CaseDetail>;
  readLog(limit?: number): Promise<ReadLogRow[]>;
  setCaptureSince(i: { on: string } & Write): Promise<void>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const schoolRef = (v: unknown): SchoolRef | null => (v && typeof v === 'object' ? { code: str(obj(v).code), name: str(obj(v).name) } : null);

export const captureOf = (v: unknown): Capture => {
  const c = obj(v);
  return {
    state: c.state === 'captured' ? 'captured' : 'not-captured',
    since: strOrNull(c.since),
    last24h: numOrNull(c.last24h),
    last7d: numOrNull(c.last7d),
  };
};

const reportRow = (r: Obj): ReportRow => ({
  id: str(r.id),
  kind: r.kind as ReportKind,
  status: r.status as ReportStatus,
  receivedAt: str(r.receivedAt),
  ageMinutes: num(r.ageMinutes),
  seenAt: strOrNull(r.seenAt),
  firstLookMinutes: numOrNull(r.firstLookMinutes),
  school: schoolRef(r.school),
  lessonId: str(r.lessonId),
  platform: strOrNull(r.platform),
  openCaseId: strOrNull(r.openCaseId),
});

const caseRow = (r: Obj): CaseRow => ({
  id: str(r.id),
  reportId: strOrNull(r.reportId),
  kind: (r.kind ?? null) as ReportKind | null,
  school: schoolRef(r.school),
  openedByName: str(r.openedByName ?? ''),
  openedAt: str(r.openedAt),
  status: r.status === 'closed' ? 'closed' : 'open',
  outcome: (r.outcome ?? null) as CaseOutcome | null,
  closedAt: strOrNull(r.closedAt),
});

const counts = <K extends string>(v: unknown, keys: readonly K[]): Record<K, number> => {
  const o = obj(v);
  return Object.fromEntries(keys.map((k) => [k, num(o[k] ?? 0)])) as Record<K, number>;
};

export function createSafetyClient(t: AdminTransport): SafetyClient {
  return {
    overview: () =>
      guard(async () => {
        const o = obj(await t.value('safety_overview'));
        const first = obj(o.firstLook);
        const cases = obj(o.cases);
        const quota = obj(o.quota);
        return {
          generatedAt: str(o.generatedAt),
          counts: counts(o.counts, ['unread', 'read', 'triaged', 'closed'] as const),
          unreadByKind: counts(o.unreadByKind, ['wrong', 'rude', 'unsafe', 'other'] as const),
          unreadAges: counts(o.unreadAges, ['underHour', 'underDay', 'underWeek', 'older'] as const),
          firstLook: {
            reports30d: num(first.reports30d ?? 0),
            looked30d: num(first.looked30d ?? 0),
            medianMinutes: numOrNull(first.medianMinutes),
            maxMinutes: numOrNull(first.maxMinutes),
          },
          cases: { open: num(cases.open ?? 0), mineOpen: num(cases.mineOpen ?? 0) },
          capture: captureOf(o.capture),
          quota: { readsToday: num(quota.readsToday ?? 0), perDay: num(quota.perDay ?? 0) },
        };
      }),
    reports: (f = {}) =>
      guard(async () => {
        const o = obj(
          await t.value('safety_reports', { p_status: f.status, p_kind: f.kind, p_school: f.school, p_limit: f.limit }),
        );
        return { rows: list(o.rows).map(reportRow), more: o.more === true };
      }),
    async mark(i) {
      await guard(() => t.value('report_mark', { p_report: i.reportId, p_status: i.status, p_reason: i.reason, p_env: i.env }));
    },
    openCase: (i) =>
      guard(async () => ({
        caseId: str(obj(await t.value('case_open', { p_report: i.reportId, p_reason: i.reason, p_env: i.env })).caseId),
      })),
    caseReport: (caseId) =>
      guard(async () => {
        const o = obj(await t.value('case_report', { p_case: caseId }));
        const r = obj(o.report);
        return {
          caseId: str(o.caseId),
          readsLeftToday: num(o.readsLeftToday),
          report: {
            id: str(r.id),
            kind: r.kind as ReportKind,
            status: r.status as ReportStatus,
            note: str(r.note ?? ''),
            lessonId: str(r.lessonId),
            topicRef: strOrNull(r.topicRef),
            beatId: strOrNull(r.beatId),
            spokenLine: strOrNull(r.spokenLine),
            platform: strOrNull(r.platform),
            release: strOrNull(r.release),
            at: str(r.at),
            receivedAt: str(r.receivedAt),
            school: schoolRef(r.school),
          },
        };
      }),
    caseContext: (caseId, reason) =>
      guard(async () => {
        const o = obj(await t.value('case_context', { p_case: caseId, p_reason: reason }));
        const cls = o.class ? obj(o.class) : null;
        const sit = o.sitting ? obj(o.sitting) : null;
        const same = obj(o.sameLesson);
        return {
          caseId: str(o.caseId),
          readsLeftToday: num(o.readsLeftToday),
          class: cls ? { id: str(cls.id), title: str(cls.title), status: str(cls.status), version: num(cls.version) } : null,
          sitting: sit
            ? {
                source: str(sit.source),
                startedAt: str(sit.startedAt),
                endedAt: strOrNull(sit.endedAt),
                activeMinutes: numOrNull(sit.activeMinutes),
              }
            : null,
          sameLesson: { reports: num(same.reports ?? 0), unsafe: num(same.unsafe ?? 0) },
        };
      }),
    async closeCase(i) {
      await guard(() =>
        t.value('case_close', { p_case: i.caseId, p_outcome: i.outcome, p_reason: i.reason, p_env: i.env }),
      );
    },
    cases: (openOnly) => guard(async () => list(await t.value('cases', { p_open_only: openOnly })).map(caseRow)),
    caseDetail: (caseId) =>
      guard(async () => {
        const o = obj(await t.value('case_detail', { p_case: caseId }));
        return {
          ...caseRow(o),
          reason: str(o.reason ?? ''),
          closeReason: strOrNull(o.closeReason),
          closedByName: strOrNull(o.closedByName),
          reportStatus: (o.reportStatus ?? null) as ReportStatus | null,
          receivedAt: strOrNull(o.receivedAt),
          reads: list(o.reads).map((r) => ({
            at: str(r.at),
            staffName: str(r.staffName ?? ''),
            what: r.what === 'context' ? 'context' : 'report',
            reason: str(r.reason ?? ''),
          })),
        };
      }),
    readLog: (limit) =>
      guard(async () =>
        list(await t.value('read_log_list', { p_limit: limit })).map((r) => ({
          at: str(r.at),
          staffName: str(r.staffName ?? ''),
          staffRole: str(r.staffRole),
          caseId: str(r.caseId),
          reportId: strOrNull(r.reportId),
          what: r.what === 'context' ? ('context' as const) : ('report' as const),
          reason: str(r.reason ?? ''),
        })),
      ),
    async setCaptureSince(i) {
      await guard(() => t.value('safety_capture_set', { p_on: i.on, p_reason: i.reason, p_env: i.env }));
    },
  };
}
