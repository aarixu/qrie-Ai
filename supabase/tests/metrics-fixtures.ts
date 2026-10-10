import type { PGlite } from '@electric-sql/pglite';
import { rpc, serviceRpc } from './billing-fixtures.ts';
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

/** One figure in the store, replacing any already there. `day` is a date as text (YYYY-MM-DD). */
export async function putMetric(
  db: PGlite,
  row: { day: string; metric: string; org?: string | null; dim?: string; value: number; children?: number | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('admin.session', 'on', true)`);
    await tx.query(
      `insert into admin.metric_daily (day, metric, org_id, dim, value, children) values ($1::date, $2, $3, $4, $5, $6)
       on conflict (day, metric, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), dim)
       do update set value = excluded.value, children = excluded.children`,
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

// ---------------------------------------------------------------------------
// The tutor's records (Task 3), written as the database owner the way the
// ledger drain and the relay write them, received at a given instant.
// ---------------------------------------------------------------------------

/**
 * A sitting received at `receivedSql` (SQL text for an instant). It is closed
 * at that instant unless `endedSql` says otherwise; `endedSql: null` leaves it open.
 */
export async function sitting(
  db: PGlite,
  s: {
    org: string;
    user: string;
    source?: string;
    receivedSql: string;
    endedSql?: string | null;
    activeMs?: number | null;
    topic?: string;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const ended = s.endedSql === undefined ? s.receivedSql : s.endedSql === null ? 'null' : s.endedSql;
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, topic_ref, started_at, ended_at, active_ms, received_at)
     values ($1, $2, $3, $4, $5, ${s.receivedSql}, ${ended}, $6, ${s.receivedSql})`,
    [id, s.org, s.user, s.source ?? 'class', s.topic ?? null, s.activeMs ?? null],
  );
  return id;
}

/** An answer in the ledger, received at `receivedSql`. */
export async function answer(
  db: PGlite,
  a: {
    org: string;
    user: string;
    receivedSql: string;
    source?: string;
    outcomes?: string[];
    payload?: Record<string, unknown>;
    session?: string;
  },
): Promise<void> {
  await db.query(
    `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, payload)
     values ($1, $2, $3, $4, 0, ${a.receivedSql}, ${a.receivedSql}, 'answered', $5, 'tap', $6::text[], $7::jsonb)`,
    [
      crypto.randomUUID(),
      a.org,
      a.user,
      a.session ?? crypto.randomUUID(),
      a.source ?? 'class',
      a.outcomes ?? [],
      JSON.stringify(a.payload ?? {}),
    ],
  );
}

/** One relay call, at `atSql`. Its org is filled from the user's membership unless given. */
export async function usage(
  db: PGlite,
  u: {
    user: string;
    org?: string;
    session?: string;
    atSql: string;
    relay?: string;
    provider?: string;
    model?: string | null;
    status?: number;
    promptTokens?: number | null;
    images?: number | null;
    bucket?: 'live' | 'warm' | null;
    prep?: string | null;
  },
): Promise<void> {
  await db.query(
    `insert into public.usage_event (user_id, org_id, session_id, at, relay, provider, model, status, prompt_tokens, images, bucket, prep_id)
     values ($1, $2, $3, ${u.atSql}, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      u.user,
      u.org ?? null,
      u.session ?? null,
      u.relay ?? 'llm',
      u.provider ?? 'vertex',
      u.model === undefined ? 'gemini-x' : u.model,
      u.status ?? 200,
      u.promptTokens ?? null,
      u.images ?? null,
      u.bucket ?? null,
      u.prep ?? null,
    ],
  );
}

/** A price row for a vertex model, in force since 2026-01-01. */
export async function price(db: PGlite, model: string, unit: string, inrPerUnit: number): Promise<void> {
  await db.query(
    `insert into public.model_price (provider, model, unit, inr_per_unit, effective_from) values ('vertex', $1, $2, $3, '2026-01-01')`,
    [model, unit, inrPerUnit],
  );
}

/** The nightly roll-up, as pg_cron runs it (the service role here). */
export const nightly = (db: PGlite) =>
  serviceRpc<{ day: string; rows: number }>(db, 'metric_nightly', {});

/** Rolls up the India day `daysAgo` days back, as the database owner (what a recompute does per day). */
export async function compute(db: PGlite, daysAgo: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select admin.metric_compute(lms.india_today() - $1::int, false) as n`,
    [Math.trunc(daysAgo)],
  );
  return rows[0].n;
}

/**
 * One metric's rows on one day as {dim: value}: the platform's rows, or one
 * school's when `org` is given. Read as the database owner.
 */
export async function figures(db: PGlite, metric: string, day: string, org: string | null = null): Promise<Record<string, number>> {
  const { rows } = await db.query<{ dim: string; value: string | number }>(
    `select dim, value from admin.metric_daily
      where metric = $1 and day = $2::date and org_id is not distinct from $3::uuid order by dim`,
    [metric, day, org],
  );
  return Object.fromEntries(rows.map((r) => [r.dim, Number(r.value)]));
}

/** The solo organisation a child who came on their own belongs to. */
export async function soloOrg(db: PGlite, user: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select o.id from public.organization o join public.membership m on m.org_id = o.id where m.user_id = $1 and o.kind = 'solo'`,
    [user],
  );
  if (!rows[0]) throw new Error('no solo organisation');
  return rows[0].id;
}

/**
 * The hosted project's auth.users.last_sign_in_at, which the harness's
 * auth.users lacks (Task 5): a stand-in column, added only by the tests that
 * need it.
 */
export async function addSignInColumn(db: PGlite): Promise<void> {
  await db.query(`alter table auth.users add column if not exists last_sign_in_at timestamptz`);
}
