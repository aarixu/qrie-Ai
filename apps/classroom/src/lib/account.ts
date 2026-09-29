import { useEffect, useState } from 'react';
import { handOverDevice } from '../stores/localStore';
// Registers its own device reset; loaded here so it is registered before the
// handover below can run (lib/preparedCache.ts).
import './preparedCache';
import { track } from './telemetry';
import { connectSync } from './sync';
import {
  cloudConfigured,
  createSupabaseBackend,
  currentAccount,
  onAccountChange,
  type Account,
} from './supabase';

/**
 * SIGNING IN, AND WHAT IT ACTUALLY DOES.
 *
 * One thing: it attaches the student's work to an account so it survives the
 * browser and reaches their phone. Nothing in the app is gated behind it —
 * a student who never signs in loses no feature, only the copy.
 *
 * That is a product decision as much as a technical one. A child opening a
 * study app should be studying inside ten seconds, not filling a form; the
 * account is offered once there is something worth keeping.
 */

let detach: (() => void) | null = null;

/** Attach sync to whoever is signed in; detach when they leave. */
function follow(account: Account | null): void {
  detach?.();
  detach = null;
  if (!account) return;
  /**
   * BEFORE anything is merged, and that order is the whole safeguard.
   *
   * connectSync merges what is on this device with what is in this account's
   * cloud, newest wins. If the device is still holding the previous student's
   * notes, name and progress, that merge files them under the new student's
   * account. Handing the device over first means the merge sees an empty
   * device and simply takes what the account already has, which is what
   * signing in on a shared phone is supposed to do.
   */
  const cleared = handOverDevice(account.id);
  if (cleared > 0) track('device_handover', { cleared });
  detach = connectSync(createSupabaseBackend(account.id));
}

/**
 * Start following the session. Called once at app start.
 *
 * Safe with no project configured: `currentAccount` resolves to null, nothing
 * attaches, and the app is exactly the local-only app it is today.
 */
export function startAccountSync(): () => void {
  if (!cloudConfigured()) return () => undefined;
  void currentAccount().then(follow);
  const off = onAccountChange(follow);
  return () => {
    off();
    detach?.();
    detach = null;
  };
}

/** Who is signed in, for the one or two screens that show it. */
export function useAccount(): { account: Account | null; ready: boolean } {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(!cloudConfigured());

  useEffect(() => {
    if (!cloudConfigured()) return;
    let live = true;
    void currentAccount().then((a) => {
      if (!live) return;
      setAccount(a);
      setReady(true);
    });
    const off = onAccountChange((a) => {
      if (live) setAccount(a);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  return { account, ready };
}
