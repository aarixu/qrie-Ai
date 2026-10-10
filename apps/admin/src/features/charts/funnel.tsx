import type { ChartSeries } from '@ai-tutor/admin-client';
import { ChartCard } from '@/components/charts/chart-card';
import { ChartGrid, ChartsFrame, MetricCard, metricOf } from './frame';
import { SUPPRESSED_TEXT } from './model';

/**
 * The contest funnel: entries per day, and the window's entrants who had a
 * parent verified, a first class and a second day, as totals only (ruling
 * R19). A total under 10 entrants is hidden.
 */
export function ChartsFunnel() {
  return <ChartsFrame page='funnel' title='Charts: Funnel'>{({ series }) => <FunnelBody series={series} />}</ChartsFrame>;
}

const STEPS = [
  { key: 'funnel.cohort', label: 'Entered the contest' },
  { key: 'funnel.verified', label: 'A parent verified' },
  { key: 'funnel.first_class', label: 'Had a first class' },
  { key: 'funnel.second_day', label: 'Came back on a second day' },
] as const;

function FunnelBody({ series }: { series: ChartSeries }) {
  const steps = STEPS.map((s) => ({ ...s, total: metricOf(series, s.key)?.total ?? null }));
  const entrants = steps[0].total;
  const base = entrants && !entrants.suppressed && entrants.value !== null ? entrants.value : null;
  return (
    <ChartGrid>
      <MetricCard metric={metricOf(series, 'funnel.entries')} title='Contest entries per day' description='By the India day each entry arrived.' />
      <ChartCard
        title='The funnel'
        description={`Children who entered between ${series.from} and ${series.to}, and how far they have come since. Totals only, so no small day can be picked out.`}
      >
        {base === null && entrants?.suppressed ? (
          <p className='px-4 text-sm text-muted-foreground'>{SUPPRESSED_TEXT}</p>
        ) : (
          <ol className='space-y-3 px-4'>
            {steps.map((s) => {
              const v = s.total && !s.total.suppressed ? s.total.value : null;
              const share = v !== null && base ? Math.round((v * 100) / base) : null;
              return (
                <li key={s.key}>
                  <div className='flex items-baseline justify-between gap-2 text-sm'>
                    <span>{s.label}</span>
                    <span className='tabular-nums'>
                      {s.total === null ? 'No figure yet' : s.total.suppressed ? SUPPRESSED_TEXT : v}
                      {share !== null && s.key !== 'funnel.cohort' ? ` (${share}%)` : ''}
                    </span>
                  </div>
                  <div className='mt-1 h-2 rounded bg-muted'>
                    {share !== null && <div className='h-2 rounded bg-[var(--chart-2)]' style={{ width: `${Math.min(share, 100)}%` }} />}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </ChartCard>
    </ChartGrid>
  );
}
