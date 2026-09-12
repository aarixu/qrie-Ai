import { useSyncExternalStore } from 'react';

/**
 * A tiny localStorage-backed store: get/set/subscribe plus a React hook.
 * Swapping localStorage for an API later means changing THIS file only —
 * every store (settings, progress, doubt log) sits on this adapter.
 *
 * Storage can be absent or full (private mode, WebViews); every access is
 * guarded so a storage failure degrades to in-memory state, never a crash.
 */
export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (current: T) => T): void;
  subscribe(cb: () => void): () => void;
}

/**
 * EVERY STORE, BY ITS KEY.
 *
 * Filled by createLocalStore itself, so the eleven store files stay exactly
 * as they are and none of them learns that a cloud exists. lib/sync.ts walks
 * this when a student signs in.
 */
const stores = new Map<string, Store<unknown>>();

export function registeredStores(): ReadonlyMap<string, Store<unknown>> {
  return stores;
}

/**
 * Keys that must never exist in the cloud — filled by `neverSync` below.
 *
 * Tracked rather than hand-listed so the two can never disagree: a store that
 * opts out is a store sync deletes, without anybody remembering to add it to a
 * second list. It matters because opting out only stops FUTURE pushes; a key
 * that was synced before it opted out is still sitting in the row, and "we
 * stopped sending it" is not the same promise as "it is not there".
 */
const neverSynced = new Set<string>();

export function neverSyncedKeys(): ReadonlySet<string> {
  return neverSynced;
}

/**
 * When this device last wrote a store, kept BESIDE the value rather than
 * inside it: the stored shape has to keep loading for students who already
 * have data, and a version bump on eleven stores to add one field would be a
 * migration for nothing.
 *
 * Null means never written here — which sync treats as "always take the
 * cloud", the branch that stops a fresh phone erasing a year of work.
 */
const stampKey = (key: string): string => `${key}:at`;

export function touchedAt(key: string): number | null {
  try {
    const raw = localStorage.getItem(stampKey(key));
    const at = raw === null ? NaN : Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/**
 * Apply a value the cloud won with, without claiming this device wrote it.
 *
 * The stamp is the CLOUD's, not now: stamping it now would make this device
 * look newer than the one that actually made the change, and the next sync
 * would push it back.
 */
export function writeFromCloud(key: string, value: unknown, updatedAt: number): void {
  const store = stores.get(key);
  if (!store) return;
  try {
    localStorage.setItem(stampKey(key), String(updatedAt));
  } catch {
    // Same tolerance as everywhere else here: no storage, no stamp, carry on.
  }
  store.set(value);
}

export interface LocalStoreOptions {
  /**
   * Keep this store OFF the device entirely — never registered, therefore never
   * synced. For anything whose own reason for existing is that it does not
   * leave the phone.
   *
   * This exists because `flags` had exactly that reason written at the top of
   * its own file — "the log is LOCAL… the transcript of a child's worst moment
   * sitting in localStorage is not something this product should own" — and was
   * being synced to the cloud anyway, purely because registration is automatic
   * and nobody had to opt in. A rule stated in prose next to a default that
   * contradicts it is not a rule.
   */
  neverSync?: boolean;
}

export function createLocalStore<T>(key: string, initial: T, opts: LocalStoreOptions = {}): Store<T> {
  let cache: T | null = null;
  const listeners = new Set<() => void>();

  const read = (): T => {
    if (cache !== null) return cache;
    try {
      const raw = localStorage.getItem(key);
      cache = raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      cache = initial;
    }
    return cache;
  };

  const write = (next: T): void => {
    cache = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
      // Stamped on every write so sync can tell which device is ahead.
      // writeFromCloud overwrites this with the cloud's own moment.
      localStorage.setItem(`${key}:at`, String(Date.now()));
    } catch {
      // storage full/blocked — keep the in-memory value and carry on
    }
    for (const cb of [...listeners]) cb();
  };

  const store: Store<T> = {
    get: read,
    set: write,
    update: (fn) => write(fn(read())),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };

  if (opts.neverSync) neverSynced.add(key);
  else stores.set(key, store as Store<unknown>);
  return store;
}

/** React binding. Server snapshot = same getter (no SSR in this app). */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
