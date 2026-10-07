import type { Contact } from '@ai-tutor/admin-client';
import { useState } from 'react';
import { schools } from '@/lib/client';
import { useMe } from '@/lib/me';
import { canOperate } from '@/lib/roles';
import { istTime } from '@/lib/time';
import { useLoad } from '@/lib/use-load';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadView } from '@/components/load-view';
import { EditContact, RemoveContact } from '../actions/contact';
import { AddNote } from '../actions/note';
import { SetQuiet } from '../actions/quiet';

/**
 * Qrie's own notes on the school, which the school does not see: a holiday
 * (the health card's day-to-day signals read grey until it ends), the people
 * to call, and calls and notes, newest first (the latest 100).
 */
export function NotesTab({ code, onChanged }: { code: string; onChanged(): void }) {
  const me = useMe();
  const { view, reload } = useLoad(() => schools.notes(code), [code]);
  const [quiet, setQuiet] = useState<'set' | 'clear' | null>(null);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const [noting, setNoting] = useState(false);
  const changed = () => {
    reload();
    onChanged();
  };

  if (!canOperate(me.role)) return <p className='text-sm text-muted-foreground'>Your role cannot see the notes.</p>;

  return (
    <LoadView view={view} reload={reload}>
      {(n) => (
        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>On holiday</CardTitle>
              <CardDescription>
                {n.quietUntil ? `Until ${n.quietUntil}: teaching, learning, attendance and last active read grey.` : 'Not on holiday.'}
              </CardDescription>
            </CardHeader>
            <CardContent className='flex gap-2'>
              <Button variant='outline' size='sm' onClick={() => setQuiet('set')}>
                {n.quietUntil ? 'Change the end' : 'Set a holiday'}
              </Button>
              {n.quietUntil && (
                <Button variant='ghost' size='sm' onClick={() => setQuiet('clear')}>
                  Clear
                </Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>People to call</CardTitle>
              <CardDescription>Adults at the school. The school does not see this list.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              {n.contacts.length === 0 && <p className='text-sm text-muted-foreground'>None yet.</p>}
              {n.contacts.map((ct) => (
                <div key={ct.id} className='flex flex-wrap items-center gap-2 text-sm'>
                  <span className='font-medium'>{ct.name}</span>
                  <span className='text-muted-foreground'>{ct.role}</span>
                  <span>{[ct.phone, ct.email].filter(Boolean).join(', ')}</span>
                  <Button variant='ghost' size='sm' onClick={() => setEditing(ct)}>
                    Change
                  </Button>
                  <Button variant='ghost' size='sm' onClick={() => setRemoving(ct)}>
                    Remove
                  </Button>
                </div>
              ))}
              <Button variant='outline' size='sm' onClick={() => setEditing('new')}>
                Add a contact
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Calls and notes</CardTitle>
              <CardDescription>Kept as written; never edited or deleted here.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              <Button variant='outline' size='sm' onClick={() => setNoting(true)}>
                Add a call or a note
              </Button>
              {n.notes.length === 0 && <p className='text-sm text-muted-foreground'>None yet.</p>}
              <ul className='space-y-3'>
                {n.notes.map((x) => (
                  <li key={x.id} className='rounded-md border p-3 text-sm'>
                    <div className='mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                      <Badge variant='secondary'>{x.kind === 'call' ? 'Call' : 'Note'}</Badge>
                      {istTime(x.at)}, {x.authorName}
                    </div>
                    <p className='whitespace-pre-wrap'>{x.body}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <SetQuiet code={code} clear={quiet === 'clear'} open={quiet !== null} onOpenChange={(o) => !o && setQuiet(null)} onDone={changed} />
          <EditContact
            code={code}
            contact={editing === 'new' ? null : editing}
            open={editing !== null}
            onOpenChange={(o) => !o && setEditing(null)}
            onDone={reload}
          />
          <RemoveContact code={code} contact={removing} open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)} onDone={reload} />
          <AddNote code={code} open={noting} onOpenChange={setNoting} onDone={reload} />
        </div>
      )}
    </LoadView>
  );
}
