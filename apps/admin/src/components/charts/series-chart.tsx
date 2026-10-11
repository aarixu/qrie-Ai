import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricUnit } from '@ai-tutor/admin-client';
import { type DayPoint, type DayState, NO_FIGURE_TEXT, NOT_CAPTURED_TEXT, SUPPRESSED_TEXT, formatValue } from '@/features/charts/model';
import { axis, tooltipStyle } from './chart-card';

export interface ChartLine {
  key: string;
  label: string;
  colour: string;
  /** One point per day of the window (model.ts seriesFor). */
  points: DayPoint[];
  /** In a bar or stacked chart, draw this one as a line (a ceiling, say). */
  asLine?: boolean;
}

const LISTED: { state: Exclude<DayState, 'value'>; text: string }[] = [
  { state: 'no-figure', text: 'No figure' },
  { state: 'suppressed', text: SUPPRESSED_TEXT.replace(': not shown.', '') },
  { state: 'not-captured', text: NOT_CAPTURED_TEXT },
];

const shortDay = (d: string) => d.slice(5);

/** An axis tick: rupees for paise, minutes for milliseconds, a grouped number otherwise. */
function tick(unit: MetricUnit, v: number): string {
  if (unit === 'paise') return `₹${Math.round(v / 100).toLocaleString('en-IN')}`;
  if (unit === 'ms') return `${Math.floor(v / 60_000).toLocaleString('en-IN')}`;
  return Math.round(v).toLocaleString('en-IN');
}

/**
 * Daily figures on a shared day axis. A day where no line has a value is a
 * grey band, and every day that is not a value is listed under the chart by
 * its state (no figure, hidden by the small-group rule, not captured): a gap is never
 * drawn as 0. Lines leave a gap there; bars are not drawn.
 */
export function SeriesChart({
  series,
  kind,
  unit,
  reference,
  height = 240,
}: {
  series: ChartLine[];
  kind: 'line' | 'bar' | 'stacked';
  unit: MetricUnit;
  reference?: { value: number; label: string };
  height?: number;
}) {
  const days = series[0]?.points.map((p) => p.day) ?? [];
  const rows = days.map((day, i) => {
    const row: Record<string, string | number | null> = { day };
    for (const s of series) row[s.key] = s.points[i]?.state === 'value' ? s.points[i].value : null;
    return row;
  });
  const gaps = days.filter((_, i) => series.every((s) => s.points[i]?.state !== 'value'));
  const listed = LISTED.map((l) => ({
    ...l,
    days: days.filter((_, i) => series.some((s) => s.points[i]?.state === l.state)),
  })).filter((l) => l.days.length > 0);
  const stateText: Record<DayState, string> = {
    value: '',
    'no-figure': NO_FIGURE_TEXT,
    suppressed: SUPPRESSED_TEXT,
    'not-captured': NOT_CAPTURED_TEXT,
  };

  return (
    <div>
      <ResponsiveContainer width='100%' height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray='3 3' stroke='var(--border)' vertical={false} />
          <XAxis dataKey='day' tickFormatter={shortDay} tick={axis} tickLine={false} axisLine={false} />
          <YAxis tick={axis} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => tick(unit, v)} />
          {gaps.map((d) => (
            <ReferenceArea key={d} x1={d} x2={d} fill='var(--muted)' fillOpacity={0.8} ifOverflow='extendDomain' />
          ))}
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, name, item) => {
              const i = days.indexOf(String((item as { payload?: { day?: string } }).payload?.day ?? ''));
              const s = series.find((x) => x.label === name);
              const p = s && i >= 0 ? s.points[i] : undefined;
              return [p && p.state !== 'value' ? stateText[p.state] : formatValue(unit, typeof v === 'number' ? v : null), name];
            }}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) =>
            kind === 'line' || s.asLine ? (
              <Line
                key={s.key}
                type='monotone'
                dataKey={s.key}
                name={s.label}
                stroke={s.colour}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ) : (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.colour}
                stackId={kind === 'stacked' ? 'a' : undefined}
                isAnimationActive={false}
              />
            ),
          )}
          {reference && (
            <ReferenceLine
              y={reference.value}
              stroke='var(--destructive)'
              strokeDasharray='4 4'
              label={{ value: reference.label, position: 'insideTopRight', fontSize: 11, fill: 'var(--muted-foreground)' }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {listed.length > 0 && (
        <ul className='mt-2 space-y-0.5 px-4 text-xs text-muted-foreground'>
          {listed.map((l) => (
            <li key={l.state}>
              {l.text}: {l.days.map(shortDay).join(', ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
