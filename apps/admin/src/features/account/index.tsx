import { useState, type FormEvent } from 'react';
import { newPasswordProblem } from '@/lib/account';
import { useMe } from '@/lib/me';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AdminPage } from '@/components/admin-page';

/**
 * The signed-in person's own account: who they are here, and a new password
 * (for a staff member, the first thing after an invitation's temporary one).
 * A person's own password is not an admin-function write, so it takes no
 * reason or environment.
 */
export function Account() {
  const me = useMe();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const problem = newPasswordProblem(password, again);
    if (problem) {
      setSaid({ ok: false, text: problem });
      return;
    }
    setBusy(true);
    setSaid(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setSaid({ ok: false, text: error.message });
      } else {
        setPassword('');
        setAgain('');
        setSaid({ ok: true, text: 'Your password was changed.' });
      }
    } catch (e) {
      setSaid({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage title='Your account'>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>{me.displayName}</CardTitle>
            <CardDescription>You on Qrie control.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
              <dt className='text-muted-foreground'>Role</dt>
              <dd>{me.role}</dd>
              <dt className='text-muted-foreground'>Environment</dt>
              <dd>{me.environment}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Change your password</CardTitle>
            <CardDescription>At least 12 characters.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void submit(e)} className='space-y-3'>
              <div className='space-y-1'>
                <Label htmlFor='new-password'>New password</Label>
                <Input
                  id='new-password'
                  type='password'
                  autoComplete='new-password'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='new-password-again'>The same again</Label>
                <Input
                  id='new-password-again'
                  type='password'
                  autoComplete='new-password'
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                />
              </div>
              {said && (
                <p role={said.ok ? 'status' : 'alert'} className={said.ok ? 'text-sm text-emerald-700 dark:text-emerald-400' : 'text-sm text-destructive'}>
                  {said.text}
                </p>
              )}
              <Button type='submit' disabled={busy}>
                {busy ? 'Changing…' : 'Change the password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AdminPage>
  );
}
