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

/**
 * How to empty each store, including the ones that never sync.
 *
 * Kept apart from `stores` because the never-synced ones belong here too: the
 * safety flag log is the PREVIOUS student's record and is the last thing that
 * should follow a device to its next owner.
 */
const resets = new Map<string, () => void>();

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
 * Write a value to a registered store and date it `at` rather than now.
 *
 * The stamp goes on AFTER the value, which is the whole of this function:
 * `store.set` stamps every write with Date.now() (createLocalStore's `write`),
 * so a stamp written first is overwritten by the write it was meant to date.
 * The listeners `set` fires (the React stores, and lib/sync.ts's pushLater,
 * which reads the stamp only when its timer fires) see the value first and
 * the stamp a moment later, in the same tick.
 */
export function writeDated(key: string, value: unknown, at: number): void {
  const store = stores.get(key);
  if (!store) return;
  store.set(value);
  try {
    localStorage.setItem(stampKey(key), String(at));
  } catch {
    // Same tolerance as everywhere else here: no storage, no stamp, carry on.
  }
}

/**
 * Apply a value the cloud won with, without claiming this device wrote it.
 *
 * The stamp is the CLOUD's, not now: stamping it now would make this device
 * look newer than the one that actually made the change, and the next sync
 * would push it back. This used to write the stamp BEFORE `store.set`, which
 * then overwrote it with now — so the claim above was false until it went
 * through writeDated (tests/sync.test.ts holds it).
 */
export function writeFromCloud(key: string, value: unknown, updatedAt: number): void {
  writeDated(key, value, updatedAt);
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
      // writeDated (and writeFromCloud through it) overwrites this afterwards
      // with the moment it means.
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

  resets.set(key, () => {
    cache = null;
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}:at`);
    } catch {
      // Nothing to clear is the same outcome as clearing it.
    }
    for (const cb of [...listeners]) cb();
  });

  if (opts.neverSync) neverSynced.add(key);
  else stores.set(key, store as Store<unknown>);
  return store;
}

/** Which student's work this device is currently holding. */
const OWNER_KEY = 'ai-tutor:device-owner';

/**
 * THE DEVICE CHANGED HANDS.
 *
 * Sync merges what is on the device with what is in the cloud, newest wins,
 * and it had no idea WHOSE work was on the device. So a shared phone — a
 * school tablet, a family laptop, a sibling — worked like this: the first
 * student's notes, their name, their progress and their safety flags sat in
 * localStorage after they signed out, and the moment the next student signed
 * in, everything of the first student's that happened to be newer was pushed
 * up as the second student's own. Not a copy: a merge, into a real account,
 * silently.
 *
 * Clearing is safe in the direction that matters. Work belonging to a student
 * who was signed in is already in their cloud rows; work belonging to a
 * student who never signed in is claimed here rather than cleared, because
 * nobody else has a claim on it. The dangerous direction is the one this
 * closes.
 *
 * Returns how many stores were emptied — zero on the ordinary paths, including
 * the anonymous-to-email upgrade, which keeps the same id.
 */
export function handOverDevice(ownerId: string): number {
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(OWNER_KEY);
    localStorage.setItem(OWNER_KEY, ownerId);
  } catch {
    // No storage means nothing persisted to hand over.
    return 0;
  }
  if (previous === null || previous === ownerId) return 0;

  let cleared = 0;
  for (const reset of resets.values()) {
    reset();
    cleared += 1;
  }
  return cleared;
}

/**
 * A per-student record kept outside a Store (lib/studentMemory.ts) joins the
 * same wipe: a phone handed to the next student, or a student deleted, must not
 * carry the last child's notebook into the new one's class.
 */
export function registerDeviceReset(key: string, reset: () => void): void {
  resets.set(key, reset);
}

/**
 * Empty this device, now, whoever it belongs to.
 *
 * `handOverDevice` clears when the NEXT student arrives. This is the other
 * caller: a student who asked to be deleted, who should not have to wait for a
 * stranger to sign in before their notes leave the phone.
 */
export function wipeDevice(): number {
  let cleared = 0;
  for (const reset of resets.values()) {
    reset();
    cleared += 1;
  }
  forgetDeviceOwner();
  return cleared;
}

/** Test seam: forget who this device belongs to. */
export function forgetDeviceOwner(): void {
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    /* nothing to forget */
  }
}

/** React binding. Server snapshot = same getter (no SSR in this app). */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
