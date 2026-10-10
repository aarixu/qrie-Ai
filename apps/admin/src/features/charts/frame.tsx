import type { ChartDays, ChartPage, ChartSeries, Metric, MetricUnit } from '@ai-tutor/admin-client';
import { useNavigate, useSearch as useRouteSearch } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { charts, schools } from '@/lib/client';
import { useMe } from '@/lib/me';
import { istStamp } from '@/lib/time';
import { useLoad } from '@/lib/use-load';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AdminPage } from '@/components/admin-page';
import { ChartCard } from '@/components/charts/chart-card';
import { NotCaptured } from '@/components/charts/not-captured';
import { SeriesChart, type ChartLine } from '@/components/charts/series-chart';
import { LoadView } from '@/components/load-view';
import { CHART_PAGES, chartSearch, seriesFor, utcNote, type DayPoint } from './model';
import { RecomputeDialog } from './recompute-dialog';

/** Colours for lines, in order; the first five are the theme's chart colours. */
const COLOURS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', '#64748b', '#0ea5e9', '#a855f7'];
export const colourAt = (i: number): string => COLOURS[i % COLOURS.length];

export interface FrameState {
  series: ChartSeries;
  days: ChartDays;
  /** The school picked on Schools and Learning; null for all schools. */
  school: string | null;
  reload(): void;
}

/**
 * Every chart page's frame: 7 or 30 days (kept in the address as ?days=), on
 * Schools and Learning a school picker (?school=), when the figures were last
 * rolled up, and for the owner the Recompute button. The page's figures come
 * from admin.metric_series through `charts.series`.
 */
export function ChartsFrame({
  page,
  title,
  schoolPicker = false,
  children,
}: {
  page: ChartPage;
  title: string;
  schoolPicker?: boolean;
  children(f: FrameState): ReactNode;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const { days, school: picked } = chartSearch(useRouteSearch({ strict: false }) as Record<string, unknown>);
  const school = schoolPicker ? (picked ?? null) : null;
  const url = CHART_PAGES.find((p) => p.page === page)?.url ?? '/';
  const go = (next: { days: ChartDays; school: string | null }) =>
    void navigate({ to: url, search: next.school ? { days: next.days, school: next.school } : { days: next.days } });
  const { view, reload } = useLoad(() => charts.series(page, days, school ?? undefined), [page, days, school]);
  const [recompute, setRecompute] = useState(false);

  return (
    <AdminPage
      title={title}
      actions={
        <div className='flex flex-wrap items-center gap-2'>
          {schoolPicker && <SchoolPicker value={school} onChange={(code) => go({ days, school: code })} />}
          <div className='flex rounded-md border p-0.5' role='group' aria-label='Days'>
            {([7, 30] as const).map((n) => (
              <Button key={n} size='sm' variant={n === days ? 'secondary' : 'ghost'} onClick={() => go({ days: n, school })}>
                {n} days
              </Button>
            ))}
          </div>
          {me.role === 'owner' && (
            <Button size='sm' variant='outline' onClick={() => setRecompute(true)}>
              Recompute
            </Button>
          )}
        </div>
      }
    >
      <LoadView view={view} reload={reload} skeletons={4}>
        {(series) => (
          <div className='space-y-6'>
            <RunLine series={series} />
            {children({ series, days, school, reload })}
            {me.role === 'owner' && (
              <RecomputeDialog open={recompute} onOpenChange={setRecompute} from={series.from} to={series.to} onDone={reload} />
            )}
          </div>
        )}
      </LoadView>
    </AdminPage>
  );
}

function RunLine({ series }: { series: ChartSeries }) {
  if (!series.lastRun) return <p className='text-sm text-muted-foreground'>No roll-up has run yet.</p>;
  return (
    <p className='text-sm text-muted-foreground'>
      {series.from} to {series.to}, India days. Figures through {series.lastRun.through}, rolled up{' '}
      {istStamp(series.lastRun.finishedAt)} India time{series.lastRun.nightly ? '' : ' (a recompute)'}.
    </p>
  );
}

function SchoolPicker({ value, onChange }: { value: string | null; onChange(code: string | null): void }) {
  const { view } = useLoad(() => schools.index(), []);
  const list = view.state === 'ready' ? view.data : [];
  return (
    <Select value={value ?? 'all'} onValueChange={(v) => onChange(v === 'all' ? null : v)}>
      <SelectTrigger className='w-56' aria-label='School'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='all'>All schools</SelectItem>
        {value && !list.some((s) => s.code === value) && <SelectItem value={value}>{value}</SelectItem>}
        {list.map((s) => (
          <SelectItem key={s.code} value={s.code}>
            {s.code} · {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A metric of the page by key; undefined when the page does not carry it. */
export const metricOf = (s: ChartSeries, key: string): Metric | undefined => s.metrics.find((m) => m.key === key);

/**
 * One metric as a chart card: grey "Not captured" with the reason when the
 * database cannot see it, else its lines (dimensions) drawn by SeriesChart,
 * with the UTC note on a UTC metric.
 */
export function MetricCard({
  metric,
  title,
  description,
  kind = 'bar',
  lines,
  school = null,
  unit,
  reference,
  footer,
  className,
}: {
  metric: Metric | undefined;
  title?: string;
  description?: string;
  kind?: 'line' | 'bar' | 'stacked';
  lines?: { dim: string; label: string }[];
  school?: string | null;
  unit?: MetricUnit;
  reference?: { value: number; label: string };
  footer?: ReactNode;
  className?: string;
}) {
  if (!metric) return null;
  if (!metric.captured) return <NotCaptured label={title ?? metric.label} why={metric.why} className={className} />;
  const wanted = lines ?? [{ dim: '', label: metric.label }];
  const series: ChartLine[] = wanted.map((l, i) => ({
    key: `s${i}`,
    label: l.label,
    colour: colourAt(i),
    points: seriesFor(metric, { dim: l.dim, school }),
  }));
  const note = utcNote(metric);
  return (
    <ChartCard title={title ?? metric.label} description={[description, note].filter(Boolean).join(' ') || undefined} className={className}>
      <SeriesChart series={series} kind={kind} unit={unit ?? metric.unit} reference={reference} />
      {footer && <div className='mt-2 px-4 text-sm text-muted-foreground'>{footer}</div>}
    </ChartCard>
  );
}

/** A chart of lines already worked out (a ratio, two metrics on one axis). */
export function LinesCard({
  title,
  description,
  lines,
  kind = 'bar',
  unit,
  reference,
  footer,
  className,
}: {
  title: string;
  description?: string;
  lines: { label: string; points: DayPoint[]; asLine?: boolean }[];
  kind?: 'line' | 'bar' | 'stacked';
  unit: MetricUnit;
  reference?: { value: number; label: string };
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <ChartCard title={title} description={description} className={className}>
      <SeriesChart
        series={lines.map((l, i) => ({ key: `s${i}`, label: l.label, colour: colourAt(i), points: l.points, asLine: l.asLine }))}
        kind={kind}
        unit={unit}
        reference={reference}
      />
      {footer && <div className='mt-2 px-4 text-sm text-muted-foreground'>{footer}</div>}
    </ChartCard>
  );
}

/** A row of live tiles, the same reads as Today, System, Billing and Safety. */
export function TileRow({ children, className }: { children: ReactNode; className?: string }) {
  return <section aria-label='Now' className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}>{children}</section>;
}

/** Charts two to a row on wide screens. */
export function ChartGrid({ children }: { children: ReactNode }) {
  return <div className='grid gap-4 lg:grid-cols-2'>{children}</div>;
}
