import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { AuthCard } from './auth-card';

/** Said only after the second factor, so a stranger learns nothing about who is on the staff list. */
export function NotStaff() {
  return (
    <AuthCard title='No access' description='This account does not have access to Qrie control.'>
      <Button variant='outline' className='w-full' onClick={() => void supabase.auth.signOut()}>
        Sign out
      </Button>
    </AuthCard>
  );
}
