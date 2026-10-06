import { useEffect } from 'react';
import { browserStore, isStale, markActive } from '@/lib/idle-store';
import { supabase } from '@/lib/supabase';

/** Activity is written to storage at most this often. */
const WRITE_EVERY_MS = 15_000;

/**
 * Signs the person out after IDLE_LIMIT_MINUTES without a click, a key or a
 * scroll, in this tab or any other tab of the console. The clock is kept in
 * storage beside the session, so a console reopened after the tab was closed is
 * signed out on its first load, not handed back already signed in.
 */
export function useIdleSignOut(): void {
  useEffect(() => {
    const store = browserStore();
    if (isStale(store, Date.now())) {
      void supabase.auth.signOut();
      return;
    }
    let lastWrite = 0;
    const touch = () => {
      const now = Date.now();
      if (now - lastWrite < WRITE_EVERY_MS) return;
      lastWrite = now;
      markActive(store, now);
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    for (const ev of events) window.addEventListener(ev, touch, { passive: true });
    const id = setInterval(() => {
      if (isStale(store, Date.now())) void supabase.auth.signOut();
    }, 30_000);
    return () => {
      for (const ev of events) window.removeEventListener(ev, touch);
      clearInterval(id);
    };
  }, []);
}
