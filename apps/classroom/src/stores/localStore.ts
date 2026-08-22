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

export function createLocalStore<T>(key: string, initial: T): Store<T> {
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
    } catch {
      // storage full/blocked — keep the in-memory value and carry on
    }
    for (const cb of [...listeners]) cb();
  };

  return {
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
}

/** React binding. Server snapshot = same getter (no SSR in this app). */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
