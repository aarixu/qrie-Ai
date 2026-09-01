import { registeredStores, touchedAt, writeFromCloud } from '../stores/localStore';

/**
 * THE STUDENT'S WORK, ON MORE THAN ONE DEVICE.
 *
 * Everything the app knows about a student — progress, notes, streak,
 * bookmarks, the outcome map — lives in localStorage, which means it dies
 * with the browser and never reaches their phone. This is the layer that
 * fixes that WITHOUT any screen or store learning about a cloud: every store
 * registers itself when it is created, and this walks the registry.
 *
 * Offline stays first. localStorage remains the thing the app reads and
 * writes at speed; the cloud is a copy that catches up. A student on a train
 * loses nothing.
 *
 * The backend is an interface, not Firebase. Firebase is what we will mount
 * behind it, but the merge — the part with the judgement in it — must be
 * testable without a project, a network or a bill.
 */

export interface Snapshot {
  value: unknown;
  /** When this side last changed. Null on a device that has never written. */
  updatedAt: number | null;
}

export interface CloudBackend {
  /** Everything this account has, keyed the way the stores are. */
  pull(): Promise<Record<string, { value: unknown; updatedAt: number }>>;
  push(key: string, value: unknown, updatedAt: number): Promise<void>;
}

export interface MergePlan {
  /** Stores where the cloud is ahead: overwrite the device. */
  take: string[];
  /** Stores where the device is ahead: overwrite the cloud. */
  send: string[];
}

/**
 * Which side wins, per store.
 *
 * Last-write-wins, decided store by store rather than for the account as a
 * whole — a student who took notes on a phone and answered questions on a
 * laptop must keep both.
 *
 * THE CASE THAT MATTERS: a device that has never been written to has no
 * timestamp, and its stores hold their empty defaults. It must always take
 * the cloud. Treating "never written" as "written at zero" would be the same
 * comparison, but writing the rule out is the point — this is the branch that
 * would silently erase a year of work on first sign-in from a new phone.
 */
export function mergePlan(
  local: Record<string, Snapshot>,
  cloud: Record<string, { value: unknown; updatedAt: number }>,
): MergePlan {
  const take: string[] = [];
  const send: string[] = [];

  for (const key of new Set([...Object.keys(local), ...Object.keys(cloud)])) {
    const here = local[key]?.updatedAt ?? null;
    const there = cloud[key]?.updatedAt ?? null;

    if (there === null) {
      // The cloud has never seen this store. Send it up, unless this device
      // has nothing to say about it either.
      if (here !== null) send.push(key);
      continue;
    }
    if (here === null || here < there) {
      take.push(key);
      continue;
    }
    if (here > there) send.push(key);
  }

  return { take, send };
}

/** How long a burst of edits is allowed to settle before it is sent up. */
const PUSH_SETTLE_MS = 1_500;

/**
 * Attach a backend. Returns the detach, for sign-out.
 *
 * Pulls once, applies the plan, then keeps the cloud caught up as the student
 * works. A failed push is not an error the student should ever see: their
 * work is already safe on the device, and the next edit will try again.
 */
export function connectSync(backend: CloudBackend): () => void {
  let stopped = false;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const offs: (() => void)[] = [];

  const pushLater = (key: string): void => {
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        if (stopped) return;
        const store = registeredStores().get(key);
        if (!store) return;
        void backend.push(key, store.get(), touchedAt(key) ?? Date.now()).catch(() => {
          // Already safe locally. The next edit retries; a toast here would
          // be telling the student about our problem, not theirs.
        });
      }, PUSH_SETTLE_MS),
    );
  };

  void (async () => {
    const cloud = await backend.pull().catch(() => null);
    if (stopped || cloud === null) return;

    const local: Record<string, Snapshot> = {};
    for (const [key, store] of registeredStores()) {
      local[key] = { value: store.get(), updatedAt: touchedAt(key) };
    }

    const plan = mergePlan(local, cloud);
    for (const key of plan.take) {
      const incoming = cloud[key];
      if (incoming) writeFromCloud(key, incoming.value, incoming.updatedAt);
    }
    for (const key of plan.send) pushLater(key);
  })();

  for (const [key, store] of registeredStores()) {
    offs.push(store.subscribe(() => pushLater(key)));
  }

  return () => {
    stopped = true;
    for (const timer of timers.values()) clearTimeout(timer);
    for (const off of offs) off();
  };
}
