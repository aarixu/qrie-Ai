import type { AuditFilter, AuditRow, RosterRow } from '@ai-tutor/admin-client';
import { useState, type FormEvent } from 'react';
import { staff } from '@/lib/client';
import { csvName, downloadCsv } from '@/lib/csv';
import { useMe } from '@/lib/me';
import { auditCsv, AUDIT_DOWNLOAD_MAX, AUDIT_PAGE, collectAudit } from '@/lib/staff-view';
import { EXPECTED_ENV } from '@/lib/supabase';
import { istTime, istToday } from '@/lib/time';
import { useLoad } from '@/lib/use-load';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadView } from '@/components/load-view';

const ANYONE = 'anyone';
const SHOWN = 100;

/**
 * The audit log, newest first (admin.audit_list; the owner): filtered by
 * person, by the start of an action's name, and by India's days. "Show
 * older" asks for entries before the smallest id on screen; the download
 * saves up to 5000 entries of the same filter as a CSV file on this computer.
 */
export function AuditLog({ people }: { people: RosterRow[] }) {
  const me = useMe();
  const [actor, setActor] = useState(ANYONE);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState<AuditFilter>({});
  const first = useLoad(() => staff.auditList({ ...filter, limit: SHOWN }), [filter]);
  const [older, setOlder] = useState<AuditRow[]>([]);
  const [more, setMore] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (ev: FormEvent) => {
    ev.preventDefault();
    setOlder([]);
    setMore(true);
    setNote('');
    setFilter({
      actor: actor === ANYONE ? undefined : actor,
      action: action.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  };

  async function showOlder(rows: AuditRow[]) {
    setNote('');
    try {
      const next = await staff.auditList({ ...filter, before: Math.min(...rows.map((r) => r.id)), limit: SHOWN });
      setOlder((o) => [...o, ...next]);
      if (next.length < SHOWN) setMore(false);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }

  async function download() {
    setBusy(true);
    setNote('');
    try {
      const rows = await collectAudit((before) => staff.auditList({ ...filter, before, limit: AUDIT_PAGE }));
      downloadCsv(csvName('audit', EXPECTED_ENV || me.environment, istToday()), auditCsv(rows));
      setNote(
        rows.length >= AUDIT_DOWNLOAD_MAX
          ? `Saved the newest ${rows.length} entries. Narrow the dates to get older ones.`
          : `Saved ${rows.length} entries.`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='space-y-4'>
      <form onSubmit={apply} className='grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5'>
        <div className='space-y-1'>
          <Label htmlFor='audit-actor'>Person</Label>
          <Select value={actor} onValueChange={setActor}>
            <SelectTrigger id='audit-actor' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANYONE}>Anyone</SelectItem>
              {people
                .filter((p) => p.role !== null)
                .map((p) => (
                  <SelectItem key={p.userId} value={p.userId}>
                    {p.displayName ?? p.email ?? p.userId.slice(0, 8)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label htmlFor='audit-action'>Action starts with</Label>
          <Input id='audit-action' value={action} onChange={(e) => setAction(e.target.value)} placeholder='school-' className='font-mono' />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='audit-from'>From (India)</Label>
          <Input id='audit-from' type='date' value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='audit-to'>To (India)</Label>
          <Input id='audit-to' type='date' value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className='flex gap-2'>
          <Button type='submit' variant='outline'>
            Show
          </Button>
          <Button type='button' variant='outline' disabled={busy} onClick={() => void download()}>
            {busy ? 'Saving…' : 'Download as CSV'}
          </Button>
        </div>
      </form>
      {note && <p className='text-sm text-muted-foreground'>{note}</p>}
      <LoadView view={first.view} reload={first.reload}>
        {(rows) => {
          const all = [...rows, ...older];
          return all.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No entries.</p>
          ) : (
            <Card className='py-0'>
              <CardContent className='px-0'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When (India)</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {all.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className='align-top whitespace-nowrap'>{istTime(r.at)}</TableCell>
                        <TableCell className='align-top'>{r.actorName}</TableCell>
                        <TableCell className='align-top'>{r.actorRole}</TableCell>
                        <TableCell className='align-top font-mono text-xs'>{r.action}</TableCell>
                        <TableCell className='align-top font-mono text-xs'>
                          {r.targetKind} {r.targetId}
                        </TableCell>
                        <TableCell className='max-w-64 align-top whitespace-normal'>{r.reason}</TableCell>
                        <TableCell className='align-top'>
                          {Object.keys(r.details).length > 0 && (
                            <details>
                              <summary className='cursor-pointer text-xs text-muted-foreground'>Show</summary>
                              <pre className='max-w-80 overflow-x-auto text-xs whitespace-pre-wrap'>{JSON.stringify(r.details, null, 2)}</pre>
                            </details>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {more && all.length >= SHOWN && (
                  <div className='px-6 py-3'>
                    <Button variant='outline' size='sm' onClick={() => void showOlder(all)}>
                      Show older
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        }}
      </LoadView>
    </div>
  );
}
