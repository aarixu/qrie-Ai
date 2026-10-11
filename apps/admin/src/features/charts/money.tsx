import type { ChartDays, ChartSeries, MoneyView } from '@ai-tutor/admin-client';
import { AlarmClock, IndianRupee, Wallet } from 'lucide-react';
import { billing, charts } from '@/lib/client';
import { useLoad } from '@/lib/use-load';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartCard } from '@/components/charts/chart-card';
import { Kpi } from '@/components/charts/kpi';
import { LoadView } from '@/components/load-view';
import { formatPaise } from '../billing/money';
import { ChartGrid, ChartsFrame, LinesCard, MetricCard, metricOf, TileRow } from './frame';
import { dimsOf, floorWord, ratioSeries, seriesFor, sumOf } from './model';

/** Money collected and owed, AI spend, the cost of preparing a class, renewals ahead and margin per school. */
export function ChartsMoney() {
  return <ChartsFrame page='money' title='Charts: Money'>{({ series, days }) => <MoneyBody series={series} days={days} />}</ChartsFrame>;
}

function MoneyTiles() {
  const { view, reload } = useLoad(() => billing.overview(), []);
  return (
    <LoadView view={view} reload={reload} skeletons={1}>
      {(o) => (
        <TileRow>
          <Kpi label='Collected this month' value={formatPaise(o.collectedThisMonthPaise)} icon={Wallet} />
          <Kpi label='Outstanding' value={formatPaise(o.outstandingPaise)} icon={IndianRupee} />
          <Kpi
            label='Overdue'
            value={formatPaise(o.overdue.paise)}
            hint={`${o.overdue.count} invoice${o.overdue.count === 1 ? '' : 's'} past their due date.`}
            tone={o.overdue.count > 0 ? 'bad' : undefined}
            icon={AlarmClock}
          />
        </TileRow>
      )}
    </LoadView>
  );
}

function MoneyBody({ series, days }: { series: ChartSeries; days: ChartDays }) {
  const { view, reload } = useLoad(() => charts.money(days), [days]);
  const collected = metricOf(series, 'money.collected_paise');
  const outstanding = metricOf(series, 'money.outstanding_paise');
  const overdue = metricOf(series, 'money.overdue_paise');
  const spend = metricOf(series, 'spend.paise');
  const unpricedCalls = (() => {
    const m = metricOf(series, 'spend.unpriced_calls');
    return m ? (sumOf(seriesFor(m)) ?? 0) : 0;
  })();
  const prepPaise = metricOf(series, 'prep.paise');
  const prepCount = metricOf(series, 'prep.count');
  const prepUnpriced = (() => {
    const m = metricOf(series, 'prep.unpriced_calls');
    return m ? (sumOf(seriesFor(m)) ?? 0) : 0;
  })();
  const floor = floorWord(unpricedCalls);

  return (
    <div className='space-y-6'>
      <MoneyTiles />
      <ChartGrid>
        {collected && outstanding && overdue && (
          <LinesCard
            title="Collected, and owed at each day's end"
            description='Counted payments by the day the money was received; outstanding and overdue as they stood at the end of each India day.'
            unit='paise'
            lines={[
              { label: 'Collected', points: seriesFor(collected) },
              { label: 'Outstanding', points: seriesFor(outstanding), asLine: true },
              { label: 'Overdue', points: seriesFor(overdue), asLine: true },
            ]}
          />
        )}
        {spend && (
          <MetricCard
            metric={spend}
            title='AI spend by relay'
            description={
              floor
                ? `At least these amounts: ${unpricedCalls} call${unpricedCalls === 1 ? '' : 's'} in the window have no price yet.`
                : 'Every call in the window has a price.'
            }
            kind='stacked'
            lines={dimsOf(spend, 'relay:').map((r) => ({ dim: `relay:${r}`, label: r }))}
          />
        )}
        {prepPaise && prepCount && (
          <LinesCard
            title='Cost per prepared class'
            description='Live spend with a preparation id, over the classes prepared that day.'
            unit='paise'
            lines={[
              {
                label: 'Per class',
                points: ratioSeries(seriesFor(prepPaise), seriesFor(prepCount), (p, n) => (n > 0 ? Math.round(p / n) : null)),
              },
            ]}
            footer={(() => {
              const p = sumOf(seriesFor(prepPaise));
              const n = sumOf(seriesFor(prepCount));
              if (p === null || n === null || n === 0) return 'No class was prepared in this window.';
              return `Over the window: ${floorWord(prepUnpriced)}${formatPaise(Math.round(p / n))} a class, ${n} prepared.`;
            })()}
          />
        )}
      </ChartGrid>
      <LoadView view={view} reload={reload} skeletons={2}>
        {(money) => <MoneyTables series={series} money={money} floor={floor} />}
      </LoadView>
    </div>
  );
}

