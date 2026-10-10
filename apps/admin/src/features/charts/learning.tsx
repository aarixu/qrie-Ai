import type { ChartDays, ChartSeries } from '@ai-tutor/admin-client';
import { charts } from '@/lib/client';
import { useLoad } from '@/lib/use-load';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartCard } from '@/components/charts/chart-card';
import { LoadView } from '@/components/load-view';
import { ChartGrid, ChartsFrame, MetricCard, metricOf } from './frame';
import { latestPoints, SUPPRESSED_TEXT } from './model';

/**
 * Learning in aggregate: outcomes answered in 30 days by class and subject,
 * misconceptions from library questions (the platform only), and practice
 * answers per day. Every figure is hidden for fewer than 10 children; no
 * child is listed or ranked.
 */
export function ChartsLearning() {
  return (
    <ChartsFrame page='learning' title='Charts: Learning' schoolPicker>
      {({ series, days, school }) => (school ? <OneSchool series={series} days={days} school={school} /> : <LearningBody series={series} totals={series} school={null} />)}
    </ChartsFrame>
  );
}

/** One school's view carries no syllabus totals (a platform figure), so they are read from the platform's series. */
function OneSchool({ series, days, school }: { series: ChartSeries; days: ChartDays; school: string }) {
  const { view, reload } = useLoad(() => charts.series('learning', days), [days]);
  return (
    <LoadView view={view} reload={reload} skeletons={2}>
      {(platform) => <LearningBody series={series} totals={platform} school={school} />}
    </LoadView>
  );
}

const MISCONCEPTIONS_SHOWN = 15;

function LearningBody({ series, totals, school }: { series: ChartSeries; totals: ChartSeries; school: string | null }) {
  const covered = metricOf(series, 'learn.outcomes_covered_30d');
  const total = metricOf(totals, 'learn.outcomes_total');
  const misconceptions = school ? undefined : metricOf(series, 'learn.misconceptions_30d');
  const totalByDim = new Map((total ? latestPoints(total) : []).map((p) => [p.dim, p.value]));
  const rows = (covered ? latestPoints(covered, school) : []).slice().sort((a, b) => (a.dim < b.dim ? -1 : a.dim > b.dim ? 1 : 0));
  const wrong = misconceptions ? latestPoints(misconceptions) : [];
  const shown = wrong
    .filter((p) => !p.suppressed && p.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, MISCONCEPTIONS_SHOWN);
  const hidden = wrong.filter((p) => p.suppressed || p.value === null).length;
  const beyond = wrong.filter((p) => !p.suppressed && p.value !== null).length - shown.length;

  return (
    <div className='space-y-6'>
      <ChartCard
        title='Outcomes answered in 30 days, by class and subject'
        description={`${rows[0] ? `The 30 days ending ${rows[0].day}` : 'The latest 30 days'}: outcomes of the syllabus map anyone${school ? ` at ${school}` : ''} answered, from the tutor, practice and homework.`}
      >
        {rows.length === 0 ? (
          <p className='px-4 text-sm text-muted-foreground'>No figure for this window yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class and subject</TableHead>
                <TableHead className='text-right'>Outcomes answered</TableHead>
                <TableHead className='text-right'>Of the map</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const [grade, subject] = r.dim.split('|');
                const of = totalByDim.get(r.dim) ?? null;
                return (
                  <TableRow key={r.dim}>
                    <TableCell>
                      Class {grade} {subject}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>{r.suppressed || r.value === null ? SUPPRESSED_TEXT : r.value}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {of === null ? '—' : r.suppressed || r.value === null ? `of ${of}` : `of ${of} (${of === 0 ? 0 : Math.round((r.value * 100) / of)}%)`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ChartCard>

      <ChartGrid>
        {!school && (
          <ChartCard
            title='Misconceptions, 30 days'
            description='Wrong options chosen on library questions, by the label the library gives that option. A school’s own questions are left out.'
          >
            {wrong.length === 0 ? (
              <p className='px-4 text-sm text-muted-foreground'>No figure for this window yet.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Class and subject</TableHead>
                      <TableHead>Misconception</TableHead>
                      <TableHead className='text-right'>Answers</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((p) => {
                      const [grade, subject, ...label] = p.dim.split('|');
                      return (
                        <TableRow key={p.dim}>
                          <TableCell>
                            Class {grade} {subject}
                          </TableCell>
                          <TableCell>{label.join('|')}</TableCell>
                          <TableCell className='text-right tabular-nums'>{p.value}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className='mt-2 px-4 text-xs text-muted-foreground'>
                  {beyond > 0 && `${beyond} more with fewer answers. `}
                  {hidden > 0 && `${hidden} more hidden: fewer than 10 children each.`}
                </p>
              </>
            )}
          </ChartCard>
        )}
        <MetricCard
          metric={metricOf(series, 'learn.practice_answers')}
          title='Practice answers per day'
          description='By the day the server received them.'
          school={school}
        />
      </ChartGrid>
    </div>
  );
}
