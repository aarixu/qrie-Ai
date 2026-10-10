import type { PGlite } from '@electric-sql/pglite';
import { rpc } from './billing-fixtures.ts';
import type { JwtClaims } from './harness.ts';

/**
 * Plan 6's fixtures: catalogue rows and figures written straight into the
 * chart store, India-time instants, and the chart read, the way the console
 * calls it. Writes go in as the database owner with admin.session on, as the
 * roll-up functions write.
 */

export interface MetricDefOver {
  key: string;
  pages: string[];
  label: string;
  unit: string;
  dayKind: 'india' | 'utc';
  kind: 'daily' | 'window' | 'snapshot' | 'cohort';
  scope: 'platform' | 'school' | 'both';
  childFigure: boolean;
  total: 'sum' | 'last' | 'none';
  position: number;
}

/** Inserts (or replaces) a catalogue row and returns its key. */
export async function metricDef(db: PGlite, over: Partial<MetricDefOver> = {}): Promise<string> {
  const d: MetricDefOver = {
    key: 'test.count',
    pages: ['overview'],
    label: 'A test figure',
    unit: 'count',
    dayKind: 'india',
    kind: 'daily',
    scope: 'platform',
    childFigure: false,
    total: 'sum',
    position: 900,
    ...over,
  };
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('admin.session', 'on', true)`);
    await tx.query(
      `insert into admin.metric_def (key, position, pages, label, unit, day_kind, kind, scope, child_figure, total)
       values ($1, $2, $3::text[], $4, $5, $6, $7, $8, $9, $10)
       on conflict (key) do update set position = excluded.position, pages = excluded.pages, label = excluded.label,
         unit = excluded.unit, day_kind = excluded.day_kind, kind = excluded.kind, scope = excluded.scope,
         child_figure = excluded.child_figure, total = excluded.total`,
      [d.key, d.position, d.pages, d.label, d.unit, d.dayKind, d.kind, d.scope, d.childFigure, d.total],
    );
  });
  return d.key;
}

/** One figure in the store. `day` is a date as text (YYYY-MM-DD). */
export async function putMetric(
  db: PGlite,
  row: { day: string; metric: string; org?: string | null; dim?: string; value: number; children?: number | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('admin.session', 'on', true)`);
    await tx.query(
      `insert into admin.metric_daily (day, metric, org_id, dim, value, children) values ($1::date, $2, $3, $4, $5, $6)`,
      [row.day, row.metric, row.org ?? null, row.dim ?? '', row.value, row.children ?? null],
    );
  });
}

/** SQL text for the instant hh:mm India time on the India day `daysAgo` days before today. */
export const atIst = (daysAgo: number, hhmm = '10:00'): string =>
  `(((lms.india_today() - ${Math.trunc(daysAgo)})::timestamp + time '${hhmm}') at time zone 'Asia/Kolkata')`;

/** The India day `daysAgo` days before today, as YYYY-MM-DD. */
export async function istDay(db: PGlite, daysAgo = 0): Promise<string> {
  const { rows } = await db.query<{ d: string }>(`select (lms.india_today() - $1::int)::text as d`, [Math.trunc(daysAgo)]);
  return rows[0].d;
}

/** The UTC day `daysAgo` days before today's UTC day, as YYYY-MM-DD. */
export async function utcDay(db: PGlite, daysAgo = 0): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    `select ((now() at time zone 'UTC')::date - $1::int)::text as d`,
    [Math.trunc(daysAgo)],
  );
  return rows[0].d;
}

export interface PointJson {
  day: string;
  dim: string;
  school: string | null;
  value: number | null;
  suppressed: boolean;
}

export interface MetricJson {
  key: string;
  label: string;
  unit: string;
  dayKind: 'india' | 'utc';
  kind: string;
  captured: boolean;
  why: string | null;
  capturedSince: string | null;
  from: string;
  to: string;
  total: { value: number | null; suppressed: boolean } | null;
  points: PointJson[];
}

export interface ChartSeriesJson {
  page: string;
  days: number;
  from: string;
  to: string;
  school: { code: string; name: string } | null;
  lastRun: { through: string; finishedAt: string; nightly: boolean } | null;
  metrics: MetricJson[];
}

/** admin.metric_series as the console calls it. */
export const series = (db: PGlite, claims: JwtClaims, page: string, days: number, school?: string) =>
  rpc<ChartSeriesJson>(db, claims, 'metric_series', { p_page: page, p_days: days, p_school: school });

/** One metric of a series, by key; throws when the page does not carry it. */
export function metricOf(s: ChartSeriesJson, key: string): MetricJson {
  const m = s.metrics.find((x) => x.key === key);
  if (!m) throw new Error(`no metric ${key} on ${s.page}`);
  return m;
}
