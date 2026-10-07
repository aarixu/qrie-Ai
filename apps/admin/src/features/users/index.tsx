import type { DirectUser } from '@ai-tutor/admin-client';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { blastBlock } from '@/lib/blast';
import { schools, users } from '@/lib/client';
import { failed, type Loaded } from '@/lib/load-state';
import { useMe } from '@/lib/me';
import { canOperate } from '@/lib/roles';
import { useLoad } from '@/lib/use-load';
import { isUserRef } from '@/lib/users-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import { LoadView } from '@/components/load-view';
import { WriteDialog } from '@/components/write-dialog';

/**
 * The users directory has two doors. People at a school are found on that
 * school's page. People who came on their own (direct users) are counted
 * here and found by the start of their user ID; no name, phone or address is
 * shown. Owner and ops only (the database refuses the safety role anyway).
 */
export function Users() {
  const me = useMe();
  return (
    <AdminPage title='Users'>
      {canOperate(me.role) ? (
        <div className='space-y-4'>
          <SchoolDoor />
          <DirectDoor />
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>Your role cannot see this.</p>
      )}
    </AdminPage>
  );
}

function SchoolDoor() {
  const navigate = useNavigate();
  const { view, reload } = useLoad(() => schools.index(), []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>People in a school</CardTitle>
        <CardDescription>Students, teachers, admins and parents are found on their school&apos;s page.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoadView view={view} reload={reload} skeletons={1}>
          {(list) =>
            list.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No schools yet.</p>
            ) : (
              <Select onValueChange={(code) => void navigate({ to: '/schools/$code', params: { code }, search: { tab: 'people' } })}>
                <SelectTrigger className='w-full max-w-md' aria-label='Choose a school'>
                  <SelectValue placeholder='Choose a school' />
                </SelectTrigger>
                <SelectContent>
                  {list.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      <span className='font-mono text-xs'>{s.code}</span> {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          }
        </LoadView>
      </CardContent>
    </Card>
  );
}

const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');

function DirectDoor() {
  const summary = useLoad(() => users.summary(), []);
  const [ref, setRef] = useState('');
  const [found, setFound] = useState<Loaded<DirectUser[]> | null>(null);
  const [searched, setSearched] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);

  async function find(q: string) {
    setFound({ state: 'loading' });
    setSearched(q);
    try {
      setFound({ state: 'ready', data: await users.find(q) });
    } catch (e) {
      setFound(failed(e));
    }
  }

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (isUserRef(ref)) void find(ref.trim().toLowerCase());
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>People who came on their own</CardTitle>
        <CardDescription>Accounts with no school, not made by a school and not staff.</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <LoadView view={summary.view} reload={summary.reload} skeletons={1}>
          {(s) => (
            <dl className='grid grid-cols-2 gap-3 text-sm sm:grid-cols-4'>
              <Tile label='All' n={s.total} />
              <Tile label='Anonymous' n={s.anonymous} />
              <Tile label='Permanent' n={s.permanent} />
              <Tile label='New in 7 days' n={s.createdLast7Days} />
              <Tile label='Active in 7 days' n={s.activeLast7Days} />
              <Tile label='With a contest entry' n={s.withContestEntry} />
              <Tile label='With a consent record' n={s.withConsent} />
              <Tile label='Blocked' n={s.blocked} />
            </dl>
          )}
        </LoadView>
        <form onSubmit={submit} className='flex max-w-md gap-2'>
          <Input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder='First 8 or more characters of the user ID'
            aria-label='User ID'
            className='font-mono'
          />
          <Button type='submit' variant='outline' disabled={!isUserRef(ref)}>
            Find
          </Button>
        </form>
        <p className='text-xs text-muted-foreground'>No names, phone numbers or addresses are shown here.</p>
        {found && (
          <LoadView view={found} reload={() => void find(searched)} skeletons={1}>
            {(rows) =>
              rows.length === 0 ? (
                <p className='text-sm text-muted-foreground'>No direct user&apos;s ID starts with that.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Last active</TableHead>
                      <TableHead className='text-end'>Sessions</TableHead>
                      <TableHead>School</TableHead>
                      <TableHead>Contest entry</TableHead>
                      <TableHead>Consent</TableHead>
                      <TableHead>Blocked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((u) => (
                      <TableRow key={u.userId} className='cursor-pointer' onClick={() => setChosen(u.userId)}>
                        <TableCell className='font-mono'>{u.ref}</TableCell>
                        <TableCell>{u.createdOn}</TableCell>
                        <TableCell>{u.anonymous ? 'Anonymous' : 'Permanent'}</TableCell>
                        <TableCell>{u.lastActiveOn ?? 'Never'}</TableCell>
                        <TableCell className='text-end'>{u.sessions}</TableCell>
                        <TableCell>{u.schoolCode ?? 'None'}</TableCell>
                        <TableCell>{yesNo(u.contestEntry)}</TableCell>
                        <TableCell>{yesNo(u.consent)}</TableCell>
                        <TableCell>{u.blocked ? <Badge variant='destructive'>Blocked</Badge> : 'No'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            }
          </LoadView>
        )}
        {chosen && (
          <UserCard
            userId={chosen}
            onClose={() => setChosen(null)}
            onChanged={() => {
              summary.reload();
              if (searched) void find(searched);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Tile({ label, n }: { label: string; n: number }) {
  return (
    <div className='rounded-md border p-3'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='text-lg font-semibold'>{n}</dd>
    </div>
  );
}

/** One direct user: the same fields as the search row, and block or unblock. */
function UserCard({ userId, onClose, onChanged }: { userId: string; onClose(): void; onChanged(): void }) {
  const { view, reload } = useLoad(() => users.user(userId), [userId]);
  const [asking, setAsking] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className='font-mono text-base'>{userId.slice(0, 8)}</CardTitle>
        <CardDescription>A direct user.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoadView view={view} reload={reload} skeletons={1}>
          {(u) => (
            <div className='space-y-4'>
              <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
                <dt className='text-muted-foreground'>Created</dt>
                <dd>{u.createdOn}</dd>
                <dt className='text-muted-foreground'>Kind</dt>
                <dd>{u.anonymous ? 'Anonymous' : 'Permanent'}</dd>
                <dt className='text-muted-foreground'>Last active</dt>
                <dd>{u.lastActiveOn ?? 'Never'}</dd>
                <dt className='text-muted-foreground'>Sessions</dt>
                <dd>{u.sessions}</dd>
                <dt className='text-muted-foreground'>School</dt>
                <dd>{u.schoolCode ?? 'None'}</dd>
                <dt className='text-muted-foreground'>Contest entry</dt>
                <dd>{yesNo(u.contestEntry)}</dd>
                <dt className='text-muted-foreground'>Consent record</dt>
                <dd>{yesNo(u.consent)}</dd>
                <dt className='text-muted-foreground'>Blocked</dt>
                <dd>{yesNo(u.blocked)}</dd>
              </dl>
              <div className='flex gap-2'>
                <Button variant={u.blocked ? 'outline' : 'destructive'} onClick={() => setAsking(true)}>
                  {u.blocked ? 'Unblock' : 'Block sign-in'}
                </Button>
                <Button variant='ghost' onClick={onClose}>
                  Close
                </Button>
              </div>
              <WriteDialog
                open={asking}
                onOpenChange={setAsking}
                title={u.blocked ? `Unblock ${u.ref}?` : `Block ${u.ref}?`}
                blast={blastBlock(!u.blocked)}
                destructive={!u.blocked}
                confirmLabel={u.blocked ? 'Unblock' : 'Block sign-in'}
                onConfirm={async (w) => {
                  await users.setBlocked({ userId: u.userId, blocked: !u.blocked, ...w });
                }}
                onDone={() => {
                  reload();
                  onChanged();
                }}
              />
            </div>
          )}
        </LoadView>
      </CardContent>
    </Card>
  );
}
