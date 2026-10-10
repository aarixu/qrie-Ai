import type { ChartSeries, ContentView } from '@ai-tutor/admin-client';
import { BookOpen, Library } from 'lucide-react';
import { charts } from '@/lib/client';
import { useLoad } from '@/lib/use-load';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartCard } from '@/components/charts/chart-card';
import { Kpi } from '@/components/charts/kpi';
import { LoadView } from '@/components/load-view';
import { ChartGrid, ChartsFrame, MetricCard, metricOf, TileRow } from './frame';
import { floorWord, formatValue, seriesFor, sumOf } from './model';

/** Classes and the question bank over time, what classes cost, pictures, and the most reported and costliest classes. */
export function ChartsContent() {
  return <ChartsFrame page='content' title='Charts: Content'>{({ series }) => <ContentBody series={series} />}</ChartsFrame>;
}

const rupees = (inr: number) => `₹${inr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ContentNow() {
  const { view, reload } = useLoad(() => charts.content(), []);
  return (
    <LoadView view={view} reload={reload} skeletons={2}>
      {(c) => <ContentNowBody c={c} />}
    </LoadView>
  );
}

function ContentNowBody({ c }: { c: ContentView }) {
  return (
    <div className='space-y-4'>
      <TileRow>
        <Kpi
          label='Classes now'
          value={`${c.classes.published} published`}
          hint={`${c.classes.pending} waiting for review, ${c.classes.retracted} retracted, ${c.classes.removed} removed.`}
          icon={BookOpen}
        />
        <Kpi
          label='Question bank now'
          value={`${c.bank.library} in the library`}
          hint={`Schools' own: ${c.bank.schoolApproved} approved, ${c.bank.schoolWaiting} waiting. ${c.bank.drafts} drafts.`}
          icon={Library}
        />
      </TileRow>
      <ChartGrid>
        <ChartCard title='Most reported classes' description='To date: reports about each class, counts only.'>
          {c.mostReported.length === 0 ? (
            <p className='px-4 text-sm text-muted-foreground'>No class has a report.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead className='text-right'>Reports</TableHead>
                  <TableHead className='text-right'>Open</TableHead>
                  <TableHead className='text-right'>Unsafe, open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.mostReported.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.title} <span className='font-mono text-xs text-muted-foreground'>{r.id}</span>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>{r.reports.total}</TableCell>
                    <TableCell className='text-right tabular-nums'>{r.reports.open}</TableCell>
                    <TableCell className='text-right tabular-nums'>{r.reports.unsafe}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ChartCard>
        <ChartCard title='Costliest classes' description='To date: calls of sittings on the class’s topic and those sharing their preparation.'>
          {c.mostCost.length === 0 ? (
            <p className='px-4 text-sm text-muted-foreground'>No class has a call yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead className='text-right'>Spend</TableHead>
                  <TableHead className='text-right'>Calls</TableHead>
                  <TableHead className='text-right'>Sittings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.mostCost.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.title} <span className='font-mono text-xs text-muted-foreground'>{r.id}</span>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {r.cost.unpriced ? 'at least ' : ''}
                      {rupees(r.cost.inr)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>{r.cost.calls}</TableCell>
                    <TableCell className='text-right tabular-nums'>{r.cost.sittings}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ChartCard>
      </ChartGrid>
    </div>
  );
}

function ContentBody({ series }: { series: ChartSeries }) {
  const pictureUnpriced = (() => {
    const m = metricOf(series, 'pictures.unpriced_calls');
    return m ? (sumOf(seriesFor(m)) ?? 0) : 0;
  })();
  const picturesPaise = metricOf(series, 'pictures.paise');
  const pictureSpend = picturesPaise ? sumOf(seriesFor(picturesPaise)) : null;

  return (
    <div className='space-y-6'>
      <ContentNow />
      <ChartGrid>
        <MetricCard
          metric={metricOf(series, 'content.classes')}
          title='Classes by status'
          description='As the nightly run saw them.'
          kind='stacked'
          lines={[
            { dim: 'published', label: 'Published' },
            { dim: 'pending', label: 'Waiting for review' },
            { dim: 'retracted', label: 'Retracted' },
            { dim: 'removed', label: 'Removed' },
          ]}
        />
        <MetricCard
          metric={metricOf(series, 'content.bank')}
          title='Question bank by review state'
          description='As the nightly run saw it.'
          kind='stacked'
          lines={[
            { dim: 'library', label: 'Library' },
            { dim: 'school_approved', label: "Schools' own, approved" },
            { dim: 'school_waiting', label: "Schools' own, waiting" },
            { dim: 'drafts', label: 'Drafts' },
          ]}
        />
        <MetricCard
          metric={metricOf(series, 'spend.paise')}
          title='Class cost per day'
          description='AI spend making a class for its first student (live) and serving the kept one (warm).'
          kind='stacked'
          lines={[
            { dim: 'bucket:live', label: 'Live' },
            { dim: 'bucket:warm', label: 'Warm' },
          ]}
        />
        <MetricCard
          metric={metricOf(series, 'pictures.count')}
          title='Pictures made'
          footer={
            pictureSpend === null
              ? undefined
              : `Spend on pictures over the window: ${floorWord(pictureUnpriced)}${formatValue('paise', pictureSpend)}${
                  pictureUnpriced > 0 ? ` (${pictureUnpriced} picture call${pictureUnpriced === 1 ? '' : 's'} have no price yet).` : '.'
                }`
          }
        />
      </ChartGrid>
    </div>
  );
}
