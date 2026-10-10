import type { ChartSeries, SystemHealth } from '@ai-tutor/admin-client';
import { Activity, BellRing, CreditCard, OctagonX } from 'lucide-react';
import { system } from '@/lib/client';
import { cashfreeLines, jobLine } from '@/lib/system-view';
import { ALARM_STALE_MINUTES } from '@/lib/tiles';
import { useLoad } from '@/lib/use-load';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartCard } from '@/components/charts/chart-card';
import { Kpi } from '@/components/charts/kpi';
import { LoadView } from '@/components/load-view';
import { ChartGrid, ChartsFrame, MetricCard, metricOf, TileRow } from './frame';
import { dimsOf, seriesFor, sumOf } from './model';

/** Calls by outcome, payment notifications, what is not captured, and the system's state now. */
export function ChartsReliability() {
  return <ChartsFrame page='reliability' title='Charts: Reliability'>{({ series }) => <ReliabilityBody series={series} />}</ChartsFrame>;
}

const TONE_TEXT = { ok: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-red-600', grey: 'text-muted-foreground' } as const;

function SystemNow() {
  const { view, reload } = useLoad(() => system.health(), []);
  return (
    <LoadView view={view} reload={reload} skeletons={2}>
      {(h) => <SystemNowBody h={h} />}
    </LoadView>
  );
}

function SystemNowBody({ h }: { h: SystemHealth }) {
  const alarm = h.alarm.lastCheckMinutesAgo;
  const cash = cashfreeLines(h.cashfree);
  return (
    <div className='space-y-4'>
      <TileRow>
        <Kpi
          label='The tutor'
          value={h.relay.halted ? 'Stopped' : 'Running'}
          hint={h.relay.halted ? (h.relay.haltedReason ?? undefined) : undefined}
          tone={h.relay.halted ? 'bad' : 'good'}
          icon={OctagonX}
        />
        <Kpi
          label='Calls, 5 minutes'
          value={`${h.relay.events5m} calls`}
          hint={`${h.relay.failures5m} failed (a 5xx, or no visible outcome).`}
          tone={h.relay.failures5m > 0 ? 'bad' : undefined}
          icon={Activity}
        />
        <Kpi
          label="The alarm's last check"
          value={alarm === null ? 'Never' : `${alarm} min ago`}
          tone={alarm === null || alarm > ALARM_STALE_MINUTES ? 'bad' : undefined}
          hint={`Quiet for more than ${ALARM_STALE_MINUTES} minutes is a missed check.`}
          icon={BellRing}
        />
        <Kpi
          label='Cashfree'
          value={h.cashfree.captured ? `Last notification: ${cash[0]?.text ?? '—'}` : 'Not captured'}
          hint={h.cashfree.captured ? cash.slice(1).map((l) => `${l.label}: ${l.text}`).join('. ') : cash[0]?.text}
          tone={cash.some((l) => l.tone === 'bad') ? 'bad' : undefined}
          colour={h.cashfree.captured ? undefined : 'var(--muted-foreground)'}
          icon={CreditCard}
        />
      </TileRow>
      <ChartCard title='Scheduled jobs' description="Each job's last run, from pg_cron.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Schedule (UTC)</TableHead>
              <TableHead>Last run</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {h.jobs.map((j) => {
              const line = jobLine(j.lastStatus);
              return (
                <TableRow key={j.name}>
                  <TableCell className='font-mono text-xs'>{j.name}</TableCell>
                  <TableCell className='font-mono text-xs'>{j.schedule}</TableCell>
                  <TableCell className={cn(TONE_TEXT[line.tone])}>{line.text}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ChartCard>
    </div>
  );
}

function ReliabilityBody({ series }: { series: ChartSeries }) {
  const calls = metricOf(series, 'calls.outcome');
  const webhooks = metricOf(series, 'webhook.events');
  const all = calls ? sumOf(seriesFor(calls)) : null;
  const server = calls ? sumOf(seriesFor(calls, { dim: 'server' })) : null;
  return (
    <div className='space-y-6'>
      <SystemNow />
      <ChartGrid>
        <MetricCard
          metric={calls}
          title='Calls by outcome'
          description='Answered (2xx and 3xx), refused upstream (4xx), failed upstream (5xx), and no visible outcome.'
          kind='stacked'
          lines={[
            { dim: 'ok', label: 'Answered' },
            { dim: 'client', label: 'Refused upstream' },
            { dim: 'server', label: 'Failed upstream' },
            { dim: 'none', label: 'No visible outcome' },
          ]}
          footer={
            <>
              {all !== null && all > 0 && server !== null
                ? `Failure rate over the window: ${((server * 100) / all).toFixed(1)}% (failed upstream over all calls). `
                : ''}
              Calls with no visible outcome are streams the host carried (0008); the System page&apos;s 5-minute count treats them as failures.
            </>
          }
        />
        {webhooks && (
          <MetricCard
            metric={webhooks}
            title='Payment notifications by result'
            description='Cashfree’s notifications by the India day they arrived.'
            kind='stacked'
            lines={dimsOf(webhooks, '').map((d) => ({ dim: d, label: d.replace(/_/g, ' ') }))}
          />
        )}
        <MetricCard metric={metricOf(series, 'relay.refusals')} />
        <MetricCard metric={metricOf(series, 'calls.latency')} />
        <MetricCard metric={metricOf(series, 'alarm.history')} />
      </ChartGrid>
    </div>
  );
}
