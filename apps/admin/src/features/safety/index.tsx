import type { CaseRow, ReportKind, ReportRow, ReportStatus, SafetyOverview } from '@ai-tutor/admin-client';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { safety } from '@/lib/client';
import { useMe } from '@/lib/me';
import { istTime, istToday } from '@/lib/time';
import { useLoad } from '@/lib/use-load';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import { LoadView } from '@/components/load-view';
import { WriteDialog } from '@/components/write-dialog';
import { formatDay } from '../billing/model.ts';
import { ToneBadge } from '../billing/parts.tsx';
import {
  ageText,
  blastOpenCase,
  captureText,
  KIND_LABEL,
  nextStatuses,
  OUTCOME_LABEL,
  safetyRights,
  STATUS_LABEL,
  type SafetyRights,
} from './model.ts';

/**
 * THE SAFETY PAGE: reports by kind, status and age, never their words; cases;
 * and, for the owner, the read log. A child's words are read only on a case's
 * own page (case-page.tsx), one report at a time. Owner and safety; the
 * database refuses everyone else, and the page then says so.
 */
export function Safety() {
  const rights = safetyRights(useMe().role);
  const overview = useLoad(() => safety.overview(), []);
  const oldest = useLoad(() => safety.reports({ status: 'new', limit: 1 }), []);
  const [status, setStatus] = useState<ReportStatus | 'all'>('all');
  const [kind, setKind] = useState<ReportKind | 'all'>('all');
  const reports = useLoad(
    () => safety.reports({ status: status === 'all' ? undefined : status, kind: kind === 'all' ? undefined : kind }),
    [status, kind],
  );
  const cases = useLoad(() => safety.cases(false), []);
  const [capturing, setCapturing] = useState(false);
  const reloadAll = () => {
    overview.reload();
    oldest.reload();
    reports.reload();
    cases.reload();
  };

  return (
    <AdminPage
      title='Safety'
      actions={
        rights.captureSince && (
          <Button variant='outline' size='sm' onClick={() => setCapturing(true)}>
            Record the day capture went live
          </Button>
        )
      }
    >
      <LoadView view={overview.view} reload={overview.reload} skeletons={2}>
        {(o) => (
          <div className='space-y-4'>
            <Tiles o={o} oldestMinutes={oldest.view.state === 'ready' ? (oldest.view.data.rows[0]?.ageMinutes ?? null) : undefined} />
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Reports</CardTitle>
                <CardDescription>Kind, status and age only. A report&apos;s words are read inside a case.</CardDescription>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='flex flex-wrap gap-2'>
                  <Select value={status} onValueChange={(v) => setStatus(v as ReportStatus | 'all')}>
                    <SelectTrigger className='w-44' aria-label='Status'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Every status</SelectItem>
                      {(Object.keys(STATUS_LABEL) as ReportStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={kind} onValueChange={(v) => setKind(v as ReportKind | 'all')}>
                    <SelectTrigger className='w-44' aria-label='Kind'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Every kind</SelectItem>
                      {(Object.keys(KIND_LABEL) as ReportKind[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {KIND_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <LoadView view={reports.view} reload={reports.reload}>
                  {(r) => <ReportsTable rows={r.rows} more={r.more} rights={rights} onChanged={reloadAll} />}
                </LoadView>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Cases</CardTitle>
                <CardDescription>Open cases first. Each is bound to one report and read only by the person who opened it.</CardDescription>
              </CardHeader>
              <CardContent>
                <LoadView view={cases.view} reload={cases.reload}>
                  {(rows) => <CasesTable rows={rows} />}
                </LoadView>
              </CardContent>
            </Card>
            {rights.readLog && <ReadLog />}
          </div>
        )}
      </LoadView>
      <CaptureSinceDialog open={capturing} onOpenChange={setCapturing} onDone={reloadAll} />
    </AdminPage>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'grey' }) {
  return (
    <div className={cn('rounded-md border p-3', tone === 'bad' && 'border-red-300 dark:border-red-800')}>
      <div className='text-sm text-muted-foreground'>{label}</div>
      <div className={cn('text-lg font-semibold', tone === 'bad' && 'text-red-700 dark:text-red-400', tone === 'grey' && 'text-muted-foreground')}>
        {value}
      </div>
      {sub && <div className='text-xs text-muted-foreground'>{sub}</div>}
    </div>
  );
}

/** `oldestMinutes`: undefined while its read is not ready; null when nothing is unread. */
function Tiles({ o, oldestMinutes }: { o: SafetyOverview; oldestMinutes: number | null | undefined }) {
  const capture = captureText(o.capture);
  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
      <Tile
        label='Unread'
        value={String(o.counts.unread)}
        sub={o.unreadByKind.unsafe > 0 ? `${o.unreadByKind.unsafe} unsafe` : undefined}
        tone={o.unreadByKind.unsafe > 0 ? 'bad' : undefined}
      />
      <Tile
        label='Oldest unread'
        value={oldestMinutes === undefined ? '…' : oldestMinutes === null ? 'None' : ageText(oldestMinutes)}
      />
      <Tile
        label='Time to first look (30 days)'
        value={o.firstLook.medianMinutes === null ? 'None looked at' : `${ageText(o.firstLook.medianMinutes)} median`}
        sub={o.firstLook.maxMinutes === null ? undefined : `slowest ${ageText(o.firstLook.maxMinutes)}`}
      />
      <Tile label='Open cases' value={String(o.cases.open)} sub={`${o.cases.mineOpen} yours`} />
      <Tile
        label='Distress flags'
        value={capture.text}
        sub={o.capture.state === 'captured' ? undefined : 'Capture is not live yet, or no flag has arrived.'}
        tone={capture.tone === 'grey' ? 'grey' : undefined}
      />
      <Tile label='Reads today' value={`${o.quota.readsToday} of ${o.quota.perDay}`} />
    </div>
  );
}

const MARK_LABEL: Record<'seen' | 'triaged' | 'closed', string> = { seen: 'Mark read', triaged: 'Mark triaged', closed: 'Close' };

function ReportsTable({ rows, more, rights, onChanged }: { rows: ReportRow[]; more: boolean; rights: SafetyRights; onChanged(): void }) {
  const navigate = useNavigate();
  const [marking, setMarking] = useState<{ report: ReportRow; to: 'seen' | 'triaged' | 'closed' } | null>(null);
  const [opening, setOpening] = useState<ReportRow | null>(null);
  if (rows.length === 0) return <p className='text-sm text-muted-foreground'>No reports yet.</p>;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kind</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Received</TableHead>
            <TableHead>Age</TableHead>
            <TableHead>First look</TableHead>
            <TableHead>School</TableHead>
            <TableHead>Lesson</TableHead>
            <TableHead>Case</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                {r.kind === 'unsafe' ? <ToneBadge tone='bad'>{KIND_LABEL[r.kind]}</ToneBadge> : KIND_LABEL[r.kind]}
              </TableCell>
              <TableCell>{STATUS_LABEL[r.status]}</TableCell>
              <TableCell className='whitespace-nowrap'>{istTime(r.receivedAt)}</TableCell>
              <TableCell>{ageText(r.ageMinutes)}</TableCell>
              <TableCell>{r.firstLookMinutes === null ? <span className='text-muted-foreground'>Not yet</span> : ageText(r.firstLookMinutes)}</TableCell>
              <TableCell className='font-mono text-xs'>{r.school?.code ?? 'Direct'}</TableCell>
              <TableCell className='max-w-48 truncate font-mono text-xs'>{r.lessonId}</TableCell>
              <TableCell>
                {r.openCaseId ? (
                  <Link to='/safety/cases/$caseId' params={{ caseId: r.openCaseId }} className='underline'>
                    Open case
                  </Link>
                ) : (
                  <span className='text-muted-foreground'>None</span>
                )}
              </TableCell>
              <TableCell>
                <div className='flex flex-wrap justify-end gap-1'>
                  {rights.mark &&
                    !r.openCaseId &&
                    nextStatuses(r.status).map((to) => (
                      <Button key={to} size='sm' variant='ghost' onClick={() => setMarking({ report: r, to })}>
                        {MARK_LABEL[to]}
                      </Button>
                    ))}
                  {rights.openCase && !r.openCaseId && r.status !== 'closed' && (
                    <Button size='sm' variant='outline' onClick={() => setOpening(r)}>
                      Open case
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {more && <p className='mt-2 text-xs text-muted-foreground'>More reports match; narrow the filters to see them.</p>}
      <WriteDialog
        open={marking !== null}
        onOpenChange={(o) => !o && setMarking(null)}
        title={marking ? MARK_LABEL[marking.to] : ''}
        blast={marking ? `This report is marked ${STATUS_LABEL[marking.to]}. Marking does not open its words, and a report only moves forward.` : ''}
        confirmLabel={marking ? MARK_LABEL[marking.to] : ''}
        onConfirm={async (w) => {
          if (marking) await safety.mark({ reportId: marking.report.id, status: marking.to, ...w });
        }}
        onDone={onChanged}
      />
      <WriteDialog
        open={opening !== null}
        onOpenChange={(o) => !o && setOpening(null)}
        title='Open a case'
        blast={blastOpenCase()}
        guarded
        confirmLabel='Open the case'
        onConfirm={async (w) => {
          if (!opening) return;
          const { caseId } = await safety.openCase({ reportId: opening.id, ...w });
          void navigate({ to: '/safety/cases/$caseId', params: { caseId } });
        }}
        onDone={onChanged}
      />
    </>
  );
}

function CasesTable({ rows }: { rows: CaseRow[] }) {
  const navigate = useNavigate();
  if (rows.length === 0) return <p className='text-sm text-muted-foreground'>No cases yet.</p>;
  const sorted = [...rows].sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kind</TableHead>
          <TableHead>School</TableHead>
          <TableHead>Opened by</TableHead>
          <TableHead>Opened</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Outcome</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((c) => (
          <TableRow key={c.id} className='cursor-pointer' onClick={() => void navigate({ to: '/safety/cases/$caseId', params: { caseId: c.id } })}>
            <TableCell>{c.kind ? KIND_LABEL[c.kind] : 'Report gone'}</TableCell>
            <TableCell className='font-mono text-xs'>{c.school?.code ?? 'Direct'}</TableCell>
            <TableCell>{c.openedByName}</TableCell>
            <TableCell className='whitespace-nowrap'>{istTime(c.openedAt)}</TableCell>
            <TableCell>{c.status === 'open' ? <ToneBadge tone='warn'>Open</ToneBadge> : 'Closed'}</TableCell>
            <TableCell>{c.outcome ? OUTCOME_LABEL[c.outcome] : <span className='text-muted-foreground'>None yet</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReadLog() {
  const log = useLoad(() => safety.readLog(), []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Read log</CardTitle>
        <CardDescription>Every time someone read a report&apos;s words or its context, with their reason. It cannot be changed.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoadView view={log.view} reload={log.reload}>
          {(rows) =>
            rows.length === 0 ? (
              <p className='text-sm text-muted-foreground'>Nobody has read a report yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Case</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.at}-${i}`}>
                      <TableCell className='whitespace-nowrap'>{istTime(r.at)}</TableCell>
                      <TableCell>{r.staffName}</TableCell>
                      <TableCell>{r.staffRole}</TableCell>
                      <TableCell>
                        <Link to='/safety/cases/$caseId' params={{ caseId: r.caseId }} className='font-mono text-xs underline'>
                          {r.caseId.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell>{r.what === 'report' ? 'The report' : 'Its context'}</TableCell>
                      <TableCell className='max-w-72'>{r.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </LoadView>
      </CardContent>
    </Card>
  );
}

function CaptureSinceDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange(o: boolean): void; onDone(): void }) {
  const [on, setOn] = useState(istToday());
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Record the day capture went live'
      blast={`Distress capture is recorded as live from ${formatDay(on)}. The Distress flags tile then shows counts, zero included, instead of "Not captured".`}
      confirmLabel='Record'
      canConfirm={/^\d{4}-\d{2}-\d{2}$/.test(on)}
      onConfirm={(w) => safety.setCaptureSince({ on, ...w })}
      onDone={onDone}
    >
      <div className='space-y-1'>
        <Label htmlFor='capture-on'>The day capture went live</Label>
        <Input id='capture-on' type='date' value={on} max={istToday()} onChange={(e) => setOn(e.target.value)} />
      </div>
    </WriteDialog>
  );
}
