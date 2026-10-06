import { useEffect, useState, type FormEvent } from 'react';
import { browserStore, markActive } from '@/lib/idle-store';
import { finishEnrolment, startEnrolment, verifyCode, type Enrolment } from '@/lib/mfa';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { AuthCard } from './auth-card';

/**
 * The second factor. `enrol-factor`: show a QR code once and ask for the first
 * code. `verify-factor`: ask for the current code. Either way the session becomes
 * aal2 and the gate moves on by itself (supabase-js announces the change).
 */
export function Factor({ mode }: { mode: 'enrol-factor' | 'verify-factor' }) {
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'enrol-factor') return;
    let cancelled = false;
    startEnrolment()
      .then((e) => !cancelled && setEnrolment(e))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6 digits from your authenticator app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'enrol-factor') {
        if (!enrolment) throw new Error('Wait for the QR code to appear.');
        await finishEnrolment(enrolment.factorId, code);
      } else {
        await verifyCode(code);
      }
      markActive(browserStore(), Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={mode === 'enrol-factor' ? 'Set up your authenticator' : 'Enter your code'}
      description={
        mode === 'enrol-factor'
          ? 'Scan this with an authenticator app (not SMS). You will need it every time you sign in.'
          : 'The 6-digit code from your authenticator app.'
      }
    >
      <form onSubmit={submit} className='space-y-4'>
        {mode === 'enrol-factor' &&
          (enrolment ? (
            <div className='space-y-2'>
              <img src={enrolment.qr} alt='QR code for your authenticator app' className='mx-auto size-44 rounded bg-white p-2' />
              <p className='break-all text-center font-mono text-xs text-muted-foreground'>{enrolment.secret}</p>
            </div>
          ) : (
            !error && <p className='text-sm text-muted-foreground'>Preparing…</p>
          ))}
        <InputOTP maxLength={6} value={code} onChange={setCode} aria-label='6-digit code' containerClassName='justify-center'>
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
        <Button type='submit' className='w-full' disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
        <Button type='button' variant='link' className='w-full' onClick={() => void supabase.auth.signOut()}>
          Sign out
        </Button>
      </form>
    </AuthCard>
  );
}
