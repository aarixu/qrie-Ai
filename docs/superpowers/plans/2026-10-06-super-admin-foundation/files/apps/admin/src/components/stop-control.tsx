import type { RelayStatus } from '@ai-tutor/admin-client';
import { useState } from 'react';
import { toast } from 'sonner';
import { admin } from '@/lib/client';
import { useMe } from '@/lib/me';
import { useGuarded } from '@/lib/stepup';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * STOP THE TUTOR, OR RESUME IT. Stopping is one tap for anybody on staff, with a
 * reason already filled in. Resuming is for the owner, and asks for a fresh
 * authenticator code. Both make the person type which environment they are in,
 * so a stop meant for a test database never lands on the live one.
 */
export function StopControl({ status, onChanged }: { status: RelayStatus; onChanged: () => void }) {
  const me = useMe();
  const guarded = useGuarded();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const stopping = !status.halted;
  const mayResume = me.role === 'owner';

  function begin() {
    setReason(stopping ? 'Stopped from the control panel' : '');
    setTyped('');
    setError('');
    setOpen(true);
  }

  async function confirm() {
    if (typed !== me.environment) {
      setError(`Type ${me.environment} to confirm.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await guarded(() => admin.setHalt(stopping, reason, me.environment));
      setOpen(false);
      toast.success(stopping ? 'The tutor is stopped.' : 'The tutor is running again.');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {stopping ? (
        <Button variant='destructive' onClick={begin}>
          Stop the tutor
        </Button>
      ) : (
        <Button onClick={begin} disabled={!mayResume} title={mayResume ? undefined : 'Only the owner can resume the tutor'}>
          Resume the tutor
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{stopping ? 'Stop the tutor?' : 'Resume the tutor?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {stopping
                ? `Every child's class pauses within a moment${status.studentsNow ? `; ${status.studentsNow} are learning right now` : ''}. Children can still send a report.`
                : 'Classes start again for everyone on the next request.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Label htmlFor='stop-reason'>Reason</Label>
              <Input id='stop-reason' value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='stop-env'>
                Type <strong>{me.environment}</strong> to confirm
              </Label>
              <Input id='stop-env' value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete='off' />
            </div>
            {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant={stopping ? 'destructive' : 'default'} disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Working…' : stopping ? 'Stop now' : 'Resume now'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
