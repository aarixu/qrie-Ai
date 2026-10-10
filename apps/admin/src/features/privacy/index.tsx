import type { ErasureRow, Fiduciary, Recipient, RetentionTruth, SchoolPrivacyRow } from '@ai-tutor/admin-client';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { privacy } from '@/lib/client';
import { useMe } from '@/lib/me';
import { addDays, istTime, istToday } from '@/lib/time';
import { useLoad } from '@/lib/use-load';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import { LoadView } from '@/components/load-view';
import { WriteDialog } from '@/components/write-dialog';
import { formatDay } from '../billing/model.ts';
import { ToneBadge } from '../billing/parts.tsx';
import {
  blastContestPurge,
  blastSchoolPrivacy,
  dueTone,
  FIDUCIARY_LABEL,
  privacyRights,
  RECIPIENT_LABEL,
  type PrivacyRights,
} from './model.ts';

/**
 * THE PRIVACY PAGE: erasure requests by due day (no names), each school's
 * data-protection decision and whether it blocks adding people, and what is
 * kept, for how long and which job keeps to it. Erasing happens only on a
 * request's own page (request-page.tsx). Owner and ops; the database refuses
 * everyone else, and the page then says so.
 */
export function Privacy() {
  const rights = privacyRights(useMe().role);
  return (
    <AdminPage title='Privacy'>
      <div className='space-y-4'>
        {rights.requests && <Requests rights={rights} />}
        {(rights.requests || rights.retention) && <Schools rights={rights} />}
        {rights.retention && <Kept rights={rights} />}
        {!rights.requests && !rights.retention && <p className='text-sm text-muted-foreground'>Your role cannot see this.</p>}
      </div>
    </AdminPage>
  );
}

export const CHANNEL_LABEL: Record<string, string> = { email: 'Email', phone: 'Phone', letter: 'Letter', school: 'The school', 'in-app': 'In the app' };
export const REQUESTER_LABEL: Record<string, string> = { parent: 'A parent', student: 'The student', school: 'The school', other: 'Someone else' };
export const REQUEST_STATUS_LABEL: Record<ErasureRow['status'], string> = {
  received: 'Received',
  verified: 'Verified',
  erasing: 'Erasing',
  erased: 'Erased',
  refused: 'Refused',
};

