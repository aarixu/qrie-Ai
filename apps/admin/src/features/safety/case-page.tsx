import type { CaseContext, CaseDetail, CaseOutcome, CaseReport } from '@ai-tutor/admin-client';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { safety } from '@/lib/client';
import { failed } from '@/lib/load-state';
import { useMe } from '@/lib/me';
import { istTime } from '@/lib/time';
import { useLoad } from '@/lib/use-load';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import { LoadView } from '@/components/load-view';
import { WriteDialog } from '@/components/write-dialog';
import { ToneBadge } from '../billing/parts.tsx';
import { blastCloseCase, KIND_LABEL, OUTCOME_LABEL, safetyRights, STATUS_LABEL } from './model.ts';
import { ReasonDialog } from './reason-dialog.tsx';

/**
 * ONE CASE. The only screen that shows a child's words: each press of "Read
 * the report" asks the database once (admin.case_report), which logs the
 * reading and counts it against the day's quota before it answers. The words
 * live only in this page's state, so they are gone when the page is left.
 */
export function CasePage() {
  const { caseId } = useParams({ from: '/safety/cases/$caseId' });
  const rights = safetyRights(useMe().role);
  const detail = useLoad(() => safety.caseDetail(caseId), [caseId]);
  const [report, setReport] = useState<CaseReport | null>(null);
  const [context, setContext] = useState<CaseContext | null>(null);
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [closing, setClosing] = useState(false);

  async function readReport() {
    setReading(true);
    setReadError('');
    try {
      setReport(await safety.caseReport(caseId));
      detail.reload();
    } catch (e) {
      const f = failed(e);
      setReadError(f.state === 'error' ? f.message : 'Your role cannot see this.');
    } finally {
      setReading(false);
    }
  }

  return (
    <AdminPage title='Case'>
      <div className='mb-4'>
        <Link to='/safety' className='text-sm underline'>
          Back to Safety
        </Link>
      </div>
      <LoadView view={detail.view} reload={detail.reload}>
        {(c) => (
          <div className='space-y-4'>
            <CaseCard c={c} />
            {c.status === 'open' && rights.openCase && (
              <div className='flex flex-wrap gap-2'>
                <Button onClick={() => void readReport()} disabled={reading}>
                  {reading ? 'Reading…' : 'Read the report'}
                </Button>
                <Button variant='outline' onClick={() => setAsking(true)}>
                  Look at the context
                </Button>
                {rights.closeCase && (
                  <Button variant='outline' onClick={() => setClosing(true)}>
                    Close the case
                  </Button>
                )}
              </div>
            )}
            {readError && (
              <Alert variant='destructive'>
                <AlertDescription>{readError}</AlertDescription>
              </Alert>
            )}
            {report && <Words r={report} />}
            {context && <Context x={context} />}
            <Reads c={c} />
            <ReasonDialog
              open={asking}
              onOpenChange={setAsking}
              title='Look at the context'
              description="The report's class, its sitting's times and how many reports the same lesson has. The reading is recorded with your reason and counts against today's 30 reads."
              confirmLabel='Look'
              onConfirm={async (reason) => {
                setContext(await safety.caseContext(caseId, reason));
                detail.reload();
              }}
            />
            <CloseDialog
              open={closing}
              onOpenChange={setClosing}
              caseId={caseId}
              schoolCode={c.school?.code ?? null}
              onDone={() => {
                setReport(null);
                setContext(null);
                detail.reload();
              }}
            />
          </div>
        )}
      </LoadView>
    </AdminPage>
  );
}

