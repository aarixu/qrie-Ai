import type { ChartSeries } from '@ai-tutor/admin-client';
import { Activity, Gauge, MessageSquareWarning } from 'lucide-react';
import { admin } from '@/lib/client';
import { useLoad } from '@/lib/use-load';
import { Kpi } from '@/components/charts/kpi';
import { LoadView } from '@/components/load-view';
import { KIND_LABEL, STATUS_LABEL } from '../safety/model';
import { ChartGrid, ChartsFrame, LinesCard, MetricCard, metricOf, TileRow } from './frame';
import {
  floorWord,
  formatValue,
  perStudentHourPaise,
  ratioSeries,
  seriesFor,
  sumOf,
  TARGET_PAISE_PER_HOUR,
  unpricedShare,
  utcNote,
} from './model';

/** Learners, minutes, classes, spend against the ceiling, Rs per student-hour and reports, over 7 or 30 days. */
export function ChartsOverview() {
  return <ChartsFrame page='overview' title='Charts: Overview'>{({ series }) => <OverviewBody series={series} />}</ChartsFrame>;
}

function OverviewTiles() {
  const { view, reload } = useLoad(() => admin.today(), []);
  return (
    <LoadView view={view} reload={reload} skeletons={1}>
      {(t) => (
        <TileRow>
          <Kpi label='Students now' value={formatValue('count', t.relay.studentsNow)} hint='In the last 10 minutes.' icon={Activity} />
          <Kpi
            label='Units today'
            value={`${formatValue('units', t.relay.unitsToday)} of ${formatValue('units', t.relay.ceilingUnits)}`}
            hint='The meter, by UTC day.'
            icon={Gauge}
          />
          <Kpi
            label='Unread reports'
            value={formatValue('count', t.reports.newCount)}
            hint={t.reports.unsafeNew > 0 ? `${t.reports.unsafeNew} marked unsafe.` : 'None marked unsafe.'}
            tone={t.reports.unsafeNew > 0 ? 'bad' : undefined}
            icon={MessageSquareWarning}
            colour={t.reports.unsafeNew > 0 ? 'var(--destructive)' : undefined}
          />
        </TileRow>
      )}
    </LoadView>
  );
}

function OverviewBody({ series }: { series: ChartSeries }) {
  const units = metricOf(series, 'relay.units');
  const ceiling = metricOf(series, 'relay.ceiling');
  const paise = metricOf(series, 'cost.sitting_paise');
  const ms = metricOf(series, 'cost.active_ms');
  const calls = metricOf(series, 'cost.sitting_calls');
  const unpriced = metricOf(series, 'cost.sitting_unpriced_calls');

  const paiseDays = paise ? seriesFor(paise) : [];
  const msDays = ms ? seriesFor(ms) : [];
  const unpricedCalls = unpriced ? (sumOf(seriesFor(unpriced)) ?? 0) : 0;
  const allCalls = calls ? (sumOf(seriesFor(calls)) ?? 0) : 0;
  const windowRate = perStudentHourPaise(sumOf(paiseDays) ?? 0, sumOf(msDays) ?? 0);
  const share = unpricedShare(unpricedCalls, allCalls);
  const floor = floorWord(unpricedCalls);

  return (
    <div className='space-y-6'>
      <OverviewTiles />
      <ChartGrid>
        <MetricCard
          metric={metricOf(series, 'tutor.learners')}
          title='Learners per day'
          description='Anyone with a sitting or an answer the server received that India day, once.'
          kind='stacked'
          lines={[
            { dim: 'school', label: 'At a school' },
            { dim: 'direct', label: 'On their own' },
          ]}
        />
        <MetricCard
          metric={metricOf(series, 'tutor.minutes')}
          title='Minutes on task'
          description='Closed sittings with measured time, by the day the server received them.'
        />
        <MetricCard metric={metricOf(series, 'tutor.classes')} title='Classes served' />
        {units && ceiling && (
          <LinesCard
            title='Spend against the ceiling'
            description={`Meter units used each day, and the ceiling in force when the day ended. ${utcNote(units) ?? ''}`}
            unit='units'
            lines={[
              { label: 'Units used', points: seriesFor(units) },
              { label: 'Ceiling', points: seriesFor(ceiling), asLine: true },
            ]}
          />
        )}
        <LinesCard
          title='Rs per student-hour'
          description='Spend of closed sittings over their time on task, per day (the Rs 5 target is the line).'
          kind='line'
          unit='paise'
          reference={{ value: TARGET_PAISE_PER_HOUR, label: 'Rs 5 target' }}
          lines={[{ label: 'Per student-hour', points: ratioSeries(paiseDays, msDays, perStudentHourPaise) }]}
          footer={
            windowRate === null ? (
              'No time on task was measured in this window.'
            ) : (
              <>
                Over the window: {floor}
                {formatValue('paise', windowRate)} an hour.{' '}
                {share !== null && share > 0
                  ? `${unpricedCalls} of ${allCalls} calls (${Math.round(share * 100)}%) have no price yet, so this is a floor.`
                  : 'Every call has a price.'}
              </>
            )
          }
        />
        <MetricCard
          metric={metricOf(series, 'reports.open')}
          title="Open reports at each day's end"
          kind='stacked'
          lines={(['new', 'seen', 'triaged'] as const).map((d) => ({ dim: d, label: STATUS_LABEL[d] }))}
        />
        <MetricCard
          metric={metricOf(series, 'reports.new')}
          title='New reports by kind'
          kind='stacked'
          lines={(['wrong', 'rude', 'unsafe', 'other'] as const).map((d) => ({ dim: d, label: KIND_LABEL[d] }))}
        />
      </ChartGrid>
    </div>
  );
}
