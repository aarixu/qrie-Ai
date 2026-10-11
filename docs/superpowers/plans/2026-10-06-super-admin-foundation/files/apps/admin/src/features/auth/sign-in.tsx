import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from './auth-card';

/** Email and password, nothing else: there is no sign-up here, staff are added by an owner. */
export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    // One message for every failure: it does not say whether the address exists.
    if (err) setError('Those details did not work.');
  }

  return (
    <AuthCard title='Sign in' description='For Qrie staff only.'>
      <form onSubmit={submit} className='space-y-4'>
        <div className='space-y-1'>
          <Label htmlFor='email'>Email</Label>
          <Input id='email' type='email' autoComplete='username' required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='password'>Password</Label>
          <Input id='password' type='password' autoComplete='current-password' required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
        <Button type='submit' className='w-full' disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}
