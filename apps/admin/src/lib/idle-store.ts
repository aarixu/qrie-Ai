import { IDLE_LIMIT_MINUTES, idleExpired } from '@ai-tutor/admin-client';

/**
 * THE IDLE CLOCK, KEPT WHERE THE SESSION IS KEPT. The session (with its refresh
 * token) lives in localStorage and survives a closed tab, so the time of the last
 * click must too: otherwise closing the tab instead of signing out leaves a
 * console that opens again, signed in, days later. Shared by every tab of the
 * console, so activity in one keeps the others awake.
 *
 * A record that is missing, unreadable, or in storage that throws counts as
 * stale: when in doubt, sign out.
 */
export const LAST_ACTIVE_KEY = 'qrie-admin-last-active';

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's localStorage, or a store that always reads stale when the browser refuses access to it. */
export function browserStore(): KeyValue {
  try {
    return window.localStorage;
  } catch {
    return {
      getItem: () => {
        throw new Error('storage is not available');
      },
      setItem: () => {},
      removeItem: () => {},
    };
  }
}

export function markActive(s: KeyValue, nowMs: number): void {
  try {
    s.setItem(LAST_ACTIVE_KEY, String(nowMs));
  } catch {
    // Storage refused: the next check reads stale and signs out, which is the safe side.
  }
}

export function isStale(s: KeyValue, nowMs: number, limitMinutes = IDLE_LIMIT_MINUTES): boolean {
  let raw: string | null;
  try {
    raw = s.getItem(LAST_ACTIVE_KEY);
  } catch {
    return true;
  }
  const at = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(at)) return true;
  return idleExpired(at, nowMs, limitMinutes);
}
