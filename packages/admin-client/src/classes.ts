import type { AdminApiCaller } from './admin-api.ts';
import { guard, num, numOrNull, str, strOrNull } from './read.ts';
import type { Write } from './schools.ts';
import type { AdminTransport } from './transport.ts';

/**
 * Classes (migration 0068): those waiting for review, published and removed,
 * each with its reports (counts) and what it cost. Publishing is a database
 * call; retracting and rejecting go through admin-api's class-remove, which
 * hides the class, deletes its files from Storage, then its catalogue row.
 */

export type ClassStatus = 'pending' | 'published' | 'retracted';

export interface ClassCost {
  inr: number;
  liveInr: number;
  warmInr: number;
  unpriced: boolean;
  calls: number;
  sittings: number;
}

export interface ClassReports {
  total: number;
  open: number;
  unsafe: number;
}

export interface ClassRow {
  id: string;
  topicRef: string;
  title: string;
  subtitle: string | null;
  klass: number;
  subject: string;
  status: ClassStatus;
  createdAt: string;
  publishedAt: string | null;
  version: number;
  reports: ClassReports;
  cost: ClassCost;
  lastAction: { action: string; byName: string; at: string } | null;
}

export interface RemovedClassRow {
  id: string;
  topicRef: string;
  title: string;
  removedAt: string;
  byName: string;
  reason: string;
  reports: ClassReports;
}

export interface ClassDetail {
  live: ClassRow | null;
  removed: RemovedClassRow | null;
  reportsByKind: Record<'wrong' | 'rude' | 'unsafe' | 'other', number>;
  reportsByStatus: Record<'new' | 'seen' | 'triaged' | 'closed', number>;
  history: { action: string; byName: string; at: string; reason: string; files: number | null }[];
  filesInStorage: number;
}

export interface ClassesClient {
  list(status?: ClassStatus): Promise<ClassRow[]>;
  removed(): Promise<RemovedClassRow[]>;
  detail(id: string): Promise<ClassDetail>;
  publish(i: { classId: string } & Write): Promise<void>;
  /** admin-api's class-remove. */
  remove(i: { classId: string; action: 'retract' | 'reject' } & Write): Promise<{ classId: string; removed: number }>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

const reportsOf = (v: unknown): ClassReports => {
  const o = obj(v);
  return { total: num(o.total ?? 0), open: num(o.open ?? 0), unsafe: num(o.unsafe ?? 0) };
};

const costOf = (v: unknown): ClassCost => {
  const o = obj(v);
  return {
    inr: num(o.inr ?? 0),
    liveInr: num(o.liveInr ?? 0),
    warmInr: num(o.warmInr ?? 0),
    unpriced: o.unpriced === true,
    calls: num(o.calls ?? 0),
    sittings: num(o.sittings ?? 0),
  };
};

const classRow = (r: Obj): ClassRow => {
  const last = r.lastAction ? obj(r.lastAction) : null;
  return {
    id: str(r.id),
    topicRef: str(r.topicRef),
    title: str(r.title),
    subtitle: strOrNull(r.subtitle),
    klass: num(r.klass),
    subject: str(r.subject),
    status: r.status as ClassStatus,
    createdAt: str(r.createdAt),
    publishedAt: strOrNull(r.publishedAt),
    version: num(r.version ?? 0),
    reports: reportsOf(r.reports),
    cost: costOf(r.cost),
    lastAction: last ? { action: str(last.action), byName: str(last.byName ?? ''), at: str(last.at) } : null,
  };
};

const removedRow = (r: Obj): RemovedClassRow => ({
  id: str(r.id),
  topicRef: str(r.topicRef),
  title: str(r.title),
  removedAt: str(r.removedAt),
  byName: str(r.byName ?? ''),
  reason: str(r.reason ?? ''),
  reports: reportsOf(r.reports),
});

export function createClassesClient(t: AdminTransport, api: AdminApiCaller): ClassesClient {
  return {
    list: (status) => guard(async () => list(await t.value('classes', { p_status: status })).map(classRow)),
    removed: () => guard(async () => list(await t.value('classes', { p_status: 'removed' })).map(removedRow)),
    detail: (id) =>
      guard(async () => {
        const o = obj(await t.value('class_detail', { p_class: id }));
        const byKind = obj(o.reportsByKind);
        const byStatus = obj(o.reportsByStatus);
        return {
          live: o.live ? classRow(obj(o.live)) : null,
          removed: o.removed ? removedRow(obj(o.removed)) : null,
          reportsByKind: {
            wrong: num(byKind.wrong ?? 0),
            rude: num(byKind.rude ?? 0),
            unsafe: num(byKind.unsafe ?? 0),
            other: num(byKind.other ?? 0),
          },
          reportsByStatus: {
            new: num(byStatus.new ?? 0),
            seen: num(byStatus.seen ?? 0),
            triaged: num(byStatus.triaged ?? 0),
            closed: num(byStatus.closed ?? 0),
          },
          history: list(o.history).map((h) => ({
            action: str(h.action),
            byName: str(h.byName ?? ''),
            at: str(h.at),
            reason: str(h.reason ?? ''),
            files: numOrNull(h.files),
          })),
          filesInStorage: num(o.filesInStorage ?? 0),
        };
      }),
    async publish(i) {
      await guard(() => t.value('class_publish', { p_class: i.classId, p_reason: i.reason, p_env: i.env }));
    },
    remove: (i) =>
      guard(async () => {
        const o = obj(await api.post('class-remove', { classId: i.classId, action: i.action, reason: i.reason, env: i.env }));
        return { classId: str(o.classId), removed: num(o.removed ?? 0) };
      }),
  };
}
