import type { ChartSeries } from '@ai-tutor/admin-client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartCard } from '@/components/charts/chart-card';
import { ChartGrid, ChartsFrame, MetricCard, metricOf } from './frame';
import { formatValue, funnelWeeks } from './model';

/**
 * The contest funnel: entries per day, and the children who entered in each
 * complete India week (Monday to Sunday) with how many of them had a parent
 * verified, a first class and a second day (ruling R19). The database gives
 * the cohorts per complete week only, never a total over several weeks or a
 * single day, and hides a week under 10 entrants.
 */
export function ChartsFunnel() {
  return <ChartsFrame page='funnel' title='Charts: Funnel'>{({ series }) => <FunnelBody series={series} />}</ChartsFrame>;
}

const STEPS = [
  { key: 'funnel.cohort', label: 'Entered' },
  { key: 'funnel.verified', label: 'A parent verified' },
  { key: 'funnel.first_class', label: 'Had a first class' },
  { key: 'funnel.second_day', label: 'Came back on a second day' },
] as const;

function FunnelBody({ series }: { series: ChartSeries }) {
  const weeks = funnelWeeks(STEPS.map((s) => metricOf(series, s.key)));
  return (
    <ChartGrid>
      <MetricCard metric={metricOf(series, 'funnel.entries')} title='Contest entries per day' description='By the India day each entry arrived.' />
      <ChartCard
        title='The funnel, by the week children entered'
        description={
          'Each complete India week (Monday to Sunday) on its own: the children who entered that week, and how far they have come since. ' +
          'Weeks never overlap and there is no total, so no figure here can be subtracted from another to show how fewer than 10 children got on.'
        }
      >
        {weeks.length === 0 ? (
          <p className='px-4 text-sm text-muted-foreground'>No figure yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week of</TableHead>
                {STEPS.map((s) => (
                  <TableHead key={s.key} className='text-right'>
                    {s.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeks.map((w) => {
                const entered = w.steps[0];
                const base = entered.state === 'value' && entered.value ? entered.value : null;
                return (
                  <TableRow key={w.week}>
                    <TableCell className='tabular-nums'>{w.week}</TableCell>
                    {w.steps.map((s, i) => (
                      <TableCell key={STEPS[i].key} className='text-right tabular-nums'>
                        {s.state === 'no-figure' ? 'No figure yet' : formatValue('count', s.value, s.state)}
                        {i > 0 && base !== null && s.state === 'value' && s.value !== null ? ` (${Math.round((s.value * 100) / base)}%)` : ''}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ChartCard>
    </ChartGrid>
  );
}
