import { RouterProvider } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { AuthCard } from '@/features/auth/auth-card';
import { Factor } from '@/features/auth/factor';
import { NotStaff } from '@/features/auth/not-staff';
import { SignIn } from '@/features/auth/sign-in';
import { useIdleSignOut } from '@/hooks/use-idle-sign-out';
import { MeContext } from '@/lib/me';
import { useGate } from '@/lib/session';
import { StepUpProvider } from '@/lib/stepup';
import { configured, keyProblem, supabase } from '@/lib/supabase';
import { router } from './router.tsx';

function Ready() {
  useIdleSignOut();
  return (
    <StepUpProvider>
      <RouterProvider router={router} />
    </StepUpProvider>
  );
}

/** One decision picks the screen; see decideGate (packages/admin-client) for the order. */
export function App() {
  const { gate, me, refresh } = useGate();

  if (keyProblem) {
    return (
      <AuthCard title='This build cannot be used' description={keyProblem}>
        <span />
      </AuthCard>
    );
  }
  if (!configured) {
    return <p className='p-6'>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).</p>;
  }
  return (
    <>
      {gate === 'signed-out' && <SignIn />}
      {(gate === 'enrol-factor' || gate === 'verify-factor') && <Factor mode={gate} />}
      {gate === 'checking' && <p className='p-6 text-muted-foreground'>Checking…</p>}
      {gate === 'not-staff' && <NotStaff />}
      {gate === 'unavailable' && (
        <AuthCard
          title='Cannot reach Qrie right now'
          description='Your sign-in is fine, but the database did not answer. This is not a refusal. Try again in a moment.'
        >
          <div className='flex gap-2'>
            <Button className='flex-1' onClick={() => void refresh()}>
              Try again
            </Button>
            <Button variant='outline' onClick={() => void supabase.auth.signOut()}>
              Sign out
            </Button>
          </div>
        </AuthCard>
      )}
      {gate === 'ready' && me && (
        <MeContext.Provider value={me}>
          <Ready />
        </MeContext.Provider>
      )}
      <Toaster richColors position='top-right' />
    </>
  );
}
