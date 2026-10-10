import type { ChartPage, Me, Metric } from '@ai-tutor/admin-client';
import { formatPaise } from '../billing/money.ts';

/**
 * What the chart pages draw, decided in one pure place (tested in
 * tests/charts-model.test.ts). A day is drawn as a value only when the
 * database gave a value for it: a day nobody rolled up, a figure hidden for
 * fewer than 10 children, and a figure the database cannot see each keep
 * their own state and are never drawn as 0.
 */

/** The eight pages, with the roles admin.chart_roles gives each (ruling R9); the owner reads every page. */
export const CHART_PAGES: { page: ChartPage; title: string; url: string; roles: Me['role'][] }[] = [
  { page: 'overview', title: 'Overview', url: '/charts/overview', roles: ['owner', 'ops'] },
  { page: 'money', title: 'Money', url: '/charts/money', roles: ['owner', 'ops', 'finance'] },
  { page: 'schools', title: 'Schools', url: '/charts/schools', roles: ['owner', 'ops'] },
  { page: 'learning', title: 'Learning', url: '/charts/learning', roles: ['owner', 'ops'] },
  { page: 'content', title: 'Content', url: '/charts/content', roles: ['owner', 'ops'] },
  { page: 'reliability', title: 'Reliability', url: '/charts/reliability', roles: ['owner', 'ops'] },
  { page: 'funnel', title: 'Funnel', url: '/charts/funnel', roles: ['owner', 'ops'] },
  { page: 'safety', title: 'Safety', url: '/charts/safety', roles: ['owner', 'safety'] },
];

export const SUPPRESSED_TEXT = 'Fewer than 10 children: not shown.';
export const NO_FIGURE_TEXT = 'No figure for this day yet.';
export const NOT_CAPTURED_TEXT = 'Not captured';

/** The Rs 5 per student-hour ceiling named in apps/classroom/src/lib/liveClass.ts, in paise. */
export const TARGET_PAISE_PER_HOUR = 500;

export type DayState = 'value' | 'suppressed' | 'no-figure' | 'not-captured';
export interface DayPoint {
  day: string;
  value: number | null;
  state: DayState;
}

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Every day from `from` to `to`, both included (YYYY-MM-DD); none when `to` is before `from`. */
export function daysBetween(from: string, to: string): string[] {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return [];
  const out: string[] = [];
  for (let ms = toMs(from); ms <= toMs(to); ms += DAY_MS) out.push(fromMs(ms));
  return out;
}

/**
 * One line of a metric, a point per day of its window: the platform's (or,
 * with `school`, one school's) points with dimension `dim` (default '').
 *
 * Not captured: the metric, or the days before it was first captured. A
 * suppressed point: hidden for fewer than 10 children. No point: no figure,
 * except that a dimension missing on a day whose '' point exists is a 0 for
 * that day, because every family that writes a '' row with dimensions
 * writes each dimension that had anything (admin.metric_family_*).
 */
export function seriesFor(m: Metric, o: { dim?: string; school?: string | null } = {}): DayPoint[] {
  const dim = o.dim ?? '';
  const school = o.school ?? null;
  const mine = m.points.filter((p) => p.school === school);
  return daysBetween(m.from, m.to).map((day) => {
    if (!m.captured || (m.capturedSince !== null && day < m.capturedSince)) return { day, value: null, state: 'not-captured' };
    const p = mine.find((x) => x.day === day && x.dim === dim);
    if (p) return p.suppressed || p.value === null ? { day, value: null, state: 'suppressed' } : { day, value: p.value, state: 'value' };
    if (dim !== '') {
      const all = mine.find((x) => x.day === day && x.dim === '');
      if (all && !all.suppressed && all.value !== null) return { day, value: 0, state: 'value' };
    }
    return { day, value: null, state: 'no-figure' };
  });
}

/** The dimensions of a metric that start with `prefix`, the prefix removed, sorted. */
export function dimsOf(m: Metric, prefix: string): string[] {
  const out = new Set<string>();
  for (const p of m.points) if (p.dim.startsWith(prefix) && p.dim.length > prefix.length) out.add(p.dim.slice(prefix.length));
  return [...out].sort();
}

/** The sum of the days that have a value; null when none has. */
export function sumOf(points: DayPoint[]): number | null {
  const values = points.filter((p) => p.state === 'value' && p.value !== null).map((p) => p.value as number);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
}

/** Paise per hour on task, rounded to the paisa; null when no time was measured. */
export function perStudentHourPaise(sittingPaise: number, activeMs: number): number | null {
  return activeMs > 0 ? Math.round(sittingPaise / (activeMs / 3_600_000)) : null;
}

/** The share of calls with no price row (0 to 1); null when there were no calls. */
export function unpricedShare(unpriced: number, calls: number): number | null {
  return calls > 0 ? unpriced / calls : null;
}

/** A spend with any unpriced call is a floor. */
export function floorWord(unpriced: number): '' | 'at least ' {
  return unpriced > 0 ? 'at least ' : '';
}

const grouped = (n: number) => Math.round(n).toLocaleString('en-IN');
const STATE_TEXT: Record<DayState, string> = {
  value: '—',
  suppressed: SUPPRESSED_TEXT,
  'no-figure': NO_FIGURE_TEXT,
  'not-captured': NOT_CAPTURED_TEXT,
};