function Requests({ rights }: { rights: PrivacyRights }) {
  const navigate = useNavigate();
  const [openOnly, setOpenOnly] = useState(true);
  const list = useLoad(() => privacy.requests(openOnly), [openOnly]);
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-2'>
        <div>
          <CardTitle className='text-base'>Erasure requests</CardTitle>
          <CardDescription>Oldest due first. Names are shown only on a request&apos;s own page.</CardDescription>
        </div>
        <div className='flex items-center gap-3'>
          <Label className='flex items-center gap-2 text-sm'>
            <Switch checked={openOnly} onCheckedChange={setOpenOnly} /> Open only
          </Label>
          {rights.intake && (
            <Button size='sm' variant='outline' onClick={() => setAdding(true)}>
              New request
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <LoadView view={list.view} reload={list.reload}>
          {(rows) =>
            rows.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No erasure requests.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>School</TableHead>
                    <TableHead>Login ID</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.id}
                      className='cursor-pointer'
                      onClick={() => void navigate({ to: '/privacy/requests/$requestId', params: { requestId: r.id } })}
                    >
                      <TableCell className='whitespace-nowrap'>{formatDay(r.receivedOn)}</TableCell>
                      <TableCell className='whitespace-nowrap'>
                        <ToneBadge tone={dueTone(r.daysLeft, r.status)}>
                          {formatDay(r.dueOn)}
                          {r.status === 'erased' || r.status === 'refused' ? '' : r.daysLeft < 0 ? `, ${-r.daysLeft} days late` : `, ${r.daysLeft} days left`}
                        </ToneBadge>
                      </TableCell>
                      <TableCell>{CHANNEL_LABEL[r.channel] ?? r.channel}</TableCell>
                      <TableCell>{REQUESTER_LABEL[r.requester] ?? r.requester}</TableCell>
                      <TableCell className='font-mono text-xs'>{r.reference}</TableCell>
                      <TableCell className='font-mono text-xs'>{r.school?.code ?? 'Direct'}</TableCell>
                      <TableCell className='font-mono text-xs'>{r.loginId ?? ''}</TableCell>
                      <TableCell>{REQUEST_STATUS_LABEL[r.status]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </LoadView>
      </CardContent>
      <IntakeDialog
        open={adding}
        onOpenChange={setAdding}
        onDone={(id) => void navigate({ to: '/privacy/requests/$requestId', params: { requestId: id } })}
      />
    </Card>
  );
}

function IntakeDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange(o: boolean): void; onDone(id: string): void }) {
  const [channel, setChannel] = useState('email');
  const [requester, setRequester] = useState('parent');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(istToday());
  const [subject, setSubject] = useState<'school' | 'direct'>('school');
  const [code, setCode] = useState('');
  const [loginId, setLoginId] = useState('');
  const [userId, setUserId] = useState('');
  const ready =
    reference.trim().length >= 3 &&
    /^\d{4}-\d{2}-\d{2}$/.test(receivedOn) &&
    (subject === 'school' ? code.trim() !== '' && loginId.trim() !== '' : /^[0-9a-f-]{36}$/i.test(userId.trim()));
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Record an erasure request'
      blast='The request is recorded with its reference and the day it was received; it is due 30 days after that day. Nothing is erased until it is verified and the owner erases it.'
      confirmLabel='Record'
      canConfirm={ready}
      onConfirm={async (w) => {
        const { requestId } = await privacy.intake({
          channel,
          requester,
          reference: reference.trim(),
          receivedOn,
          ...(subject === 'school' ? { code: code.trim(), loginId: loginId.trim() } : { userId: userId.trim() }),
          ...w,
        });
        onDone(requestId);
      }}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label>Came by</Label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className='w-full' aria-label='Came by'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CHANNEL_LABEL).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>From</Label>
          <Select value={requester} onValueChange={setRequester}>
            <SelectTrigger className='w-full' aria-label='From'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(REQUESTER_LABEL).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label htmlFor='req-ref'>Reference</Label>
          <Input id='req-ref' value={reference} onChange={(e) => setReference(e.target.value)} placeholder='MAIL 2026/11 #4' />
          <p className='text-xs text-muted-foreground'>Never an email address or a phone number.</p>
        </div>
        <div className='space-y-1'>
          <Label htmlFor='req-on'>Received on</Label>
          <Input
            id='req-on'
            type='date'
            value={receivedOn}
            min={addDays(istToday(), -365)}
            max={istToday()}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
        </div>
        <div className='space-y-1 sm:col-span-2'>
          <Label>Who is to be erased</Label>
          <Select value={subject} onValueChange={(v) => setSubject(v as 'school' | 'direct')}>
            <SelectTrigger className='w-full' aria-label='Who is to be erased'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='school'>A student at a school</SelectItem>
              <SelectItem value='direct'>Someone who came on their own</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {subject === 'school' ? (
          <>
            <div className='space-y-1'>
              <Label htmlFor='req-code'>School code</Label>
              <Input id='req-code' value={code} onChange={(e) => setCode(e.target.value)} className='font-mono' />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='req-login'>Login ID</Label>
              <Input id='req-login' value={loginId} onChange={(e) => setLoginId(e.target.value)} className='font-mono' />
            </div>
          </>
        ) : (
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='req-user'>User ID</Label>
            <Input id='req-user' value={userId} onChange={(e) => setUserId(e.target.value)} className='font-mono' />
          </div>
        )}
      </div>
    </WriteDialog>
  );
}

