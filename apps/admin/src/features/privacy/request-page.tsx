import type { ErasureDetail } from '@ai-tutor/admin-client';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { privacy } from '@/lib/client';
import { useMe } from '@/lib/me';
import { useLoad } from '@/lib/use-load';
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
import { CHANNEL_LABEL, REQUESTER_LABEL, REQUEST_STATUS_LABEL } from './index.tsx';
import { blastErase, dueTone, privacyRights, type PrivacyRights } from './model.ts';

const HOW: Record<string, string> = {
  'school-confirmed': 'The school confirmed it',
  'parent-callback': 'Rang the parent back',
  'in-person': 'In person',
  'account-signed-in': 'From the signed-in account',
};

/**
 * ONE ERASURE REQUEST: the school student's name and whether they have left,
 * what would be erased (rows by table, photos, activity-log lines) or what
 * was. Verify, refuse and, for the owner with a fresh code, Erase. This is
 * the only page in the console with an erase control.
 */
export function RequestPage() {
  const { requestId } = useParams({ from: '/privacy/requests/$requestId' });
  const rights = privacyRights(useMe().role);
  const detail = useLoad(() => privacy.request(requestId), [requestId]);
  return (
    <AdminPage title='Erasure request'>
      <div className='mb-4'>
        <Link to='/privacy' className='text-sm underline'>
          Back to Privacy
        </Link>
      </div>
      <LoadView view={detail.view} reload={detail.reload}>
        {(d) => <Detail d={d} rights={rights} onChanged={detail.reload} />}
      </LoadView>
    </AdminPage>
  );
}

function Detail({ d, rights, onChanged }: { d: ErasureDetail; rights: PrivacyRights; onChanged(): void }) {
  const [verifying, setVerifying] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [erasing, setErasing] = useState(false);
  const open = d.status === 'received' || d.status === 'verified' || d.status === 'erasing';
  const counts = d.status === 'refused' ? null : (d.preview ?? (d.tallies as ErasureDetail['preview']));
  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
            {d.subjectKind === 'school-student' ? (d.displayName ?? 'A school student') : 'Someone who came on their own'}
            <ToneBadge tone={dueTone(d.daysLeft, d.status)}>{REQUEST_STATUS_LABEL[d.status]}</ToneBadge>
          </CardTitle>
          <CardDescription>
            {d.school ? `${d.school.code} · ` : ''}
            {d.loginId ? `${d.loginId} · ` : ''}
            reference <span className='font-mono'>{d.reference}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className='grid gap-2 text-sm sm:grid-cols-3'>
            <Item label='Received' value={formatDay(d.receivedOn)} />
            <Item label='Due' value={open ? `${formatDay(d.dueOn)} (${d.daysLeft < 0 ? `${-d.daysLeft} days late` : `${d.daysLeft} days left`})` : formatDay(d.dueOn)} />
            <Item label='Came by' value={`${CHANNEL_LABEL[d.channel] ?? d.channel}, from ${(REQUESTER_LABEL[d.requester] ?? d.requester).toLowerCase()}`} />
            {d.subjectKind === 'school-student' && (
              <Item label='Left the school' value={d.left === null ? 'Account gone' : d.left ? 'Yes' : 'No: mark them as left first'} />
            )}
            <Item label='Verified' value={d.verifiedHow ? `${HOW[d.verifiedHow] ?? d.verifiedHow}, by ${d.verifiedByName ?? 'unknown'}` : 'Not yet'} />
            {d.refusedReason && <Item label='Refused because' value={d.refusedReason} />}
          </dl>
        </CardContent>
      </Card>
      {counts && <Counts title={d.preview ? 'What would be erased' : 'What was erased'} counts={counts} />}
      {open && (
        <div className='flex flex-wrap gap-2'>
          {rights.verify && d.status === 'received' && (
            <Button variant='outline' onClick={() => setVerifying(true)}>
              Verify
            </Button>
          )}
          {rights.refuse && (d.status === 'received' || d.status === 'verified') && (
            <Button variant='outline' onClick={() => setRefusing(true)}>
              Refuse
            </Button>
          )}
          {rights.erase && (d.status === 'verified' || d.status === 'erasing') && (
            <Button variant='destructive' onClick={() => setErasing(true)}>
              Erase
            </Button>
          )}
        </div>
      )}
      <VerifyDialog open={verifying} onOpenChange={setVerifying} requestId={d.id} onDone={onChanged} />
      <WriteDialog
        open={refusing}
        onOpenChange={setRefusing}
        title='Refuse this request'
        blast='The request is closed as refused, with your reason kept beside it. Nothing is erased.'
        confirmLabel='Refuse'
        onConfirm={(w) => privacy.refuse({ requestId: d.id, ...w })}
        onDone={onChanged}
      />
      <EraseDialog open={erasing} onOpenChange={setErasing} d={d} onDone={onChanged} />
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Counts({ title, counts }: { title: string; counts: NonNullable<ErasureDetail['preview']> }) {
  const rows = Object.entries(counts.rows ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{title}</CardTitle>
        <CardDescription>
          {counts.photos} {counts.photos === 1 ? 'photo' : 'photos'}; the login ID in {counts.activityLogLines}{' '}
          {counts.activityLogLines === 1 ? 'line' : 'lines'} of the school&apos;s activity log.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className='text-sm text-muted-foreground'>No rows.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table and column</TableHead>
                <TableHead className='text-end'>Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(([k, n]) => (
                <TableRow key={k}>
                  <TableCell className='font-mono text-xs'>{k}</TableCell>
                  <TableCell className='text-end'>{n}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function VerifyDialog({ open, onOpenChange, requestId, onDone }: { open: boolean; onOpenChange(o: boolean): void; requestId: string; onDone(): void }) {
  const [how, setHow] = useState('parent-callback');
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Verify this request'
      blast='The request is marked verified, with how it was checked. Nothing is erased until the owner presses Erase.'
      confirmLabel='Verify'
      onConfirm={(w) => privacy.verify({ requestId, how, ...w })}
      onDone={onDone}
    >
      <div className='space-y-1'>
        <Label>How it was verified</Label>
        <Select value={how} onValueChange={setHow}>
          <SelectTrigger className='w-full' aria-label='How it was verified'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(HOW).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </WriteDialog>
  );
}

/**
 * The confirmation word: the login ID for a school student; for someone who
 * came on their own (whose user ID this page does not show), the request's
 * reference.
 */
function EraseDialog({ open, onOpenChange, d, onDone }: { open: boolean; onOpenChange(o: boolean): void; d: ErasureDetail; onDone(): void }) {
  const [typed, setTyped] = useState('');
  const expected = d.loginId ?? d.reference;
  return (
    <WriteDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('');
        onOpenChange(o);
      }}
      title='Erase every record'
      blast={blastErase(d)}
      guarded
      destructive
      confirmLabel='Erase for good'
      canConfirm={typed.trim() === expected}
      onConfirm={async (w) => {
        await privacy.erase({ requestId: d.id, ...w });
      }}
      onDone={onDone}
    >
      <div className='space-y-1'>
        <Label htmlFor='erase-confirm'>{d.loginId ? 'Type the login ID to confirm' : "Type the request's reference to confirm"}</Label>
        <Input id='erase-confirm' value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete='off' className='font-mono' />
        <p className='text-xs text-muted-foreground'>
          If Storage does not remove the photos, nothing is erased: press Erase again.
        </p>
      </div>
    </WriteDialog>
  );
}
