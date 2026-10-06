import { decideGate, type Gate, type Me } from '@ai-tutor/admin-client';
import { useCallback, useEffect, useState } from 'react';
import { admin } from './client.ts';
import { supabase } from './supabase.ts';

export interface GateState {
  gate: Gate;
  me: Me | null;
  refresh: () => Promise<void>;
}

/**
 * Where the visitor is in getting in: signed out, enrolling or verifying the
 * authenticator, being checked against the staff list, refused, or ready. The
 * order of the checks is decideGate's, which is tested; this only gathers its
 * inputs.
 */
export function useGate(): GateState {
  const [gate, setGate] = useState<Gate>('checking');
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) {
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
    let isStaff: boolean | null = null;
    let who: Me | null = null;
    if (aalNow === 'aal2') {
      try {
        who = await admin.me();
        isStaff = true;
      } catch {
        isStaff = false;
      }
    }
    setMe(who);
    setGate(decideGate({ signedIn: true, aal: aalNow, hasVerifiedFactor, isStaff }));
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
