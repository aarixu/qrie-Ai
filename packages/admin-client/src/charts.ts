import type { ClassCost, ClassReports } from './classes.ts';
import { day, guard, num, numOrNull, str, strOrNull } from './read.ts';
import type { Write } from './schools.ts';
import type { AdminTransport } from './transport.ts';

/**
 * The chart pages (migrations 0071 to 0074): one page's daily figures for the
 * 7 or 30 India days ending yesterday, margin and renewals, the content lists,
 * and the owner's recompute. A figure the database hides by its small-group
 * rule (fewer than 10 children, or a figure that would let so small a group
 * be worked out) arrives as null with suppressed true; a figure the database
 * cannot see arrives with captured false and its reason; a day with no
 * roll-up has no point at all. A 'block' metric arrives for its latest fixed
 * 30-day block only (its from and to are the block's), and a 'cohort' metric
 * per complete India week, one point per week on its Monday.
 */

export type ChartPage = 'overview' | 'money' | 'schools' | 'learning' | 'content' | 'reliability' | 'funnel' | 'safety';
export type ChartDays = 7 | 30;
export type MetricUnit = 'count' | 'paise' | 'ms' | 'minutes' | 'units';

export interface MetricPoint {
  day: string;
  dim: string;
  school: string | null;
  value: number | null;
  suppressed: boolean;
}

export interface Metric {
  key: string;
  label: string;
  unit: MetricUnit;
  dayKind: 'india' | 'utc';
  kind: 'daily' | 'window' | 'block' | 'snapshot' | 'cohort';
  captured: boolean;
  why: string | null;
  capturedSince: string | null;
  from: string;
  to: string;
  total: { value: number | null; suppressed: boolean } | null;
  points: MetricPoint[];
}

export interface ChartSeries {
  page: ChartPage;
  days: ChartDays;
  from: string;
  to: string;
  school: { code: string; name: string } | null;
  lastRun: { through: string; finishedAt: string; nightly: boolean } | null;
  metrics: Metric[];
}

export interface MarginRow {
  code: string;
  name: string;
  feePaise: number;
  costPaise: number;
  costIsFloor: boolean;
  marginPaise: number;
  noFee: boolean;
  daysRolledUp: number;
}

export interface RenewalWeek {
  weekStart: string;
  schools: number;
  paiseAtCurrentPrice: number;
}

export interface MoneyView {
  from: string;
  to: string;
  days: ChartDays;
  margin: MarginRow[];
  directCostPaise: number;
  renewals: RenewalWeek[];
}

export interface ContentClassRow {
  id: string;
  title: string;
  topicRef: string;
}

export interface ContentView {
  classes: Record<'pending' | 'published' | 'retracted' | 'removed', number>;
  bank: { library: number; schoolApproved: number; schoolWaiting: number; drafts: number };
  mostReported: (ContentClassRow & { reports: ClassReports })[];
  mostCost: (ContentClassRow & { cost: ClassCost })[];
}

export interface RecomputeResult {
  from: string;
  to: string;
  days: number;
  rows: number;
}

export interface ChartsClient {
  series(page: ChartPage, days: ChartDays, school?: string): Promise<ChartSeries>;
  money(days: ChartDays): Promise<MoneyView>;
  content(): Promise<ContentView>;
  /** Owner only, with a fresh authenticator code: up to 92 days ending yesterday. */
  recompute(i: { from: string; to: string } & Write): Promise<RecomputeResult>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const date = (v: unknown): string => day(v) ?? '';
const dateOrNull = (v: unknown): string | null => day(v);
const days = (v: unknown): ChartDays => (num(v) === 30 ? 30 : 7);

const point = (p: Obj): MetricPoint => ({
  day: date(p.day),
  dim: str(p.dim ?? ''),
  school: strOrNull(p.school),
  value: numOrNull(p.value),
  suppressed: p.suppressed === true,
});

const metric = (m: Obj): Metric => {
  const total = m.total ? obj(m.total) : null;
  return {
    key: str(m.key),
    label: str(m.label),
    unit: str(m.unit) as MetricUnit,
    dayKind: m.dayKind === 'utc' ? 'utc' : 'india',
    kind: str(m.kind) as Metric['kind'],
    captured: m.captured === true,
    why: strOrNull(m.why),
    capturedSince: dateOrNull(m.capturedSince),
    from: date(m.from),
    to: date(m.to),
    total: total ? { value: numOrNull(total.value), suppressed: total.suppressed === true } : null,
    points: list(m.points).map(point),
  };
};

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

const classOf = (r: Obj): ContentClassRow => ({ id: str(r.id), title: str(r.title), topicRef: str(r.topicRef) });

export function createChartsClient(t: AdminTransport): ChartsClient {
  return {
    series: (page, n, school) =>
      guard(async () => {
        const o = obj(await t.value('metric_series', { p_page: page, p_days: n, p_school: school }));
        const sch = o.school ? obj(o.school) : null;
        const run = o.lastRun ? obj(o.lastRun) : null;
        return {
          page: str(o.page) as ChartPage,
          days: days(o.days),
          from: date(o.from),
          to: date(o.to),
          school: sch ? { code: str(sch.code), name: str(sch.name) } : null,
          lastRun: run ? { through: date(run.through), finishedAt: str(run.finishedAt), nightly: run.nightly === true } : null,
          metrics: list(o.metrics).map(metric),
        };
      }),
    money: (n) =>
      guard(async () => {
        const o = obj(await t.value('money_view', { p_days: n }));
        return {
          from: date(o.from),
          to: date(o.to),
          days: days(o.days),
          margin: list(o.margin).map((m) => ({
            code: str(m.code),
            name: str(m.name),
            feePaise: num(m.feePaise ?? 0),
            costPaise: num(m.costPaise ?? 0),
            costIsFloor: m.costIsFloor === true,
            marginPaise: num(m.marginPaise ?? 0),
            noFee: m.noFee === true,
            daysRolledUp: num(m.daysRolledUp ?? 0),
          })),
          directCostPaise: num(o.directCostPaise ?? 0),
          renewals: list(o.renewals).map((w) => ({
            weekStart: date(w.weekStart),
            schools: num(w.schools ?? 0),
            paiseAtCurrentPrice: num(w.paiseAtCurrentPrice ?? 0),
          })),
        };
      }),
    content: () =>
      guard(async () => {
        const o = obj(await t.value('content_view', {}));
        const c = obj(o.classes);
        const b = obj(o.bank);
        return {
          classes: {
            pending: num(c.pending ?? 0),
            published: num(c.published ?? 0),
            retracted: num(c.retracted ?? 0),
            removed: num(c.removed ?? 0),
          },
          bank: {
            library: num(b.library ?? 0),
            schoolApproved: num(b.schoolApproved ?? 0),
            schoolWaiting: num(b.schoolWaiting ?? 0),
            drafts: num(b.drafts ?? 0),
          },
          mostReported: list(o.mostReported).map((r) => ({ ...classOf(r), reports: reportsOf(r.reports) })),
          mostCost: list(o.mostCost).map((r) => ({ ...classOf(r), cost: costOf(r.cost) })),
        };
      }),
    recompute: (i) =>
      guard(async () => {
        const o = obj(
          await t.value('metric_recompute', { p_from: i.from, p_to: i.to, p_reason: i.reason, p_env: i.env }),
        );
        return { from: date(o.from), to: date(o.to), days: num(o.days ?? 0), rows: num(o.rows ?? 0) };
      }),
  };
}
