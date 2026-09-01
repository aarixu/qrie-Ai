import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CartoonAvatar } from '../avatar/CartoonAvatar';
import { Icon } from '../ui/Icon';
import { sendEmailOtp, verifyEmailOtp } from '../lib/supabase';

/**
 * KEEPING THE WORK, NOT GUARDING THE APP.
 *
 * Nothing here unlocks a feature. A student who never signs in loses no
 * lesson, no question and no streak — they lose the COPY, which is why the
 * screen says what it is for in its first line instead of demanding an
 * account for its own sake.
 *
 * Two steps because it is two steps for the student: an address, then the
 * code that arrives in it. No password to invent and forget; a code that
 * expires is both easier and safer than a secret a fourteen-year-old will
 * reuse from somewhere else.
 */

type Step = 'email' | 'code';

export function SignIn() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async (): Promise<void> => {
    const address = email.trim();
    if (!address.includes('@')) {
      setProblem('That address is missing an @.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const failed = await sendEmailOtp(address);
    setBusy(false);
    if (failed) {
      setProblem(failed);
      return;
    }
    setStep('code');
  };

  const verify = async (): Promise<void> => {
    const typed = code.trim();
    if (typed.length < 6) {
      setProblem('The code is six digits.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const failed = await verifyEmailOtp(email.trim(), typed);
    setBusy(false);
    if (failed) {
      setProblem(failed);
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md px-margin-mobile py-6">
      <button
        onClick={() => navigate(-1)}
        aria-label="Go back"
        className="w-10 h-10 rounded-full grid place-items-center hover:bg-surface-variant transition-colors"
      >
        <Icon name="arrow_back" className="text-[22px]" />
      </button>

      <div className="max-w-[380px] mx-auto flex flex-col items-center text-center mt-2">
        <div className="w-[130px] h-[150px]" aria-hidden>
          <CartoonAvatar pose={step === 'code' ? 'think' : 'greet'} className="w-full h-full" />
        </div>

        <h1 className="font-headline-md text-headline-md font-bold text-on-background mt-2">
          {step === 'email' ? 'Keep your progress' : 'Check your email'}
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-2 max-w-[32ch]">
          {step === 'email'
            ? 'Your streak, notes and everything you have answered move with you to any device.'
            : `We sent a six-digit code to ${email.trim()}.`}
        </p>

        <div className="w-full mt-stack-lg flex flex-col gap-3">
          {step === 'email' ? (
            <input
              autoFocus
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              placeholder="you@example.com"
              aria-label="Your email address"
              className="h-14 px-4 rounded-2xl bg-surface-variant text-on-surface font-body-md text-[16px] text-center outline-none focus:ring-2 focus:ring-primary"
            />
          ) : (
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && void verify()}
              placeholder="000000"
              aria-label="The six-digit code"
              className="h-14 px-4 rounded-2xl bg-surface-variant text-on-surface font-headline-md text-[26px] font-bold tracking-[0.4em] text-center outline-none focus:ring-2 focus:ring-primary"
            />
          )}

          {problem && (
            <p role="alert" className="font-body-md text-body-md text-error">
              {problem}
            </p>
          )}

          <button
            onClick={() => void (step === 'email' ? send() : verify())}
            disabled={busy}
            className="h-14 rounded-2xl bg-primary text-on-primary font-label-md text-label-md font-bold border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all disabled:opacity-60"
          >
            {busy ? 'One moment…' : step === 'email' ? 'Send me a code' : 'Sign in'}
          </button>

          {step === 'code' && (
            <button
              onClick={() => {
                setStep('email');
                setCode('');
                setProblem(null);
              }}
              className="font-label-md text-label-md text-on-surface-variant py-2"
            >
              Use a different address
            </button>
          )}
        </div>

        <p className="font-label-sm text-label-sm text-on-surface-variant mt-stack-lg max-w-[30ch]">
          You can keep studying without signing in. Nothing here is locked.
        </p>
      </div>
    </div>
  );
}