function CaseCard({ c }: { c: CaseDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
          {c.kind ? KIND_LABEL[c.kind] : 'Report gone'} report
          {c.status === 'open' ? <ToneBadge tone='warn'>Open</ToneBadge> : <ToneBadge tone='grey'>Closed</ToneBadge>}
        </CardTitle>
        <CardDescription>
          {c.school ? `${c.school.code}, ${c.school.name}` : 'A child who came on their own'} · report{' '}
          {c.reportStatus ? STATUS_LABEL[c.reportStatus].toLowerCase() : 'gone'}
          {c.receivedAt ? ` · received ${istTime(c.receivedAt)}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className='grid gap-2 text-sm sm:grid-cols-2'>
          <div>
            <dt className='text-muted-foreground'>Opened by</dt>
            <dd>
              {c.openedByName}, {istTime(c.openedAt)}
            </dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Why it was opened</dt>
            <dd>{c.reason}</dd>
          </div>
          {c.status === 'closed' && (
            <>
              <div>
                <dt className='text-muted-foreground'>Closed by</dt>
                <dd>
                  {c.closedByName ?? 'Unknown'}
                  {c.closedAt ? `, ${istTime(c.closedAt)}` : ''}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Outcome</dt>
                <dd>
                  {c.outcome ? OUTCOME_LABEL[c.outcome] : 'None'}
                  {c.closeReason ? `: ${c.closeReason}` : ''}
                </dd>
              </div>
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

function Words({ r }: { r: CaseReport }) {
  const x = r.report;
  return (
    <Card className='border-2 border-amber-400 dark:border-amber-700'>
      <CardHeader>
        <CardTitle className='text-base'>The child&apos;s words</CardTitle>
        <CardDescription>
          This reading was recorded. {r.readsLeftToday} {r.readsLeftToday === 1 ? 'read' : 'reads'} left today.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <blockquote className='whitespace-pre-wrap rounded-md border p-3'>{x.note || <span className='text-muted-foreground'>The child wrote nothing.</span>}</blockquote>
        <dl className='grid gap-2 sm:grid-cols-2'>
          <Item label="The tutor's line" value={x.spokenLine} />
          <Item label='Lesson' value={x.lessonId} />
          <Item label='Topic' value={x.topicRef} />
          <Item label='Beat' value={x.beatId} />
          <Item label='Platform' value={x.platform} />
          <Item label='Build' value={x.release} />
          <Item label='Sent' value={istTime(x.at)} />
          <Item label='Received' value={istTime(x.receivedAt)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='break-words'>{value ?? <span className='text-muted-foreground'>None</span>}</dd>
    </div>
  );
}

function Context({ x }: { x: CaseContext }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Context</CardTitle>
        <CardDescription>
          This reading was recorded. {x.readsLeftToday} {x.readsLeftToday === 1 ? 'read' : 'reads'} left today.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className='grid gap-2 text-sm sm:grid-cols-2'>
          <Item label='Class' value={x.class ? `${x.class.title} (${x.class.status}, version ${x.class.version})` : null} />
          <Item
            label='Sitting'
            value={
              x.sitting
                ? `${x.sitting.source}, from ${istTime(x.sitting.startedAt)}${x.sitting.endedAt ? ` to ${istTime(x.sitting.endedAt)}` : ''}` +
                  (x.sitting.activeMinutes === null ? '' : `, ${x.sitting.activeMinutes} min active`)
                : null
            }
          />
          <Item label='Reports on the same lesson' value={`${x.sameLesson.reports}, ${x.sameLesson.unsafe} unsafe`} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Reads({ c }: { c: CaseDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Readings of this case</CardTitle>
      </CardHeader>
      <CardContent>
        {c.reads.length === 0 ? (
          <p className='text-sm text-muted-foreground'>Nobody has read it yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.reads.map((r, i) => (
                <TableRow key={`${r.at}-${i}`}>
                  <TableCell className='whitespace-nowrap'>{istTime(r.at)}</TableCell>
                  <TableCell>{r.staffName}</TableCell>
                  <TableCell>{r.what === 'report' ? 'The report' : 'Its context'}</TableCell>
                  <TableCell>{r.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CloseDialog({
  open,
  onOpenChange,
  caseId,
  schoolCode,
  onDone,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  caseId: string;
  schoolCode: string | null;
  onDone(): void;
}) {
  const [outcome, setOutcome] = useState<CaseOutcome>('no-action');
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Close the case'
      blast={blastCloseCase(outcome, schoolCode)}
      confirmLabel='Close the case'
      onConfirm={(w) => safety.closeCase({ caseId, outcome, ...w })}
      onDone={onDone}
    >
      <div className='space-y-1'>
        <Label>Outcome</Label>
        <Select value={outcome} onValueChange={(v) => setOutcome(v as CaseOutcome)}>
          <SelectTrigger className='w-full' aria-label='Outcome'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(OUTCOME_LABEL) as CaseOutcome[]).map((o) => (
              <SelectItem key={o} value={o}>
                {OUTCOME_LABEL[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {outcome === 'disclosed' && (
          <p className='text-xs text-muted-foreground'>
            The database accepts this only once the owner has recorded who is told at this school, on the Privacy page.
          </p>
        )}
      </div>
    </WriteDialog>
  );
}
