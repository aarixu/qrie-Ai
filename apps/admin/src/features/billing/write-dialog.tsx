import { useState, type ReactNode } from 'react';
import { checkWrite } from '@/lib/confirm';
import { useMe } from '@/lib/me';
import { useGuarded } from '@/lib/stepup';
import { EXPECTED_ENV } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * EVERY BILLING WRITE GOES THROUGH THIS DIALOG.
 *
 * It shows what the write will do (the blast line), takes this write's own
 * reason and the typed environment, and runs checkWrite before anything is
 * sent, so p_env is the environment this build was made for. The write runs
 * inside useGuarded: when the database wants a fresh authenticator code it is
 * asked for, and the write runs once more. A guarded write says so up front.
 * An error from the fields (onConfirm throwing) or from the server is shown in
 * the dialog, which stays open. While `ready` is false (a read the write
 * depends on is still out), it cannot be confirmed.
 */
export function WriteDialog({
  title,
  blast,
  guarded,
  ready = true,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  blast: ReactNode;
  guarded?: boolean;
  ready?: boolean;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: (v: { env: string; reason: string }) => Promise<void>;
  onClose: () => void;
}) {
  const me = useMe();
  const runGuarded = useGuarded();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shownEnv = EXPECTED_ENV || me.environment;

  async function confirm() {
    if (!ready) return;
    const verdict = checkWrite({ expectedEnv: EXPECTED_ENV, databaseEnv: me.environment, typed, reason });
    if (!verdict.ok) {
      setError(verdict.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await runGuarded(() => onConfirm({ env: verdict.env, reason: verdict.reason }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <form
          className='space-y-4'
          onSubmit={(ev) => {
            ev.preventDefault();
            void confirm();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{blast}</DialogDescription>
          </DialogHeader>
          {children}
          {guarded && <p className='text-sm text-muted-foreground'>You will be asked for a fresh authenticator code.</p>}
          <div className='space-y-1'>
            <Label htmlFor='billing-reason'>Reason</Label>
            <Input id='billing-reason' value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Why are you doing this?' />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='billing-env'>
              Type <strong>{shownEnv}</strong> to confirm
            </Label>
            <Input id='billing-env' value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete='off' />
          </div>
          {error && (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type='submit' disabled={busy || !ready}>
              {busy ? 'Working…' : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
