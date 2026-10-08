import type { Invitation, RosterRow } from '@ai-tutor/admin-client';
import { useEffect, useState } from 'react';
import { blastAddExisting, blastInvite, blastStaff } from '@/lib/blast';
import { admin, staff } from '@/lib/client';
import { useMe } from '@/lib/me';
import { isOwner } from '@/lib/roles';
import { FACTOR_TITLE, mayTurnOn, STATUS_TITLE } from '@/lib/staff-view';
import { useLoad } from '@/lib/use-load';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminPage } from '@/components/admin-page';
import { LoadView } from '@/components/load-view';
import { WriteDialog } from '@/components/write-dialog';
import { ShownOnce } from '@/features/schools/actions/shown-once';
import { AuditLog } from './audit-log';
import { STAFF_ROLES, type StaffRole } from './roles';

/**
 * Who works on Qrie control and what they did: the staff list (invite, turn
 * on after a phone call, change a role, switch off) and the audit log. The
 * owner's page; the database refuses everyone else.
 */
export function StaffPage() {
  const me = useMe();
  return (
    <AdminPage title='Staff and audit'>
      {isOwner(me.role) ? <StaffAndAudit /> : <p className='text-sm text-muted-foreground'>Your role cannot see this.</p>}
    </AdminPage>
  );
}

function StaffAndAudit() {
  const roster = useLoad(() => staff.roster(), []);
  const people = roster.view.state === 'ready' ? roster.view.data : [];
  return (
    <Tabs defaultValue='staff'>
      <TabsList className='mb-4'>
        <TabsTrigger value='staff'>Staff</TabsTrigger>
        <TabsTrigger value='audit'>Audit log</TabsTrigger>
      </TabsList>
      <TabsContent value='staff'>
        <LoadView view={roster.view} reload={roster.reload}>
          {(rows) => <Roster rows={rows} onChanged={roster.reload} />}
        </LoadView>
      </TabsContent>
      <TabsContent value='audit'>
        <AuditLog people={people} />
      </TabsContent>
    </Tabs>
  );
}

type Doing =
  | { kind: 'on' | 'off' | 'role' | 'add'; row: RosterRow }
  | { kind: 'invite' }
  | null;

const isRole = (r: string | null): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r ?? '');
/** Only rows whose role this console knows get actions (see the Roster), so this never guesses a role. */
const roleOf = (r: RosterRow): StaffRole => r.role as StaffRole;
const nameOf = (r: RosterRow): string => r.displayName ?? r.email ?? r.userId.slice(0, 8);

