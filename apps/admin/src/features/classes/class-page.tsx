import type { ClassDetail } from '@ai-tutor/admin-client';
import { Link, useParams } from '@tanstack/react-router';
import { classes } from '@/lib/client';
import { useMe } from '@/lib/me';
import { istTime } from '@/lib/time';
import { useLoad } from '@/lib/use-load';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import { LoadView } from '@/components/load-view';
import { formatPaise } from '../billing/money.ts';
import { ToneBadge } from '../billing/parts.tsx';
import { KIND_LABEL, STATUS_LABEL } from '../safety/model.ts';
import { ClassActions } from './index.tsx';
import { classRights, costText } from './model.ts';

const STATUS_NAME = { pending: 'Waiting for review', published: 'Published', retracted: 'Hidden' } as const;
const rupees = (inr: number) => formatPaise(Math.round(inr * 100));

/** One class, live or removed: its cost, its reports (counts only), its files in Storage and what staff did to it. */
export function ClassPage() {
  const { classId } = useParams({ from: '/classes/$classId' });
  const rights = classRights(useMe().role);
  const detail = useLoad(() => classes.detail(classId), [classId]);
  return (
    <AdminPage title='Class'>
      <div className='mb-4'>
        <Link to='/classes' className='text-sm underline'>
          Back to Classes
        </Link>
      </div>
      <LoadView view={detail.view} reload={detail.reload}>
        {(d) => <Detail d={d} rights={rights} onChanged={detail.reload} />}
      </LoadView>
    </AdminPage>
  );
}

function Detail({ d, rights, onChanged }: { d: ClassDetail; rights: ReturnType<typeof classRights>; onChanged(): void }) {
  const live = d.live;
  const title = live?.title ?? d.removed?.title ?? 'A class';
  const topic = live?.topicRef ?? d.removed?.topicRef ?? '';
  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
            {title}
            {live ? (
              <ToneBadge tone={live.status === 'published' ? 'ok' : 'grey'}>{STATUS_NAME[live.status]}</ToneBadge>
            ) : (
              <ToneBadge tone='grey'>Removed</ToneBadge>
            )}
          </CardTitle>
          <CardDescription className='font-mono text-xs'>{topic}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3 text-sm'>
          {live && (
            <p>
              Class {live.klass}, {live.subject} · version {live.version} · created {istTime(live.createdAt)}
              {live.publishedAt ? ` · published ${istTime(live.publishedAt)}` : ''}
            </p>
          )}
          {d.removed && (
            <p>
              Removed {istTime(d.removed.removedAt)} by {d.removed.byName}: {d.removed.reason}
            </p>
          )}
          <p>
            Files in Storage: <strong>{d.filesInStorage}</strong>
          </p>
          {live && <ClassActions c={live} rights={rights} onChanged={onChanged} />}
        </CardContent>
      </Card>
      {live && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Cost</CardTitle>
            <CardDescription>
              Calls made in sittings on this topic, and calls that share a preparation with them.
              {live.cost.unpriced ? ' Some calls have no price yet, so each amount is at least this much.' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {live.cost.calls === 0 ? (
              <p className='text-sm text-muted-foreground'>{costText(live.cost).text}</p>
            ) : (
              <dl className='grid grid-cols-2 gap-3 text-sm sm:grid-cols-5'>
                <Figure label='Total' value={costText(live.cost).text} />
                <Figure label='Preparing (first student)' value={rupees(live.cost.liveInr)} />
                <Figure label='Serving (cached)' value={rupees(live.cost.warmInr)} />
                <Figure label='Calls' value={String(live.cost.calls)} />
                <Figure label='Sittings' value={String(live.cost.sittings)} />
              </dl>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Reports</CardTitle>
          <CardDescription>Counts only. A report&apos;s words are read inside a case on the Safety page.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className='grid grid-cols-2 gap-3 text-sm sm:grid-cols-4'>
            {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
              <Figure key={k} label={KIND_LABEL[k]} value={String(d.reportsByKind[k])} />
            ))}
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => (
              <Figure key={s} label={STATUS_LABEL[s]} value={String(d.reportsByStatus[s])} />
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>History</CardTitle>
        </CardHeader>
        <CardContent>
          {d.history.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No member of staff has acted on this class.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Files</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.history.map((h, i) => (
                  <TableRow key={`${h.at}-${i}`}>
                    <TableCell>{h.action}</TableCell>
                    <TableCell>{h.byName}</TableCell>
                    <TableCell className='whitespace-nowrap'>{istTime(h.at)}</TableCell>
                    <TableCell className='max-w-72'>{h.reason}</TableCell>
                    <TableCell>{h.files ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-md border p-3'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='font-semibold'>{value}</dd>
    </div>
  );
}
