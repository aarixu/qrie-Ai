import type { FlagRow } from '@ai-tutor/admin-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { admin } from '@/lib/client';
import { checkWrite, describeFlagChange } from '@/lib/confirm';
import { useMe } from '@/lib/me';
import { useGuarded } from '@/lib/stepup';
import { EXPECTED_ENV } from '@/lib/supabase';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';

interface Group {
  key: string;
  def: FlagRow;
  global: FlagRow | undefined;
  schools: FlagRow[];
}

interface Pending {
  group: Group;
  value: unknown;
}

/**
 * The remote switches every app reads. Only the global value is edited here; a
 * school's own value is shown, and is set from that school's page (plan 2).
 * Touching a control changes nothing by itself: it opens a confirmation that says
 * what every app will do, and asks for this change's own reason and the typed
 * environment. Each change is audited with the value before and after, and a
 * guarded one asks for a fresh authenticator code.
 */
export function Switches() {
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await admin.flagList());
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo<Group[]>(() => {
    const by = new Map<string, Group>();
    for (const r of rows) {
      const g = by.get(r.key) ?? { key: r.key, def: r, global: undefined, schools: [] };
      if (r.scope === 'global') g.global = r;
      if (r.scope === 'school') g.schools.push(r);
      by.set(r.key, g);
    }
    return [...by.values()];
  }, [rows]);

  return (
    <AdminPage title='Switches'>
      <Card className='py-0'>
        <CardContent className='px-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Switch</TableHead>
                <TableHead>What it does</TableHead>
                <TableHead className='text-end'>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.key}>
                  <TableCell className='align-top font-mono text-xs'>
                    {g.key}
                    {g.def.guarded && (
                      <Badge variant='outline' className='ms-2 font-sans'>
                        guarded
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className='align-top text-sm whitespace-normal'>
                    {g.def.description}
                    {!g.global && <div className='text-xs text-muted-foreground'>Not set: the apps use the safe default.</div>}
                    {g.schools.length > 0 && (
                      <div className='text-xs text-muted-foreground'>
                        {g.schools.map((s) => `${s.scopeId}: ${JSON.stringify(s.value)}`).join(' · ')}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className='text-end align-top'>
                    <Editor
                      kind={g.def.kind}
                      value={g.global ? g.global.value : g.def.safeDefault}
                      onPropose={(v) => setPending({ group: g, value: v })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {pending && (
        <ConfirmChange
          key={`${pending.group.key}:${JSON.stringify(pending.value)}`}
          pending={pending}
          onClose={() => setPending(null)}
          onSaved={() => {
            setPending(null);
            void load();
          }}
        />
      )}
    </AdminPage>
  );
}

function ConfirmChange({ pending, onClose, onSaved }: { pending: Pending; onClose: () => void; onSaved: () => void }) {
  const me = useMe();
  const guarded = useGuarded();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { group, value } = pending;
  const shownEnv = EXPECTED_ENV || me.environment;

  async function confirm() {
    const verdict = checkWrite({ expectedEnv: EXPECTED_ENV, databaseEnv: me.environment, typed, reason });
    if (!verdict.ok) {
      setError(verdict.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await guarded(() => admin.flagSet({ key: group.key, scope: 'global', value, reason: verdict.reason, env: verdict.env }));
      toast.success(`${group.key} saved.`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Change <span className='font-mono'>{group.key}</span> to {JSON.stringify(value)}?
          </AlertDialogTitle>
          <AlertDialogDescription>{describeFlagChange(group.key, value)}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className='space-y-3'>
          {group.def.guarded && <p className='text-sm text-muted-foreground'>This switch is guarded: you will be asked for a fresh authenticator code.</p>}
          <div className='space-y-1'>
            <Label htmlFor='flag-reason'>Reason</Label>
            <Input id='flag-reason' value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Why are you changing this?' />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='flag-env'>
              Type <strong>{shownEnv}</strong> to confirm
            </Label>
            <Input id='flag-env' value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete='off' />
          </div>
          {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Saving…' : 'Change it'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Editor({ kind, value, onPropose }: { kind: FlagRow['kind']; value: unknown; onPropose: (v: unknown) => void }) {
  const [text, setText] = useState(typeof value === 'string' ? value : '');
  if (kind === 'bool') {
    return <Switch checked={value === true} onCheckedChange={(on) => onPropose(on)} aria-label='On or off' />;
  }
  if (kind === 'tone') {
    return (
      <Select value={String(value)} onValueChange={(v) => onPropose(v)}>
        <SelectTrigger className='ms-auto w-32' aria-label='Tone'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='info'>info</SelectItem>
          <SelectItem value='warning'>warning</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  return (
    <div className='flex justify-end gap-2'>
      <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={280} aria-label='Value' className='w-56' />
      <Button variant='outline' onClick={() => onPropose(text)}>
        Save
      </Button>
    </div>
  );
}
