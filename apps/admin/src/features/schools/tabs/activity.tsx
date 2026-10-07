import type { ActivityRow } from '@ai-tutor/admin-client';
import { useState } from 'react';
import { schools } from '@/lib/client';
import { useMe } from '@/lib/me';
import { canOperate } from '@/lib/roles';
import { istTime } from '@/lib/time';
import { useLoad } from '@/lib/use-load';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadView } from '@/components/load-view';

/**
 * Eight weeks of counts (homework published, work handed in, class-days of
 * attendance, by India's weeks), then the timeline: the school's own log and
 * Qrie's actions on the school, newest first. No child is named in it.
 */
export function ActivityTab({ code }: { code: string }) {
  const me = useMe();
  const weekly = useLoad(() => schools.weekly(code), [code]);
  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>The last 8 weeks</CardTitle>
          <CardDescription>Weeks start on Monday, in India.</CardDescription>
        </CardHeader>
        <CardContent className='px-0'>
          <LoadView view={weekly.view} reload={weekly.reload} skeletons={2}>
            {(weeks) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week of</TableHead>
                    <TableHead className='text-end'>Homework published</TableHead>
                    <TableHead className='text-end'>Work handed in</TableHead>
                    <TableHead className='text-end'>Class-days of attendance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeks.map((w) => (
                    <TableRow key={w.weekStart}>
                      <TableCell>{w.weekStart}</TableCell>
                      <TableCell className='text-end'>{w.published}</TableCell>
                      <TableCell className='text-end'>{w.handedIn}</TableCell>
                      <TableCell className='text-end'>{w.attendanceMarked}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </LoadView>
        </CardContent>
      </Card>
      {canOperate(me.role) ? <Timeline code={code} /> : <p className='text-sm text-muted-foreground'>Your role cannot see the timeline.</p>}
    </div>
  );
}

function Timeline({ code }: { code: string }) {
  const first = useLoad(() => schools.activity(code), [code]);
  const [older, setOlder] = useState<ActivityRow[]>([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');

  async function showOlder(rows: ActivityRow[]) {
    const last = rows[rows.length - 1];
    if (!last) return;
    setError('');
    try {
      const next = await schools.activity(code, last.at);
      setOlder((o) => [...o, ...next]);
      if (next.length < 50) setMore(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Timeline</CardTitle>
        <CardDescription>Times are India&apos;s.</CardDescription>
      </CardHeader>
      <CardContent className='px-0'>
        <LoadView view={first.view} reload={first.reload} skeletons={3}>
          {(rows) => {
            const all = [...rows, ...older];
            return all.length === 0 ? (
              <p className='px-6 text-sm text-muted-foreground'>Nothing has happened at this school yet.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Where</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead>On</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {all.map((r, i) => (
                      <TableRow key={`${r.at}-${i}`}>
                        <TableCell className='whitespace-nowrap'>{istTime(r.at)}</TableCell>
                        <TableCell>
                          <Badge variant={r.source === 'qrie' ? 'default' : 'secondary'}>{r.source === 'qrie' ? 'Qrie' : 'School'}</Badge>
                        </TableCell>
                        <TableCell>{r.actor}</TableCell>
                        <TableCell className='font-mono text-xs'>{r.action}</TableCell>
                        <TableCell className='font-mono text-xs'>{r.target}</TableCell>
                        <TableCell className='max-w-64 whitespace-normal'>{r.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className='flex items-center gap-3 px-6 pt-3'>
                  {more && all.length >= 50 && (
                    <Button variant='outline' size='sm' onClick={() => void showOlder(all)}>
                      Show older
                    </Button>
                  )}
                  {error && <span className='text-sm text-destructive'>{error}</span>}
                </div>
              </>
            );
          }}
        </LoadView>
      </CardContent>
    </Card>
  );
}
