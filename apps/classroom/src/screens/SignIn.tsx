import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CartoonAvatar } from '../avatar/CartoonAvatar';
import { Icon } from '../ui/Icon';
import { createAccount, isAnonymous, sendPasswordReset, signInWithPassword } from '../lib/supabase';

/**
 * KEEPING THE WORK, NOT GUARDING THE APP.
 *
 * Nothing here unlocks a feature. A student who never signs in loses no lesson,
 * no question and no streak — they lose the COPY, which is why the screen says
 * what it is for in its first line instead of demanding an account for its own
 * sake.
 *
 * Email and password, not the code this screen used to send. A one-time code is
 * pleasant and it depends on mail arriving within a minute, every single time a
 * student opens the app on a new device — on a shared phone with patchy signal
 * that is a wall, not a convenience.
 *
 * THE THING THIS SCREEN MUST NOT GET WRONG: the student already has an
 * identity. It is anonymous, it owns their ledger, their organization and their
 * plan, and `createAccount` attaches the email to THAT identity rather than
 * minting a second one. Signing up is an upgrade, not a fresh start, and the
 * copy says so — because a student who believes they are starting over will
 * hesitate before they do it.
 */

type Mode = 'join' | 'signin';

const MIN_PASSWORD = 8;

export function SignIn() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('join');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Whether there is work to carry across. It changes what this screen
  // PROMISES, so it is read rather than assumed.
  const [carrying, setCarrying] = useState(false);

  useEffect(() => {
    void isAnonymous().then(setCarrying);
  }, []);

  const submit = async (): Promise<void> => {
    const address = email.trim();
    if (!address.includes('@')) {
      setProblem('That address is missing an @.');
      return;
    }
    if (mode === 'join' && password.length < MIN_PASSWORD) {
      setProblem(`Make the password at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    setProblem(null);
    setNote(null);
    const failed =
      mode === 'join'
        ? await createAccount(address, password)
        : await signInWithPassword(address, password);
    setBusy(false);
    if (failed) {
      setProblem(failed);
      return;
    }
    navigate('/', { replace: true });
  };

  const reset = async (): Promise<void> => {
    const address = email.trim();
    if (!address.includes('@')) {
      setProblem('Type your address first, then tap this.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const failed = await sendPasswordReset(address);
    setBusy(false);
    if (failed) setProblem(failed);
    else setNote('Check your email for a link to set a new password.');
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
          <CartoonAvatar pose="greet" className="w-full h-full" />
        </div>

        <h1 className="font-headline-md text-headline-md font-bold text-on-background mt-2">
          {mode === 'join' ? 'Keep your progress' : 'Welcome back'}
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-2 max-w-[32ch]">
          {mode === 'join'
            ? carrying
              ? 'Everything you have already done comes with you — nothing starts over.'
              : 'Your streak, notes and everything you have answered move with you to any device.'
            : 'Sign in and your work comes back.'}
        </p>

        <div className="w-full mt-stack-lg flex flex-col gap-3">
          <input
            autoFocus
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Your email address"
            className="h-14 px-4 rounded-2xl bg-surface-variant text-on-surface font-body-md text-[16px] text-center outline-none focus:ring-2 focus:ring-primary"
          />

          <input
            type="password"
            // The browser's own password manager is the only thing standing
            // between a fourteen-year-old and reusing a password from somewhere
            // else, so it is told exactly which flow this is.
            autoComplete={mode === 'join' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder={mode === 'join' ? `At least ${MIN_PASSWORD} characters` : 'Your password'}
            aria-label="Your password"
            className="h-14 px-4 rounded-2xl bg-surface-variant text-on-surface font-body-md text-[16px] text-center outline-none focus:ring-2 focus:ring-primary"
          />

          {problem && (
            <p role="alert" className="font-body-md text-body-md text-error">
              {problem}
            </p>
          )}
          {note && (
            <p role="status" className="font-body-md text-body-md text-on-surface-variant">
              {note}
            </p>
          )}

          <button
            onClick={() => void submit()}
            disabled={busy}
            className="h-14 rounded-2xl bg-primary text-on-primary font-label-md text-label-md font-bold border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all disabled:opacity-60"
          >
            {busy ? 'One moment…' : mode === 'join' ? 'Create my account' : 'Sign in'}
          </button>

          <button
            onClick={() => {
              setMode(mode === 'join' ? 'signin' : 'join');
              setProblem(null);
              setNote(null);
            }}
            className="font-label-md text-label-md text-on-surface-variant py-2"
          >
            {mode === 'join' ? 'I already have an account' : 'I am new here'}
          </button>

          {mode === 'signin' && (
            <button
              onClick={() => void reset()}
              disabled={busy}
              className="font-label-sm text-label-sm text-on-surface-variant py-1 disabled:opacity-60"
            >
              I forgot my password
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
