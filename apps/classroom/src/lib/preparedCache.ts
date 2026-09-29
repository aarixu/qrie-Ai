import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { registerDeviceReset } from '../stores/localStore';

/**
 * A CLASS PREPARED HERE IS NOT PAID FOR TWICE (production, 2026-09-29).
 *
 * A class this app prepares is kept 'pending' until an operator publishes it
 * (I1), and the catalogue serves only published classes — so the student who
 * had it prepared, reloading or coming back the next day, paid again (about
 * Rs 30) and waited again (~90 s) for the very class they had just had.
 *
 * So this device keeps it for the student who had it made, for
 * KEEP_ON_DEVICE_MS, the most recent MAX_ON_DEVICE of them:
 *   - only a class the catalogue accepted (keep()'s POST answered ok), or one
 *     kept back from the catalogue only because it is THIS student's — taught
 *     in their language (LiveClass.tsx `keep`);
 *   - without its per-student lines (`fill`), and filed under its topic;
 *   - served only in the language it was taught in;
 *   - emptied when the device passes to another student or is wiped
 *     (`registerDeviceReset`, below);
 *   - never ahead of the catalogue: LiveClass looks there first, so a
 *     published copy wins. A class an operator retracts is not known here —
 *     which is why it is kept for a day, not longer.
 *
 * IndexedDB, because a class carries its pictures as data URLs and
 * localStorage holds a few megabytes. Every failure, and anything slower than
 * `timeoutMs`, is a miss: the class is then prepared as it always was.
 */

export const KEEP_ON_DEVICE_MS = 24 * 60 * 60 * 1000;
export const MAX_ON_DEVICE = 3;
/** Past this a storage call is a miss: a hung IndexedDB must not hold a class. */
export const STORAGE_TIMEOUT_MS = 1_500;

export interface CachedClass {
  topicRef: string;
  lesson: Lesson;
  /** Artwork by element id, as the prep made it. */
  assets: Record<string, string>;
  /** When it was kept, by the cache's clock. */
  at: number;
}

export interface CacheBackend {
  get(topicRef: string): Promise<CachedClass | undefined>;
  put(entry: CachedClass): Promise<void>;
  all(): Promise<CachedClass[]>;
  remove(topicRef: string): Promise<void>;
  clear(): Promise<void>;
}

export interface PreparedCache {
  /** The class kept for this topic (in `language`, when given), or null — never an error. */
  find(topicRef: string, language?: string): Promise<CachedClass | null>;
  /** Keep it; a failure is silent, the class is already playing. */
  remember(topicRef: string, lesson: Lesson, assets: Record<string, string>): Promise<void>;
  /** Empty it: another student has the device. */
  clear(): Promise<void>;
}

const within = <T>(work: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/** The class as this device keeps it: no per-student lines, filed under its topic. */
function forDevice(lesson: Lesson, topicRef: string): Lesson {
  const copy = JSON.parse(JSON.stringify(lesson)) as Lesson & { fill?: unknown };
  delete copy.fill;
  copy.topicRef = topicRef;
  return copy;
}

export function createPreparedCache(
  backend: CacheBackend = indexedDbBackend(),
  clock: () => number = Date.now,
  timeoutMs: number = STORAGE_TIMEOUT_MS,
): PreparedCache {
  return {
    async find(topicRef, language) {
      const kept = await within(backend.get(topicRef).catch(() => undefined), timeoutMs, undefined);
      if (!kept || clock() - kept.at > KEEP_ON_DEVICE_MS) return null;
      // What storage hands back is re-read as a lesson, never trusted — and
      // made the device's form again: a copy an earlier version kept still
      // carried the per-student lines.
      const read = validateLesson(forDevice(kept.lesson, topicRef));
      if (!read.ok) return null;
      if (language !== undefined && (read.lesson.language ?? 'en') !== language) return null;
      return { ...kept, lesson: read.lesson };
    },
    async remember(topicRef, lesson, assets) {
      const work = (async () => {
        await backend.put({ topicRef, lesson: forDevice(lesson, topicRef), assets: { ...assets }, at: clock() });
        const all = (await backend.all()).sort((a, b) => b.at - a.at);
        for (const old of all.slice(MAX_ON_DEVICE)) await backend.remove(old.topicRef);
      })().catch(() => undefined);
      // Nothing to say on a failure or a hang: the next visit prepares it, as before.
      await within(work, timeoutMs, undefined);
    },
    async clear() {
      await within(backend.clear().catch(() => undefined), timeoutMs, undefined);
    },
  };
}

/** For tests, and for a browser with no IndexedDB. */
export function memoryBackend(): CacheBackend {
  const rows = new Map<string, CachedClass>();
  return {
    get: async (topicRef) => rows.get(topicRef),
    put: async (entry) => void rows.set(entry.topicRef, entry),
    all: async () => [...rows.values()],
    remove: async (topicRef) => void rows.delete(topicRef),
    clear: async () => rows.clear(),
  };
}

const DB = 'qrie-prepared';
const STORE = 'classes';

function indexedDbBackend(): CacheBackend {
  if (typeof indexedDB === 'undefined') return memoryBackend();
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'topicRef' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  const run = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const req = work(tx.objectStore(STORE));
          tx.oncomplete = () => {
            db.close();
            resolve(req.result);
          };
          // A write that fails at commit (storage full) fires only abort.
          const fail = (): void => {
            db.close();
            reject(tx.error ?? new Error('aborted'));
          };
          tx.onerror = fail;
          tx.onabort = fail;
        }),
    );
  return {
    get: (topicRef) => run('readonly', (s) => s.get(topicRef) as IDBRequest<CachedClass | undefined>),
    put: (entry) => run('readwrite', (s) => s.put(entry)).then(() => undefined),
    all: () => run('readonly', (s) => s.getAll() as IDBRequest<CachedClass[]>),
    remove: (topicRef) => run('readwrite', (s) => s.delete(topicRef)).then(() => undefined),
    clear: () => run('readwrite', (s) => s.clear()).then(() => undefined),
  };
}

/** The app's one cache. */
export const preparedCache: PreparedCache = createPreparedCache();

// Another student on this device, or this one deleted: their classes go too.
registerDeviceReset(DB, () => void preparedCache.clear());
