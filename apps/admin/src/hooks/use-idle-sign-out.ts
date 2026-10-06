import { idleExpired } from '@ai-tutor/admin-client';
import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/** Signs the person out after IDLE_LIMIT_MINUTES without a click, a key or a scroll. */
export function useIdleSignOut(): void {
  const last = useRef(Date.now());
  useEffect(() => {
    const touch = () => {
      last.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    for (const ev of events) window.addEventListener(ev, touch, { passive: true });
    const id = setInterval(() => {
      if (idleExpired(last.current, Date.now())) void supabase.auth.signOut();
    }, 30_000);
    return () => {
      for (const ev of events) window.removeEventListener(ev, touch);
      clearInterval(id);
    };
  }, []);
}