function Schools({ rights }: { rights: PrivacyRights }) {
  const list = useLoad(() => privacy.schools(), []);
  const [deciding, setDeciding] = useState<SchoolPrivacyRow | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Schools</CardTitle>
        <CardDescription>
          Who is responsible for each school&apos;s children&apos;s data, and who is told if a child may be at risk. On the hosted and
          staging databases, nobody can be added to a school until both are decided.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoadView view={list.view} reload={list.reload}>
          {(rows) =>
            rows.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No schools yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead>Data fiduciary</TableHead>
                    <TableHead>Who is told</TableHead>
                    <TableHead>Based on</TableHead>
                    <TableHead>Decided</TableHead>
                    <TableHead>Adding people</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow key={s.code}>
                      <TableCell>
                        <div className='font-medium'>{s.name}</div>
                        <div className='font-mono text-xs text-muted-foreground'>{s.code}</div>
                      </TableCell>
                      <TableCell>{FIDUCIARY_LABEL[s.fiduciary]}</TableCell>
                      <TableCell>{RECIPIENT_LABEL[s.recipient]}</TableCell>
                      <TableCell className='max-w-56'>{s.basis ?? <span className='text-muted-foreground'>None</span>}</TableCell>
                      <TableCell className='whitespace-nowrap'>
                        {s.decidedAt ? `${s.decidedByName ?? 'Unknown'}, ${istTime(s.decidedAt)}` : <span className='text-muted-foreground'>Never</span>}
                      </TableCell>
                      <TableCell>
                        {s.importBlocked ? <ToneBadge tone='bad'>Import blocked</ToneBadge> : <ToneBadge tone='ok'>Not blocked by this</ToneBadge>}
                      </TableCell>
                      <TableCell>
                        {rights.decideSchool && (
                          <Button size='sm' variant='outline' onClick={() => setDeciding(s)}>
                            Record a decision
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </LoadView>
      </CardContent>
      {deciding && <DecisionDialog school={deciding} onClose={() => setDeciding(null)} onDone={list.reload} />}
    </Card>
  );
}

function DecisionDialog({ school, onClose, onDone }: { school: SchoolPrivacyRow; onClose(): void; onDone(): void }) {
  const [fiduciary, setFiduciary] = useState<Fiduciary>(school.fiduciary);
  const [recipient, setRecipient] = useState<Recipient>(school.recipient);
  const [basis, setBasis] = useState(school.basis ?? '');
  const undecided = fiduciary === 'undecided' && recipient === 'undecided';
  const ready = undecided || (basis.trim().length >= 3 && basis.trim().length <= 200);
  return (
    <WriteDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Record ${school.code}'s decision`}
      blast={blastSchoolPrivacy(school.code, fiduciary, recipient)}
      guarded
      confirmLabel='Record'
      canConfirm={ready}
      onConfirm={(w) => privacy.setSchool({ code: school.code, fiduciary, recipient, basis: basis.trim(), ...w })}
      onDone={onDone}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label>Data fiduciary</Label>
          <Select value={fiduciary} onValueChange={(v) => setFiduciary(v as Fiduciary)}>
            <SelectTrigger className='w-full' aria-label='Data fiduciary'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FIDUCIARY_LABEL) as Fiduciary[]).map((f) => (
                <SelectItem key={f} value={f}>
                  {FIDUCIARY_LABEL[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>Who is told</Label>
          <Select value={recipient} onValueChange={(v) => setRecipient(v as Recipient)}>
            <SelectTrigger className='w-full' aria-label='Who is told'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RECIPIENT_LABEL) as Recipient[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {RECIPIENT_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1 sm:col-span-2'>
          <Label htmlFor='privacy-basis'>What it rests on</Label>
          <Input
            id='privacy-basis'
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="Counsel's letter of 2026-11-02"
            maxLength={200}
          />
        </div>
      </div>
    </WriteDialog>
  );
}

function Kept({ rights }: { rights: PrivacyRights }) {
  const truth = useLoad(() => privacy.retention(), []);
  const [purging, setPurging] = useState(false);
  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-2'>
        <div>
          <CardTitle className='text-base'>What is kept</CardTitle>
          <CardDescription>Each kind of record, how long it is kept, and the scheduled job that keeps to it, if any.</CardDescription>
        </div>
        {rights.contestPurge && (
          <Button size='sm' variant='outline' onClick={() => setPurging(true)}>
            Set the purge date
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <LoadView view={truth.view} reload={truth.reload}>
          {(t) => <KeptTable t={t} />}
        </LoadView>
      </CardContent>
      <PurgeDialog open={purging} onOpenChange={setPurging} onDone={truth.reload} />
    </Card>
  );
}

function KeptTable({ t }: { t: RetentionTruth }) {
  return (
    <div className='space-y-3'>
      <p className='text-sm'>
        Contest purge: {t.contest.purgeOn ? formatDay(t.contest.purgeOn) : 'not set'}; last cleared{' '}
        {t.contest.purgedAt ? istTime(t.contest.purgedAt) : 'never'}.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>What</TableHead>
            <TableHead>Where</TableHead>
            <TableHead>Holds</TableHead>
            <TableHead>Kept</TableHead>
            <TableHead>Enforced by</TableHead>
            <TableHead>Job&apos;s last run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {t.rows.map((r) => (
            <TableRow key={r.what}>
              <TableCell className='max-w-56'>{r.what}</TableCell>
              <TableCell className='font-mono text-xs'>{r.tables.join(', ')}</TableCell>
              <TableCell className='max-w-72'>{r.holds}</TableCell>
              <TableCell>{r.kept}</TableCell>
              <TableCell>{r.enforcedBy}</TableCell>
              <TableCell>
                {r.job ? (
                  <span>
                    {r.job.lastStatus} <span className='font-mono text-xs text-muted-foreground'>({r.job.schedule} UTC)</span>
                  </span>
                ) : (
                  <span className='text-muted-foreground'>No job</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PurgeDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange(o: boolean): void; onDone(): void }) {
  const tomorrow = addDays(istToday(), 1);
  const [on, setOn] = useState(tomorrow);
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Set the contest purge date'
      blast={blastContestPurge(on)}
      guarded
      destructive
      confirmLabel='Set the date'
      canConfirm={/^\d{4}-\d{2}-\d{2}$/.test(on)}
      onConfirm={(w) => privacy.setContestPurge({ on, ...w })}
      onDone={onDone}
    >
      <div className='space-y-1'>
        <Label htmlFor='purge-on'>Purge on</Label>
        <Input id='purge-on' type='date' value={on} min={tomorrow} max={addDays(istToday(), 730)} onChange={(e) => setOn(e.target.value)} />
      </div>
    </WriteDialog>
  );
}
