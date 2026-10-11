import { AdminError } from '@ai-tutor/admin-client';
import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { verifyCode } from './mfa.ts';

/**
 * A guarded action (resume the tutor, move the ceiling, flip a guarded switch)
 * wants the authenticator code verified a moment ago. When the database says so
 * (AdminError code 'needs-mfa'), this asks for a fresh code, verifies it, and runs
 * the action again, once. Any other error passes through untouched.
 */
interface StepUp {
  guarded: <T>(action: () => Promise<T>) => Promise<T>;
}

const Ctx = createContext<StepUp | null>(null);

export function useGuarded(): StepUp['guarded'] {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGuarded needs a StepUpProvider');
  return v.guarded;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const resolver = useRef<((code: string | null) => void) | null>(null);

  const ask = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        resolver.current = resolve;
        setCode('');
        setError('');
        setOpen(true);
      }),
    [],
  );

  const close = (value: string | null) => {
    setOpen(false);
    resolver.current?.(value);
    resolver.current = null;
  };

  const guarded = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (e) {
        if (!(e instanceof AdminError) || e.code !== 'needs-mfa') throw e;
        const entered = await ask();
        if (!entered) throw e;
        await verifyCode(entered);
        return action();
      }
    },
    [ask],
  );

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6 digits from your authenticator app.');
      return;
    }
    close(code);
  };

  return (
    <Ctx.Provider value={{ guarded }}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && close(null)}>
        <DialogContent className='sm:max-w-sm'>
          <form onSubmit={submit} className='space-y-4'>
            <DialogHeader>
              <DialogTitle>Confirm it is you</DialogTitle>
              <DialogDescription>This action needs a fresh code from your authenticator app.</DialogDescription>
            </DialogHeader>
            <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus aria-label='6-digit code' containerClassName='justify-center'>
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            {error && <p className='text-sm text-destructive'>{error}</p>}
            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => close(null)}>
                Cancel
              </Button>
              <Button type='submit'>Confirm</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}
