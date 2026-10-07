import type { PersonCard, PersonHit, SchoolDetail } from '@ai-tutor/admin-client';
import { useEffect, useState } from 'react';
import { schools } from '@/lib/client';
import { failed, type Loaded } from '@/lib/load-state';
import { useMe } from '@/lib/me';
import { canOperate } from '@/lib/roles';
import { useLoad } from '@/lib/use-load';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadView } from '@/components/load-view';
import { DisablePerson } from '../actions/disable-person';
import { ResetPin } from '../actions/reset-pin';

const KIND: Record<string, string> = { student: 'Student', teacher: 'Teacher', admin: 'Admin', parent: 'Parent' };

/**
 * People at the school are found by a search of at least two letters of a
 * name or the start of a login ID, twenty at most; there is no list of
 * everyone. A parent's name arrives masked and is shown in full only on their
 * own card.
 */
export function PeopleTab({ detail }: { detail: SchoolDetail }) {
  const me = useMe();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Loaded<PersonHit[]> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Bumped to search again (after a retry, or after someone was marked as left).
  const [tick, setTick] = useState(0);
  const again = () => setTick((t) => t + 1);
  const c = detail.counts;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      setHits({ state: 'loading' });
      schools.people(detail.code, q).then(
        (data) => live && setHits({ state: 'ready', data }),
        (e: unknown) => live && setHits(failed(e)),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, detail.code, tick]);

  if (!canOperate(me.role)) return <p className='text-sm text-muted-foreground'>Your role cannot see people at a school.</p>;

  return (
    <div className='space-y-4'>
      <p className='text-sm text-muted-foreground'>
        {c.students} students, {c.teachers} teachers, {c.admins} admins, {c.parents} parents; {c.left} have left.
      </p>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder='Name or login ID, at least 2 letters'
        aria-label='Find a person'
        className='max-w-md'
      />
      {hits && (
        <LoadView view={hits} reload={again} skeletons={2}>
          {(rows) =>
            rows.length === 0 ? (
              <p className='text-sm text-muted-foreground'>Nobody matches.</p>
            ) : (
              <Card className='py-0'>
                <CardContent className='px-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Login ID</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Class</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((p) => (
                        <TableRow key={p.loginId} className='cursor-pointer' onClick={() => setOpen(p.loginId)}>
                          <TableCell className='font-mono'>{p.loginId}</TableCell>
                          <TableCell>{KIND[p.kind] ?? p.kind}</TableCell>
                          <TableCell>
                            {p.displayName}
                            {p.leftSchool && (
                              <Badge variant='secondary' className='ms-2'>
                                Left
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{p.className ?? ''}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )
          }
        </LoadView>
      )}
      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className='overflow-y-auto sm:max-w-md'>
          {open && <PersonSheet code={detail.code} loginId={open} onChanged={again} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PersonSheet({ code, loginId, onChanged }: { code: string; loginId: string; onChanged(): void }) {
  const { view, reload } = useLoad(() => schools.person(code, loginId), [code, loginId]);
  const [pin, setPin] = useState(false);
  const [leaving, setLeaving] = useState(false);
  return (
    <>
      <SheetHeader>
        <SheetTitle className='font-mono'>{loginId}</SheetTitle>
        <SheetDescription>At {code}</SheetDescription>
      </SheetHeader>
      <div className='space-y-4 px-4'>
        <LoadView view={view} reload={reload}>
          {(p) => (
            <>
              <PersonFields p={p} />
              <div className='flex flex-wrap gap-2'>
                <Button variant='outline' onClick={() => setPin(true)} disabled={p.leftOn !== null}>
                  Give a new PIN
                </Button>
                <Button variant='destructive' onClick={() => setLeaving(true)} disabled={p.leftOn !== null}>
                  Mark as left
                </Button>
              </div>
              <ResetPin code={code} loginId={p.loginId} open={pin} onOpenChange={setPin} />
              <DisablePerson
                code={code}
                loginId={p.loginId}
                kind={p.kind}
                open={leaving}
                onOpenChange={setLeaving}
                onDone={() => {
                  reload();
                  onChanged();
                }}
              />
            </>
          )}
        </LoadView>
      </div>
    </>
  );
}

function PersonFields({ p }: { p: PersonCard }) {
  const rows: [string, string | number | null][] = [
    ['Kind', KIND[p.kind] ?? p.kind],
    ['Name', p.displayName],
    ['Class', p.className ? `${p.className}${p.roll ? `, roll ${p.roll}` : ''}` : null],
    ['On Qrie since', p.createdOn],
    ['Left on', p.leftOn],
    ['Last active', p.lastActiveOn ?? 'Never'],
    ['Classes taught', p.teaches],
    ['Children', p.children],
    ['Parents', p.parents],
  ];
  return (
    <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
      {rows
        .filter(([, v]) => v !== null)
        .map(([k, v]) => (
          <div key={k} className='contents'>
            <dt className='text-muted-foreground'>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
