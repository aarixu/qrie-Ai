import type { ClassRow, RemovedClassRow } from '@ai-tutor/admin-client';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { classes } from '@/lib/client';
import { useMe } from '@/lib/me';
import { istTime } from '@/lib/time';
import { useLoad } from '@/lib/use-load';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminPage } from '@/components/admin-page';
import { LoadView } from '@/components/load-view';
import { WriteDialog } from '@/components/write-dialog';
import { ToneBadge } from '../billing/parts.tsx';
import { blastPublish, blastRemove, classRights, costText, type ClassRights } from './model.ts';

/**
 * THE CLASSES PAGE: classes waiting for review, published ones and removed
 * ones, each with its reports (counts) and cost. The owner publishes; the
 * owner or ops retracts or rejects with a fresh code, which hides the class at
 * once and then deletes its files from Storage (admin-api) before its row.
 */
export function Classes() {
  const rights = classRights(useMe().role);
  const pending = useLoad(() => classes.list('pending'), []);
  const published = useLoad(() => classes.list('published'), []);
  const hidden = useLoad(() => classes.list('retracted'), []);
  const removed = useLoad(() => classes.removed(), []);
  const reloadAll = () => {
    pending.reload();
    published.reload();
    hidden.reload();
    removed.reload();
  };
  return (
    <AdminPage title='Classes'>
      <Tabs defaultValue='pending'>
        <TabsList>
          <TabsTrigger value='pending'>Waiting for review</TabsTrigger>
          <TabsTrigger value='published'>Published</TabsTrigger>
          <TabsTrigger value='removed'>Removed</TabsTrigger>
        </TabsList>
        <TabsContent value='pending'>
          <LoadView view={pending.view} reload={pending.reload}>
            {(rows) =>
              rows.length === 0 ? (
                <Empty>Nothing is waiting for review. A class is shared as soon as it is kept, until the review-first setting exists.</Empty>
              ) : (
                <ClassTable rows={rows} rights={rights} onChanged={reloadAll} />
              )
            }
          </LoadView>
        </TabsContent>
        <TabsContent value='published'>
          <LoadView view={published.view} reload={published.reload}>
            {(rows) => (rows.length === 0 ? <Empty>No classes kept yet.</Empty> : <ClassTable rows={rows} rights={rights} onChanged={reloadAll} />)}
          </LoadView>
        </TabsContent>
        <TabsContent value='removed' className='space-y-4'>
          <LoadView view={hidden.view} reload={hidden.reload} skeletons={1}>
            {(rows) =>
              rows.length === 0 ? null : (
                <Card>
                  <CardContent className='space-y-2 pt-6'>
                    <p className='text-sm'>
                      Hidden, but Storage still holds their files: press Retract or Reject again to finish removing them.
                    </p>
                    <ClassTable rows={rows} rights={rights} onChanged={reloadAll} />
                  </CardContent>
                </Card>
              )
            }
          </LoadView>
          <LoadView view={removed.view} reload={removed.reload}>
            {(rows) => (rows.length === 0 ? <Empty>No class has been removed.</Empty> : <RemovedTable rows={rows} />)}
          </LoadView>
        </TabsContent>
      </Tabs>
    </AdminPage>
  );
}

function Empty({ children }: { children: string }) {
  return <p className='py-4 text-sm text-muted-foreground'>{children}</p>;
}

export function ReportsCell({ open, unsafe }: { open: number; unsafe: number }) {
  return unsafe > 0 ? (
    <ToneBadge tone='bad'>
      {open} open, {unsafe} unsafe
    </ToneBadge>
  ) : (
    <span>
      {open} open, {unsafe} unsafe
    </span>
  );
}