/** A figure in its unit; no figure reads as its state's words (a dash when no state is given). */
export function formatValue(unit: Metric['unit'], v: number | null, state?: DayState): string {
  if (v === null) return state ? STATE_TEXT[state] : '—';
  switch (unit) {
    case 'paise':
      return formatPaise(v);
    case 'ms':
      return `${grouped(Math.floor(v / 60_000))} min`;
    case 'minutes':
      return `${grouped(v)} min`;
    default:
      return grouped(v);
  }
}

export interface HealthDay {
  day: string;
  green: number | null;
  amber: number | null;
  red: number | null;
  grey: number | null;
}

/** Schools at each health level per day (school.health); a day with no snapshot has no counts. */
export function healthByDay(m: Metric): HealthDay[] {
  return daysBetween(m.from, m.to).map((day) => {
    const on = m.points.filter((p) => p.day === day);
    if (on.length === 0) return { day, green: null, amber: null, red: null, grey: null };
    const count = (level: string) => on.filter((p) => p.dim === level).length;
    return { day, green: count('green'), amber: count('amber'), red: count('red'), grey: count('grey') };
  });
}

/** Each school's days (school.active): true when anything happened, false when nothing, null when there is no figure. */
export function quietGrid(m: Metric): { school: string; days: { day: string; active: boolean | null }[] }[] {
  const schools = [...new Set(m.points.map((p) => p.school).filter((s): s is string => s !== null))].sort();
  const days = daysBetween(m.from, m.to);
  return schools.map((school) => ({
    school,
    days: days.map((day) => {
      const p = m.points.find((x) => x.school === school && x.day === day && x.dim === '');
      return { day, active: p && p.value !== null ? p.value > 0 : null };
    }),
  }));
}

/** Each school's latest point (dimension ''), by code. */
export function latestBySchool(m: Metric): { school: string; value: number | null; suppressed: boolean }[] {
  const latest = new Map<string, { day: string; value: number | null; suppressed: boolean }>();
  for (const p of m.points) {
    if (p.school === null || p.dim !== '') continue;
    const seen = latest.get(p.school);
    if (!seen || p.day > seen.day) latest.set(p.school, { day: p.day, value: p.value, suppressed: p.suppressed });
  }
  return [...latest.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([school, p]) => ({ school, value: p.value, suppressed: p.suppressed }));
}

const RANGE_ERROR = 'Pick up to 92 days, ending yesterday or earlier.';

/** The database's rule for a recompute (admin.metric_recompute): from ≤ to, to before today (India), at most 92 days. */
export function recomputeCheck(from: string, to: string, todayIst: string): { ok: true } | { ok: false; error: string } {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || !ISO_DAY.test(todayIst)) return { ok: false, error: RANGE_ERROR };
  if (from > to || to >= todayIst || (toMs(to) - toMs(from)) / DAY_MS > 91) return { ok: false, error: RANGE_ERROR };
  return { ok: true };
}

/** What a recompute does, said before it is confirmed (rulings R7, R8). */
export function recomputeBlast(from: string, to: string): string {
  return (
    `The figures of ${from} to ${to} are worked out again from the records as they are now. ` +
    'Health, seats, activation, sign-ins, classes by status and the question bank keep the values seen on their night. ' +
    'Records erased or purged since are not counted.'
  );
}

/** The meter's units and the ceiling are kept by UTC day (ruling R4). */
export function utcNote(m: Metric): string | null {
  return m.dayKind === 'utc' ? "By UTC day, the ceiling's own day; this line ends a day earlier." : null;
}

const STATE_RANK: Record<DayState, number> = { 'not-captured': 3, suppressed: 2, 'no-figure': 1, value: 0 };

/**
 * One line made from two, day by day (Rs per student-hour from spend and
 * time, say). A day where either side is not a value keeps that side's
 * state (not captured before fewer than 10 children before no figure); a day
 * where `f` gives null has no figure.
 */
export function ratioSeries(top: DayPoint[], bottom: DayPoint[], f: (a: number, b: number) => number | null): DayPoint[] {
  return top.map((t, i) => {
    const b = bottom[i] ?? { day: t.day, value: null, state: 'no-figure' as const };
    if (t.state !== 'value' || b.state !== 'value' || t.value === null || b.value === null) {
      const state = STATE_RANK[t.state] >= STATE_RANK[b.state] ? t.state : b.state;
      return { day: t.day, value: null, state: state === 'value' ? 'no-figure' : state };
    }
    const v = f(t.value, b.value);
    return v === null ? { day: t.day, value: null, state: 'no-figure' } : { day: t.day, value: v, state: 'value' };
  });
}

/** A chart page's address: ?days= 7 or 30 (7 otherwise) and, on Schools and Learning, ?school=<code>. */
export function chartSearch(search: Record<string, unknown>): { days: 7 | 30; school?: string } {
  const days = search.days === 30 || search.days === '30' ? 30 : 7;
  const school = typeof search.school === 'string' && search.school.trim() !== '' ? search.school.trim().toUpperCase() : undefined;
  return school ? { days, school } : { days };
}
