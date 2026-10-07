import { useEffect, useState, type ReactNode } from 'react';
import { checkWrite } from '@/lib/confirm';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * THE ONE WRITE DIALOG of the schools, users, system and staff pages, in the
 * style of the switches page's confirmation: what will happen (the blast line),
 * any fields of its own, a reason, and the environment typed out. Confirming
 * runs checkWrite (lib/confirm.ts) and then the write through useGuarded, so a
 * guarded write that wants a fresh authenticator code asks for one and retries.
 * The write gets the reason and the environment this build was made for.
 */
export interface WriteDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  blast: string;
  /** Needs a fresh authenticator code: said under the blast line. */
  guarded?: boolean;
  confirmLabel: string;
  destructive?: boolean;
  /** False while the dialog's own fields are not ready. */
  canConfirm?: boolean;
  onConfirm(w: { reason: string; env: string }): Promise<void>;
  /** After a successful write, once the dialog has closed. */
  onDone?(): void;
  children?: ReactNode;
}

export function WriteDialog({
  open,
  onOpenChange,
  title,
  blast,
  guarded: isGuarded = false,
  confirmLabel,
  destructive = false,
  canConfirm = true,
  onConfirm,
  onDone,
  children,
}: WriteDialogProps) {
  const me = useMe();
  const guarded = useGuarded();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shownEnv = EXPECTED_ENV || me.environment;

  useEffect(() => {
    if (open) {
      setReason('');
      setTyped('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  async function confirm() {
    const verdict = checkWrite({ expectedEnv: EXPECTED_ENV, databaseEnv: me.environment, typed, reason });
    if (!verdict.ok) {
      setError(verdict.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await guarded(() => onConfirm({ reason: verdict.reason, env: verdict.env }));
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent className='max-h-[90vh] overflow-y-auto'>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{blast}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className='space-y-3'>
          {isGuarded && <p className='text-sm text-muted-foreground'>This needs a fresh authenticator code.</p>}
          {children}
          <div className='space-y-1'>
            <Label htmlFor='write-reason'>Reason</Label>
            <Input id='write-reason' value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Why are you doing this?' />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='write-env'>
              Type <strong>{shownEnv}</strong> to confirm
            </Label>
            <Input id='write-env' value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete='off' />
          </div>
          {error && (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={busy || !canConfirm} onClick={() => void confirm()}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
