import type { RelayStatus, SystemHealth } from '@ai-tutor/admin-client';
import { useEffect, useState, type ReactNode } from 'react';
import { blastRestoreDrill } from '@/lib/blast';
import { admin, system } from '@/lib/client';
import { useMe } from '@/lib/me';
import { canOperate, isOwner } from '@/lib/roles';
import {
  AUDIT_COPY_STALE_MINUTES,
  cashfreeLines,
  chainLine,
  checkedLine,
  drillLine,
  jobLine,
  migrationLine,
  tokenMissLine,
  type Line,
} from '@/lib/system-view';
import { ALARM_STALE_MINUTES, type Tone } from '@/lib/tiles';
import { addDays, istTime, istToday } from '@/lib/time';
import { useLoad } from '@/lib/use-load';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import { LoadView } from '@/components/load-view';
import { StopControl } from '@/components/stop-control';
import { WriteDialog } from '@/components/write-dialog';
import { CeilingDialog } from './ceiling';

const TEXT: Record<Tone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  grey: 'text-muted-foreground',
};

const Said = ({ line }: { line: Line }) => <span className={TEXT[line.tone]}>{line.text}</span>;

/**
 * The platform's own health (admin.system_health) and the tutor's switch and
 * ceiling (admin.relay_status), two reads that stand apart as on Today: the
 * stop button and the ceiling appear even when the other read fails. Owner,
 * ops and safety see it (finance's stop is in the header, HeaderStop); the
 * ceiling is the owner's, a restore drill is recorded by owner or ops. Wrong
 * tokens are the guesses at the alarm's token counted in the last hour (0075).
 */
export function System() {
  const health = useLoad(() => system.health(), []);
  const relay = useLoad(() => admin.relayStatus(), []);
  const refresh = () => {
    health.reload();
    relay.reload();
  };
  return (
    <AdminPage
      title='System'
      actions={
        <div className='flex gap-2'>
          <Button variant='outline' onClick={refresh}>
            Refresh
          </Button>
          {relay.view.state === 'ready' && <StopControl status={relay.view.data} onChanged={refresh} />}
        </div>
      }
    >
      <div className='grid gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Daily ceiling</CardTitle>
            <CardDescription>Meter units, not rupees. The UTC day.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoadView view={relay.view} reload={relay.reload} skeletons={1}>
              {(r) => <Ceiling status={r} onChanged={refresh} />}
            </LoadView>
          </CardContent>
        </Card>
        <LoadView view={health.view} reload={health.reload} skeletons={4}>
          {(h) => <HealthCards h={h} onChanged={health.reload} />}
        </LoadView>
      </div>
    </AdminPage>
  );
}

function Ceiling({ status, onChanged }: { status: RelayStatus; onChanged(): void }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const share = status.ceilingUnits > 0 ? Math.round((status.unitsToday / status.ceilingUnits) * 100) : 0;
  return (
    <div className='space-y-3 text-sm'>
      <p>
        <span className='text-2xl font-semibold'>{status.ceilingUnits.toLocaleString('en-IN')}</span> units a day
      </p>
      <p className={cn(share >= 100 ? TEXT.bad : share >= 80 ? TEXT.warn : 'text-muted-foreground')}>
        {status.unitsToday.toLocaleString('en-IN')} used today ({share}%), UTC day {status.utcDay}.
      </p>
      {status.capOverride && (
        <p className='text-muted-foreground'>
          A raise is in force: it goes back to {status.capOverride.previousUnits.toLocaleString('en-IN')} units on{' '}
          {status.capOverride.revertOn} (UTC).
        </p>
      )}
      {isOwner(me.role) && (
        <>
          <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
            Change the ceiling
          </Button>
          <CeilingDialog status={status} open={open} onOpenChange={setOpen} onDone={onChanged} />
        </>
      )}
    </div>
  );
}

function Part({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className='text-sm'>{children}</CardContent>
    </Card>
  );
}

