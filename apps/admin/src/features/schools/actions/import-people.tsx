import type { ImportResult } from '@ai-tutor/admin-client';
import { useEffect, useState } from 'react';
import { blastImport } from '@/lib/blast';
import { schools } from '@/lib/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WriteDialog } from '@/components/write-dialog';
import { ShownOnce } from './shown-once';

/**
 * Add people from the school's sheets (CSV), as the school admin's import
 * does, through admin-api and the LMS lane's own code (owner and ops). First
 * a check, which changes nothing; then the commit, which makes the sign-ins
 * and shows their PINs once.
 */
export function ImportPeople({
  code,
  open,
  onOpenChange,
  onDone,
}: {
  code: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void;
}) {
  const [students, setStudents] = useState<string | undefined>();
  const [teachers, setTeachers] = useState<string | undefined>();
  const [checked, setChecked] = useState<ImportResult | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [created, setCreated] = useState<ImportResult['created'] | null>(null);

  useEffect(() => {
    if (open) {
      setStudents(undefined);
      setTeachers(undefined);
      setChecked(null);
      setAccepted(false);
      setError('');
    }
  }, [open]);

  const read = (set: (text: string | undefined) => void) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    set(file ? await file.text() : undefined);
    setChecked(null);
    setAccepted(false);
  };

  async function check() {
    setBusy(true);
    setError('');
    try {
      setChecked(await schools.importPeople({ code, students, teachers, commit: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const newPeople = checked ? checked.people.filter((p) => p.status === 'new').length : 0;
  const mayAdd = checked !== null && checked.errors.length === 0 && newPeople > 0 && (checked.warnings.length === 0 || accepted);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Add people to {code}</DialogTitle>
            <DialogDescription>The school&apos;s students and teachers sheets, as CSV files. Checking changes nothing.</DialogDescription>
          </DialogHeader>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='import-students'>Students sheet</Label>
              <Input id='import-students' type='file' accept='.csv,text/csv' onChange={(e) => void read(setStudents)(e)} />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='import-teachers'>Teachers sheet</Label>
              <Input id='import-teachers' type='file' accept='.csv,text/csv' onChange={(e) => void read(setTeachers)(e)} />
            </div>
          </div>
          {error && (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {checked && (
            <div className='space-y-3 text-sm'>
              <p>
                {checked.people.length} people in the sheets: {newPeople} new, {checked.people.length - newPeople} already at the school.
                {checked.seats && ` Seats: ${checked.seats.used} in use of ${checked.seats.total}; these sheets take ${checked.seats.adding}.`}
              </p>
              {checked.errors.length > 0 && (
                <div>
                  <p className='font-medium text-destructive'>Mistakes to fix in the sheet first</p>
                  <ul className='list-disc ps-5'>
                    {checked.errors.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {checked.warnings.length > 0 && (
                <div>
                  <p className='font-medium'>Warnings</p>
                  <ul className='list-disc ps-5'>
                    {checked.warnings.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                  <label className='mt-2 flex items-center gap-2'>
                    <Checkbox checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} />I have read the warnings
                  </label>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant='outline' disabled={busy || (!students && !teachers)} onClick={() => void check()}>
              {busy ? 'Checking…' : 'Check'}
            </Button>
            <Button disabled={!mayAdd} onClick={() => setCommitting(true)}>
              Add {newPeople} {newPeople === 1 ? 'person' : 'people'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <WriteDialog
        open={committing}
        onOpenChange={setCommitting}
        title={`Add ${newPeople} ${newPeople === 1 ? 'person' : 'people'} to ${code}?`}
        blast={blastImport(code, newPeople)}
        confirmLabel='Add them'
        onConfirm={async (w) => {
          const done = await schools.importPeople({ code, students, teachers, commit: true, acceptWarnings: accepted, ...w });
          setCreated(done.created);
        }}
        onDone={() => {
          onOpenChange(false);
          onDone();
        }}
      />
      <ShownOnce open={created !== null} title={`New sign-ins at ${code}`} printable onDone={() => setCreated(null)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Login ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Roll</TableHead>
              <TableHead>PIN</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(created ?? []).map((c) => (
              <TableRow key={c.loginId}>
                <TableCell className='font-mono'>{c.loginId}</TableCell>
                <TableCell>{c.displayName}</TableCell>
                <TableCell>{c.className ?? ''}</TableCell>
                <TableCell>{c.roll ?? ''}</TableCell>
                <TableCell className='font-mono text-base'>{c.pin}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ShownOnce>
    </>
  );
}
