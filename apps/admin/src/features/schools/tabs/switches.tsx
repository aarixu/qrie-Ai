import type { FlagRow, Me } from '@ai-tutor/admin-client';
import { useState } from 'react';
import { blastFollow, blastPause, blastSchoolSwitch } from '@/lib/blast';
import { admin } from '@/lib/client';
import { useMe } from '@/lib/me';
import { canClearFlag, canOperate, canSetFlag } from '@/lib/roles';
import { useLoad } from '@/lib/use-load';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadView } from '@/components/load-view';
import { WriteDialog } from '@/components/write-dialog';

interface Row {
  def: FlagRow;
  global: unknown;
  /** undefined: not set for this school, so the global value applies. */
  mine: unknown;
}

/**
 * The switches a school can have its own value for (admin.flag_list; set with
 * admin.flag_set for this school). A school's own value wins over the
 * platform's; Follow the platform clears it (admin.flag_clear, 0075), so the
 * platform's switch applies to the school again.
 */
export function SwitchesTab({ code, onChanged }: { code: string; onChanged(): void }) {
  const me = useMe();
  const { view, reload } = useLoad(() => admin.flagList(), [code]);
  const [pending, setPending] = useState<{ row: Row; value: unknown } | null>(null);
  const [following, setFollowing] = useState<Row | null>(null);

  return (
    <>
      <LoadView view={view} reload={reload}>
        {(flags) => {
          const rows: Row[] = [];
          for (const f of flags) {
            if (!f.schoolScoped || rows.some((r) => r.def.key === f.key)) continue;
            const of = flags.filter((x) => x.key === f.key);
            const g = of.find((x) => x.scope === 'global');
            const mine = of.find((x) => x.scope === 'school' && x.scopeId === code);
            rows.push({ def: f, global: g ? g.value : f.safeDefault, mine: mine ? mine.value : undefined });
          }
          return rows.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No switch can be set for one school.</p>
          ) : (
            <Card className='py-0'>
              <CardContent className='px-0'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Switch</TableHead>
                      <TableHead>Everywhere</TableHead>
                      <TableHead>At {code}</TableHead>
                      <TableHead className='text-end'>Change it here</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.def.key}>
                        <TableCell className='align-top whitespace-normal'>
                          <div className='font-mono text-xs'>
                            {r.def.key}
                            {r.def.guarded && (
                              <Badge variant='outline' className='ms-2 font-sans'>
                                guarded
                              </Badge>
                            )}
                          </div>
                          <div className='text-sm text-muted-foreground'>{r.def.description}</div>
                        </TableCell>
                        <TableCell className='align-top font-mono text-xs'>{JSON.stringify(r.global)}</TableCell>
                        <TableCell className='align-top text-sm'>
                          {r.mine === undefined ? (
                            <span className='text-muted-foreground'>Not set: the global value applies</span>
                          ) : (
                            <div className='flex flex-wrap items-center gap-2'>
                              <span className='font-mono text-xs'>{JSON.stringify(r.mine)}</span>
                              {canClearFlag(me.role, r.def.key, r.mine, r.global) && (
                                <Button variant='outline' size='sm' onClick={() => setFollowing(r)}>
                                  Follow the platform
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className='text-end align-top'>
                          {canOperate(me.role) ? (
                            <Editor row={r} role={me.role} onPropose={(value) => setPending({ row: r, value })} />
                          ) : (
                            <span className='text-sm text-muted-foreground'>Owner and ops only</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        }}
      </LoadView>
      <WriteDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? `Set ${pending.row.def.key} at ${code} to ${JSON.stringify(pending.value)}?` : ''}
        blast={
          pending
            ? pending.row.def.key === 'tutor.enabled'
              ? blastPause(code, pending.value === true)
              : blastSchoolSwitch(code)
            : ''
        }
        guarded={pending?.row.def.guarded ?? false}
        confirmLabel='Change it'
        onConfirm={async (w) => {
          if (pending) await admin.flagSet({ key: pending.row.def.key, scope: 'school', scopeId: code, value: pending.value, ...w });
        }}
        onDone={() => {
          setPending(null);
          reload();
          onChanged();
        }}
      />
      <WriteDialog
        open={following !== null}
        onOpenChange={(o) => !o && setFollowing(null)}
        title={following ? `Clear ${code}'s own ${following.def.key}?` : ''}
        blast={
          following
            ? following.def.key === 'tutor.enabled'
              ? blastFollow(code, following.global !== false)
              : `${code} follows the platform's value again: ${JSON.stringify(following.global)}.`
            : ''
        }
        guarded={following?.def.guarded ?? false}
        confirmLabel='Follow the platform'
        onConfirm={async (w) => {
          if (following) await admin.flagClear({ key: following.def.key, scopeId: code, ...w });
        }}
        onDone={() => {
          setFollowing(null);
          reload();
          onChanged();
        }}
      />
    </>
  );
}

function Editor({ row, role, onPropose }: { row: Row; role: Me['role']; onPropose(value: unknown): void }) {
  const current = row.mine === undefined ? row.global : row.mine;
  const [text, setText] = useState(typeof current === 'string' ? current : '');
  if (row.def.kind === 'bool') {
    // An off switch that only the owner may turn on (tutor.enabled) stays put for everyone else.
    if (current !== true && !canSetFlag(role, row.def.key, true)) {
      return <span className='text-sm text-muted-foreground'>Off. The owner turns it on.</span>;
    }
    return <Switch checked={current === true} onCheckedChange={(on) => onPropose(on)} aria-label={`${row.def.key} at this school`} />;
  }
  return (
    <div className='flex justify-end gap-2'>
      <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={280} aria-label='Value' className='w-48' />
      <Button variant='outline' onClick={() => onPropose(text)}>
        Save
      </Button>
    </div>
  );
}