function HealthCards({ h, onChanged }: { h: SystemHealth; onChanged(): void }) {
  const me = useMe();
  const [drill, setDrill] = useState(false);
  return (
    <>
      <Part title='Relay' description='The tutor’s server, the last 5 minutes.'>
        <p className={h.relay.halted ? TEXT.bad : TEXT.ok}>
          {h.relay.halted ? `Stopped${h.relay.haltedReason ? `: ${h.relay.haltedReason}` : ''}` : 'Running'}
        </p>
        <p className='text-muted-foreground'>
          {h.relay.events5m} events, <span className={h.relay.failures5m > 0 ? TEXT.warn : undefined}>{h.relay.failures5m} failed</span>.
        </p>
      </Part>
      <Part title='Outside checkers' description='They watch from outside this project; if one goes quiet, nothing else says so.'>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
          <dt className='text-muted-foreground'>Alarm</dt>
          <dd>
            <Said line={checkedLine(h.alarm.lastCheckMinutesAgo, ALARM_STALE_MINUTES)} />
          </dd>
          <dt className='text-muted-foreground'>Wrong tokens</dt>
          <dd>
            <Said line={tokenMissLine(h.alarm.tokenMisses1h)} />
          </dd>
          <dt className='text-muted-foreground'>Audit copy</dt>
          <dd>
            <Said line={checkedLine(h.auditCopy.lastCheckMinutesAgo, AUDIT_COPY_STALE_MINUTES)} />
          </dd>
        </dl>
      </Part>
      <Part title='Audit log' description='Each entry is chained to the one before it by its hash.'>
        <Said line={chainLine(h.auditChain)} />
      </Part>
      <Part title='Migrations' description='The newest database change applied.'>
        <Said line={migrationLine(h.migrations.level)} />
      </Part>
      <Part title='Cashfree'>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
          {cashfreeLines(h.cashfree).map((l) => (
            <div key={l.label} className='contents'>
              <dt className='text-muted-foreground'>{l.label}</dt>
              <dd>
                <Said line={l} />
              </dd>
            </div>
          ))}
        </dl>
      </Part>
      <Part title='Restore drill' description='The last day a backup was restored into a scratch project and checked.'>
        <div className='flex flex-wrap items-center gap-3'>
          <Said line={drillLine(h.restoreDrill)} />
          {canOperate(me.role) && (
            <Button variant='outline' size='sm' onClick={() => setDrill(true)}>
              Record a restore drill
            </Button>
          )}
        </div>
        <RestoreDrill open={drill} onOpenChange={setDrill} onDone={onChanged} />
      </Part>
      <Card className='lg:col-span-2'>
        <CardHeader>
          <CardTitle className='text-base'>Scheduled jobs</CardTitle>
          <CardDescription>The last run of each; times are India&apos;s.</CardDescription>
        </CardHeader>
        <CardContent className='px-0'>
          {h.jobs.length === 0 ? (
            <p className='px-6 text-sm text-muted-foreground'>No scheduled jobs.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Last result</TableHead>
                  <TableHead>Last start</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {h.jobs.map((j) => (
                  <TableRow key={j.name}>
                    <TableCell className='font-mono text-xs'>{j.name}</TableCell>
                    <TableCell className='font-mono text-xs'>{j.schedule}</TableCell>
                    <TableCell>{j.active ? 'Yes' : <Badge variant='secondary'>No</Badge>}</TableCell>
                    <TableCell>
                      <Said line={jobLine(j.lastStatus)} />
                    </TableCell>
                    <TableCell className='whitespace-nowrap'>{j.lastStartedAt ? istTime(j.lastStartedAt) : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className='text-xs text-muted-foreground lg:col-span-2'>
        {h.environment}; read {istTime(h.generatedAt)}.
      </p>
    </>
  );
}

/** The day a restore drill was done (admin.restore_drill_set; owner and ops): within the last year, not in the future. */
function RestoreDrill({ open, onOpenChange, onDone }: { open: boolean; onOpenChange(open: boolean): void; onDone(): void }) {
  const today = istToday();
  const [on, setOn] = useState(today);
  useEffect(() => {
    if (open) setOn(istToday());
  }, [open]);
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(on) && on <= today && on >= addDays(today, -365);
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Record a restore drill'
      blast={blastRestoreDrill(on || 'DATE')}
      confirmLabel='Record it'
      canConfirm={ready}
      onConfirm={(w) => system.setRestoreDrill({ on, ...w })}
      onDone={onDone}
    >
      <div className='space-y-1'>
        <Label htmlFor='drill-on'>The day it was restored and checked</Label>
        <Input id='drill-on' type='date' min={addDays(today, -365)} max={today} value={on} onChange={(e) => setOn(e.target.value)} />
      </div>
    </WriteDialog>
  );
}
