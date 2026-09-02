import { useSyncExternalStore } from 'react';

/**
 * WHETHER THE DEVICE HAS A CONNECTION.
 *
 * The app had no idea. A student on a bus, or on the ₹10,000 Android this
 * product is built for, got "Something went wrong" for what is not a fault —
 * and no clue that the class they already downloaded would still play.
 *
 * `navigator.onLine` is famously weak evidence: true means "the OS thinks
 * there is a network", which a captive portal or a dead uplink also satisfies.
 * It is trustworthy in ONE direction only, and that is the direction this app
 * needs — FALSE really does mean no connection. So it is used to explain a
 * failure that has already happened, never to predict one. Nothing here blocks
 * a request because we think it will fail; the request is made, and if it
 * fails while `onLine` is false the student is told the honest reason.
 */

const listeners = new Set<() => void>();

/** Cached so React's snapshot is stable between events; a fresh read each time
 *  would be fine on every real browser but is not guaranteed to be. */
let online = true;

const notify = (next: boolean): void => {
  if (next === online) return;
  online = next;
  for (const cb of [...listeners]) cb();
};

const subscribe = (cb: () => void): (() => void) => {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    online = readNavigator();
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    }
  };
};

const goOnline = () => notify(true);
const goOffline = () => notify(false);

/**
 * Absent in a test renderer and in some WebViews. Missing means UNKNOWN, and
 * unknown must read as online: claiming a student is offline when they are not
 * would hide a real error behind a wrong explanation.
 */
function readNavigator(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

/** For code outside React — the same value the hook reports. */
export function isOnline(): boolean {
  return listeners.size > 0 ? online : readNavigator();
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}

/** Test seam: drive the store without dispatching window events. */
export const __setOnlineForTests = (next: boolean): void => notify(next);