function MoneyTables({ series, money, floor }: { series: ChartSeries; money: MoneyView; floor: string }) {
  const spend = metricOf(series, 'spend.paise');
  const bySchoolMetric = metricOf(series, 'spend.school_paise');
  const models = spend
    ? dimsOf(spend, 'model:')
        .map((name) => ({ name, paise: sumOf(seriesFor(spend, { dim: `model:${name}` })) ?? 0 }))
        .sort((a, b) => b.paise - a.paise)
    : [];
  const bySchool = new Map<string, number>();
  for (const p of bySchoolMetric?.points ?? []) {
    if (p.school && p.value !== null) bySchool.set(p.school, (bySchool.get(p.school) ?? 0) + p.value);
  }
  const topSchools = [...bySchool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return (
    <div className='space-y-4'>
      <ChartGrid>
        <ChartCard title='AI spend by model' description={`The window's total per model${floor ? ', at least' : ''}.`}>
          {models.length === 0 ? (
            <p className='px-4 text-sm text-muted-foreground'>No figure for this window yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className='text-right'>Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((m) => (
                  <TableRow key={m.name}>
                    <TableCell className='font-mono text-xs'>{m.name === 'none' ? 'No model named' : m.name}</TableCell>
                    <TableCell className='text-right tabular-nums'>{formatPaise(m.paise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ChartCard>
        <ChartCard title='AI spend by school' description="The window's ten highest, and the children who came on their own.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>School</TableHead>
                <TableHead className='text-right'>Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topSchools.map(([code, paise]) => (
                <TableRow key={code}>
                  <TableCell className='font-mono text-xs'>{code}</TableCell>
                  <TableCell className='text-right tabular-nums'>{formatPaise(paise)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>Children who came on their own</TableCell>
                <TableCell className='text-right tabular-nums'>{formatPaise(money.directCostPaise)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </ChartCard>
      </ChartGrid>
      <ChartCard title='Renewals ahead' description='Licences other than pilots ending in each of the next 13 weeks, at the latest subscription’s seats and seat price.'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week starting</TableHead>
              <TableHead className='text-right'>Schools</TableHead>
              <TableHead className='text-right'>At the current price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {money.renewals.map((w) => (
              <TableRow key={w.weekStart}>
                <TableCell>{w.weekStart}</TableCell>
                <TableCell className='text-right tabular-nums'>{w.schools}</TableCell>
                <TableCell className='text-right tabular-nums'>{w.schools === 0 ? '—' : formatPaise(w.paiseAtCurrentPrice)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ChartCard>
      <ChartCard
        title='Margin per school'
        description={`${money.from} to ${money.to}: the invoiced fee (before GST) spread over its subscription's days, less the school's AI spend. AI spend only: hosting, storage, messages and people are not counted.`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>School</TableHead>
              <TableHead className='text-right'>Fee</TableHead>
              <TableHead className='text-right'>AI spend</TableHead>
              <TableHead className='text-right'>Margin</TableHead>
              <TableHead className='text-right'>Days rolled up</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {money.margin.map((m) => (
              <TableRow key={m.code}>
                <TableCell>
                  <span className='font-mono text-xs'>{m.code}</span> {m.name}
                </TableCell>
                <TableCell className='text-right tabular-nums'>{m.noFee ? 'No fee (pilot or none)' : formatPaise(m.feePaise)}</TableCell>
                <TableCell className='text-right tabular-nums'>
                  {m.costIsFloor ? 'at least ' : ''}
                  {formatPaise(m.costPaise)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${m.marginPaise < 0 ? 'text-red-600' : ''}`}>
                  {m.costIsFloor ? 'at most ' : ''}
                  {formatPaise(m.marginPaise)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>{m.daysRolledUp}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ChartCard>
    </div>
  );
}
