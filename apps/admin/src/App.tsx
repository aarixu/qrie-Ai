import { RouterProvider } from '@tanstack/react-router';
import { Toaster } from '@/components/ui/sonner';
import { Factor } from '@/features/auth/factor';
import { NotStaff } from '@/features/auth/not-staff';
import { SignIn } from '@/features/auth/sign-in';
import { useIdleSignOut } from '@/hooks/use-idle-sign-out';
import { MeContext } from '@/lib/me';
import { useGate } from '@/lib/session';
import { StepUpProvider } from '@/lib/stepup';
import { configured } from '@/lib/supabase';
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
  const { gate, me } = useGate();

  if (!configured) {
    return <p className='p-6'>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).</p>;
  }
  return (
    <>
      {gate === 'signed-out' && <SignIn />}
      {(gate === 'enrol-factor' || gate === 'verify-factor') && <Factor mode={gate} />}
      {gate === 'checking' && <p className='p-6 text-muted-foreground'>Checking…</p>}
      {gate === 'not-staff' && <NotStaff />}
      {gate === 'ready' && me && (
        <MeContext.Provider value={me}>
          <Ready />
        </MeContext.Provider>
      )}
      <Toaster richColors position='top-right' />
    </>
  );
}