function ClassTable({ rows, rights, onChanged }: { rows: ClassRow[]; rights: ClassRights; onChanged(): void }) {
  const navigate = useNavigate();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Class</TableHead>
          <TableHead>Class and subject</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Published</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Reports</TableHead>
          <TableHead>Cost</TableHead>
          <TableHead>Last action</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => {
          const cost = costText(c.cost);
          return (
            <TableRow key={c.id}>
              <TableCell>
                <button
                  type='button'
                  className='text-start font-medium underline-offset-2 hover:underline'
                  onClick={() => void navigate({ to: '/classes/$classId', params: { classId: c.id } })}
                >
                  {c.title}
                </button>
                <div className='font-mono text-xs text-muted-foreground'>{c.topicRef}</div>
              </TableCell>
              <TableCell>
                Class {c.klass}, {c.subject}
              </TableCell>
              <TableCell className='whitespace-nowrap'>{istTime(c.createdAt)}</TableCell>
              <TableCell className='whitespace-nowrap'>{c.publishedAt ? istTime(c.publishedAt) : <span className='text-muted-foreground'>Not yet</span>}</TableCell>
              <TableCell>{c.version}</TableCell>
              <TableCell>
                <ReportsCell open={c.reports.open} unsafe={c.reports.unsafe} />
              </TableCell>
              <TableCell className={cost.tone === 'grey' ? 'text-muted-foreground' : undefined}>{cost.text}</TableCell>
              <TableCell>
                {c.lastAction ? (
                  `${c.lastAction.action} by ${c.lastAction.byName}, ${istTime(c.lastAction.at)}`
                ) : (
                  <span className='text-muted-foreground'>None</span>
                )}
              </TableCell>
              <TableCell>
                <ClassActions c={c} rights={rights} onChanged={onChanged} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Publish (a class waiting for review), Retract (a published one), Reject (one waiting); a hidden one offers both removals again. */
export function ClassActions({ c, rights, onChanged }: { c: ClassRow; rights: ClassRights; onChanged(): void }) {
  const [doing, setDoing] = useState<'publish' | 'retract' | 'reject' | null>(null);
  const [answer, setAnswer] = useState('');
  const canPublish = rights.publish && c.status === 'pending';
  const canRetract = rights.retract && (c.status === 'published' || c.status === 'retracted');
  const canReject = rights.reject && (c.status === 'pending' || c.status === 'retracted');
  if (!canPublish && !canRetract && !canReject) return null;
  return (
    <div className='flex flex-wrap justify-end gap-1'>
      {canPublish && (
        <Button size='sm' variant='outline' onClick={() => setDoing('publish')}>
          Publish
        </Button>
      )}
      {canRetract && (
        <Button size='sm' variant='outline' onClick={() => setDoing('retract')}>
          Retract
        </Button>
      )}
      {canReject && (
        <Button size='sm' variant='outline' onClick={() => setDoing('reject')}>
          Reject
        </Button>
      )}
      {answer && <span className='text-xs text-muted-foreground'>{answer}</span>}
      <WriteDialog
        open={doing !== null}
        onOpenChange={(o) => !o && setDoing(null)}
        title={doing === 'publish' ? 'Publish this class' : doing === 'retract' ? 'Retract this class' : 'Reject this class'}
        blast={doing === 'publish' ? blastPublish(c) : doing ? blastRemove(c, doing) : ''}
        guarded
        destructive={doing !== 'publish'}
        confirmLabel={doing === 'publish' ? 'Publish' : doing === 'retract' ? 'Retract' : 'Reject'}
        onConfirm={async (w) => {
          if (doing === 'publish') {
            await classes.publish({ classId: c.id, ...w });
            setAnswer('Published.');
          } else if (doing) {
            const out = await classes.remove({ classId: c.id, action: doing, ...w });
            setAnswer(`Removed, with ${out.removed} ${out.removed === 1 ? 'file' : 'files'}.`);
          }
        }}
        onDone={onChanged}
      />
    </div>
  );
}

function RemovedTable({ rows }: { rows: RemovedClassRow[] }) {
  const navigate = useNavigate();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Class</TableHead>
          <TableHead>Removed</TableHead>
          <TableHead>By</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Reports</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className='cursor-pointer' onClick={() => void navigate({ to: '/classes/$classId', params: { classId: r.id } })}>
            <TableCell>
              <div className='font-medium'>{r.title}</div>
              <div className='font-mono text-xs text-muted-foreground'>{r.topicRef}</div>
            </TableCell>
            <TableCell className='whitespace-nowrap'>{istTime(r.removedAt)}</TableCell>
            <TableCell>{r.byName}</TableCell>
            <TableCell className='max-w-72'>{r.reason}</TableCell>
            <TableCell>
              <ReportsCell open={r.reports.open} unsafe={r.reports.unsafe} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
