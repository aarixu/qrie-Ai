import type { FlagRow } from '@ai-tutor/admin-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { admin } from '@/lib/client';
import { useMe } from '@/lib/me';
import { useGuarded } from '@/lib/stepup';
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

/**
 * The remote switches every app reads. Only the global value is edited here; a
 * school's own value is shown, and is set from that school's page (plan 2).
 * Every change needs a reason, is audited with the value before and after, and a
 * guarded one asks for a fresh authenticator code.
 */
export function Switches() {
  const me = useMe();
  const guarded = useGuarded();
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [reason, setReason] = useState('');

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

  async function save(g: Group, value: unknown) {
    if (reason.trim().length < 3) {
      toast.error('Say why in the reason box first.');
      return;
    }
    try {
      await guarded(() => admin.flagSet({ key: g.key, scope: 'global', value, reason: reason.trim(), env: me.environment }));
      toast.success(`${g.key} saved.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <AdminPage title='Switches'>
      <div className='mb-4 max-w-md space-y-1'>
        <Label htmlFor='reason'>Reason for the next change</Label>
        <Input id='reason' value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Why are you changing this?' />
      </div>
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
                    <Editor kind={g.def.kind} value={g.global ? g.global.value : g.def.safeDefault} onSave={(v) => void save(g, v)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

function Editor({ kind, value, onSave }: { kind: FlagRow['kind']; value: unknown; onSave: (v: unknown) => void }) {
  const [text, setText] = useState(typeof value === 'string' ? value : '');
  if (kind === 'bool') {
    return <Switch checked={value === true} onCheckedChange={(on) => onSave(on)} aria-label='On or off' />;
  }
  if (kind === 'tone') {
    return (
      <Select value={String(value)} onValueChange={(v) => onSave(v)}>
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
      <Button variant='outline' onClick={() => onSave(text)}>
        Save
      </Button>
    </div>
  );
}