function Roster({ rows, onChanged }: { rows: RosterRow[]; onChanged(): void }) {
  const me = useMe();
  const [doing, setDoing] = useState<Doing>(null);
  const [invited, setInvited] = useState<Invitation | null>(null);
  const close = (o: boolean) => !o && setDoing(null);
  const row = doing && doing.kind !== 'invite' ? doing.row : null;

  return (
    <div className='space-y-4'>
      <div className='flex justify-end'>
        <Button onClick={() => setDoing({ kind: 'invite' })}>Invite a person</Button>
      </div>
      <Card className='py-0'>
        <CardContent className='px-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Authenticator</TableHead>
                <TableHead>Since</TableHead>
                <TableHead className='text-end'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.userId}>
                  <TableCell>{r.displayName ?? <span className='text-muted-foreground'>No name yet</span>}</TableCell>
                  <TableCell>{r.email ?? ''}</TableCell>
                  <TableCell>{r.role ?? ''}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'active' ? 'default' : 'secondary'}>{STATUS_TITLE[r.status]}</Badge>
                  </TableCell>
                  <TableCell>{FACTOR_TITLE[r.factor]}</TableCell>
                  <TableCell>{r.createdAt.slice(0, 10)}</TableCell>
                  <TableCell className='text-end'>
                    {r.userId === me.userId ? (
                      <span className='text-sm text-muted-foreground'>This is you</span>
                    ) : r.role !== null && !isRole(r.role) ? (
                      <span className='text-sm text-muted-foreground'>This console does not know the role {r.role}</span>
                    ) : (
                      <div className='flex flex-wrap justify-end gap-2'>
                        {r.status === 'account-only' && (
                          <Button size='sm' variant='outline' onClick={() => setDoing({ kind: 'add', row: r })}>
                            Add to the list
                          </Button>
                        )}
                        {(r.status === 'invited' || r.status === 'off') && (
                          <Button
                            size='sm'
                            onClick={() => setDoing({ kind: 'on', row: r })}
                            disabled={!mayTurnOn(r)}
                            title={mayTurnOn(r) ? undefined : 'They have not set up an authenticator yet'}
                          >
                            Turn on
                          </Button>
                        )}
                        {r.status !== 'account-only' && (
                          <Button size='sm' variant='outline' onClick={() => setDoing({ kind: 'role', row: r })}>
                            Change role
                          </Button>
                        )}
                        {r.status === 'active' && (
                          <Button size='sm' variant='destructive' onClick={() => setDoing({ kind: 'off', row: r })}>
                            Switch off
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Invite open={doing?.kind === 'invite'} onOpenChange={close} onInvited={(i) => setInvited(i)} onDone={onChanged} />
      {row && doing && (doing.kind === 'on' || doing.kind === 'off') && (
        <WriteDialog
          open
          onOpenChange={close}
          title={doing.kind === 'on' ? `Turn on ${nameOf(row)}?` : `Switch off ${nameOf(row)}?`}
          blast={blastStaff(nameOf(row), roleOf(row), doing.kind === 'on', row.status === 'active')}
          guarded
          destructive={doing.kind === 'off'}
          confirmLabel={doing.kind === 'on' ? 'Turn on' : 'Switch off'}
          onConfirm={(w) =>
            admin.staffSet({ userId: row.userId, role: roleOf(row), displayName: nameOf(row), active: doing.kind === 'on', ...w })
          }
          onDone={onChanged}
        />
      )}
      {row && doing?.kind === 'role' && <ChangeRole row={row} onOpenChange={close} onDone={onChanged} />}
      {row && doing?.kind === 'add' && <AddExisting row={row} onOpenChange={close} onDone={onChanged} />}
      <ShownOnce
        open={invited !== null}
        title={invited ? `${invited.email} is invited` : ''}
        note='Shown once. Qrie keeps no copy of this password.'
        onDone={() => setInvited(null)}
      >
        {invited && (
          <div className='space-y-4 text-sm'>
            <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
              <dt className='text-muted-foreground'>Email</dt>
              <dd>{invited.email}</dd>
              <dt className='text-muted-foreground'>Temporary password</dt>
              <dd className='font-mono text-lg'>{invited.temporaryPassword}</dd>
            </dl>
            <ol className='list-decimal space-y-1 ps-5'>
              <li>Tell them the password by phone.</li>
              <li>They sign in at this address and set up an authenticator app.</li>
              <li>Call them, check it is them, then press Turn on.</li>
              <li>They change the password under Your account.</li>
            </ol>
          </div>
        )}
      </ShownOnce>
    </div>
  );
}

function RoleSelect({ id, value, onChange }: { id: string; value: StaffRole; onChange(r: StaffRole): void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as StaffRole)}>
      <SelectTrigger id={id} className='w-full'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAFF_ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A new staff sign-in (admin-api, after admin.staff_invite said yes as the owner): made switched off, its password shown once. */
function Invite({
  open,
  onOpenChange,
  onInvited,
  onDone,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onInvited(i: Invitation): void;
  onDone(): void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('safety');
  useEffect(() => {
    if (open) {
      setEmail('');
      setName('');
      setRole('safety');
    }
  }, [open]);
  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && name.trim().length >= 1 && name.trim().length <= 80;
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Invite a person'
      blast={blastInvite(name.trim() || 'This person', role)}
      guarded
      confirmLabel='Invite'
      canConfirm={ready}
      onConfirm={async (w) => {
        onInvited(await staff.invite({ email: email.trim(), displayName: name.trim(), role, ...w }));
      }}
      onDone={onDone}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1 sm:col-span-2'>
          <Label htmlFor='invite-email'>Email</Label>
          <Input id='invite-email' type='email' value={email} onChange={(e) => setEmail(e.target.value)} autoComplete='off' />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='invite-name'>Name</Label>
          <Input id='invite-name' value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='invite-role'>Role</Label>
          <RoleSelect id='invite-role' value={role} onChange={setRole} />
        </div>
      </div>
    </WriteDialog>
  );
}

function ChangeRole({ row, onOpenChange, onDone }: { row: RosterRow; onOpenChange(open: boolean): void; onDone(): void }) {
  const [role, setRole] = useState<StaffRole>(roleOf(row));
  const active = row.status === 'active';
  return (
    <WriteDialog
      open
      onOpenChange={onOpenChange}
      title={`Change ${nameOf(row)}'s role`}
      blast={blastStaff(nameOf(row), role, active, active)}
      guarded
      confirmLabel='Change the role'
      canConfirm={role !== row.role}
      onConfirm={(w) => admin.staffSet({ userId: row.userId, role, displayName: nameOf(row), active, ...w })}
      onDone={onDone}
    >
      <div className='space-y-1'>
        <Label htmlFor='staff-role'>Role</Label>
        <RoleSelect id='staff-role' value={role} onChange={setRole} />
      </div>
    </WriteDialog>
  );
}

/** An account made for staff but never put on the list (a half-finished invitation), added switched off. */
function AddExisting({ row, onOpenChange, onDone }: { row: RosterRow; onOpenChange(open: boolean): void; onDone(): void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('safety');
  const ready = name.trim().length >= 1 && name.trim().length <= 80;
  return (
    <WriteDialog
      open
      onOpenChange={onOpenChange}
      title={`Add ${row.email ?? row.userId.slice(0, 8)} to the list`}
      blast={blastAddExisting(name.trim() || 'This person', role)}
      guarded
      confirmLabel='Add to the list'
      canConfirm={ready}
      onConfirm={(w) => staff.addExisting({ userId: row.userId, role, displayName: name.trim(), ...w })}
      onDone={onDone}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label htmlFor='add-name'>Name</Label>
          <Input id='add-name' value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='add-role'>Role</Label>
          <RoleSelect id='add-role' value={role} onChange={setRole} />
        </div>
      </div>
    </WriteDialog>
  );
}
