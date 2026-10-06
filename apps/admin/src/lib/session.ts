import { decideGate, staffFromError, type Gate, type Me, type StaffAnswer } from '@ai-tutor/admin-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { admin } from './client.ts';
import { supabase } from './supabase.ts';

export interface GateState {
  gate: Gate;
  me: Me | null;
  refresh: () => Promise<void>;
}

/**
 * Where the visitor is in getting in: signed out, enrolling or verifying the
 * authenticator, being checked against the staff list, refused, unable to check,
 * or ready. The order of the checks is decideGate's, which is tested; this only
 * gathers its inputs. Only the database's refusal counts as "not staff"; any other
 * failure of admin.me() is 'unavailable', and an open console stays open through
 * it (decideGate's `previous`), keeping the last known person.
 */
export function useGate(): GateState {
  const [gate, setGate] = useState<Gate>('checking');
  const [me, setMe] = useState<Me | null>(null);
  const previous = useRef<Gate>('checking');

  const refresh = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) {
      previous.current = 'signed-out';
      setMe(null);
      setGate('signed-out');
      return;
    }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const hasVerifiedFactor = (factors?.all ?? []).some((f) => f.factor_type === 'totp' && f.status === 'verified');
    const level = aal?.currentLevel;
    // Mapped literal by literal: the library's type also admits any string.
    const aalNow = level === 'aal2' ? 'aal2' : level === 'aal1' ? 'aal1' : null;
    let staff: StaffAnswer = 'unknown';
    let who: Me | null = null;
    if (aalNow === 'aal2') {
      try {
        who = await admin.me();
        staff = 'yes';
      } catch (e) {
        staff = staffFromError(e);
      }
    }
    const next = decideGate({ signedIn: true, aal: aalNow, hasVerifiedFactor, staff, previous: previous.current });
    previous.current = next;
    if (staff === 'yes') setMe(who);
    else if (next !== 'ready') setMe(null);
    setGate(next);
  }, []);

  useEffect(() => {
    void refresh();
    const { data } = supabase.auth.onAuthStateChange(() => {
      // supabase-js can deadlock if its own methods are called inside this
      // callback, so the work is handed to the next tick.
      setTimeout(() => void refresh(), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  return { gate, me, refresh };
}
