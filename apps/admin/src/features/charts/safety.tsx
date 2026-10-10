import type { ChartSeries } from '@ai-tutor/admin-client';
import { Clock, HeartPulse, Inbox, ListChecks } from 'lucide-react';
import { safety } from '@/lib/client';
import { useLoad } from '@/lib/use-load';
import { Kpi } from '@/components/charts/kpi';
import { LoadView } from '@/components/load-view';
import { ageText, captureText, KIND_LABEL, STATUS_LABEL } from '../safety/model';
import { ChartGrid, ChartsFrame, MetricCard, metricOf, TileRow } from './frame';
import { seriesFor, sumOf } from './model';

/** Reports over time, the time to the first look, and distress flags from the day capture went live. */
export function ChartsSafety() {
  return <ChartsFrame page='safety' title='Charts: Safety'>{({ series }) => <SafetyBody series={series} />}</ChartsFrame>;
}

function SafetyTiles() {
  const { view, reload } = useLoad(() => safety.overview(), []);
  return (
    <LoadView view={view} reload={reload} skeletons={1}>
      {(o) => {
        const capture = captureText(o.capture);
        return (
          <TileRow>
            <Kpi
              label='Unread by age'
              value={o.counts.unread}
              hint={`Under an hour ${o.unreadAges.underHour}, under a day ${o.unreadAges.underDay}, under a week ${o.unreadAges.underWeek}, older ${o.unreadAges.older}.`}
              tone={o.unreadAges.older + o.unreadAges.underWeek > 0 ? 'bad' : undefined}
              icon={Inbox}
            />
            <Kpi
              label='By status'
              value={`${o.counts.read} read, ${o.counts.triaged} triaged`}
              hint={`${o.counts.closed} closed.`}
              icon={ListChecks}
            />
            <Kpi
              label='First look, 30 days'
              value={o.firstLook.medianMinutes === null ? '—' : ageText(o.firstLook.medianMinutes)}
              hint={
                o.firstLook.maxMinutes === null
                  ? 'No report was looked at in 30 days.'
                  : `Median; the slowest took ${ageText(o.firstLook.maxMinutes)}. ${o.firstLook.looked30d} of ${o.firstLook.reports30d} looked at.`
              }
              icon={Clock}
            />
            <Kpi
              label='Distress flags'
              value={capture.text}
              icon={HeartPulse}
              colour={capture.tone === 'grey' ? 'var(--muted-foreground)' : undefined}
            />
          </TileRow>
        );
      }}
    </LoadView>
  );
}

function SafetyBody({ series }: { series: ChartSeries }) {
  const flags = metricOf(series, 'safety.flags');
  const looked = metricOf(series, 'reports.looked');
  const flagDays = flags ? seriesFor(flags) : [];
  const capturedDays = flagDays.filter((d) => d.state !== 'not-captured').length;
  const lookedTotal = looked ? sumOf(seriesFor(looked)) : null;

  return (
    <div className='space-y-6'>
      <SafetyTiles />
      <ChartGrid>
        <MetricCard
          metric={metricOf(series, 'reports.open')}
          title="Open reports at each day's end, by status"
          description='Rebuilt from when each report was first looked at, triaged and closed.'
          kind='stacked'
          lines={(['new', 'seen', 'triaged'] as const).map((d) => ({ dim: d, label: STATUS_LABEL[d] }))}
        />
        <MetricCard
          metric={metricOf(series, 'reports.new')}
          title='New reports by kind'
          kind='stacked'
          lines={(['wrong', 'rude', 'unsafe', 'other'] as const).map((d) => ({ dim: d, label: KIND_LABEL[d] }))}
        />
        <MetricCard
          metric={metricOf(series, 'reports.first_look_median')}
          title='Median minutes to the first look'
          description='Of the reports that arrived each day.'
          kind='line'
          footer={lookedTotal === null ? undefined : `${lookedTotal} report${lookedTotal === 1 ? '' : 's'} in the window were looked at.`}
        />
        <MetricCard
          metric={flags}
          title='Distress flags by direction'
          description='No words, no names: what happened, and whose words matched.'
          kind='stacked'
          lines={[
            { dim: 'from-student', label: "The child's words" },
            { dim: 'to-student', label: "The tutor's line" },
          ]}
          footer={flags?.captured ? `Captured on ${capturedDays} of ${flagDays.length} days.` : undefined}
        />
      </ChartGrid>
    </div>
  );
}
