import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';

/**
 * A CLASS PREPARED HERE IS NOT PAID FOR TWICE (production, 2026-09-29).
 *
 * A class this app prepares is kept 'pending' until an operator publishes it
 * (I1), and the catalogue serves only published classes — so the student who
 * had it prepared, reloading or coming back the next day, paid again (about
 * Rs 30) and waited again (~90 s) for the very class they had just had.
 *
 * So the device keeps it too: exactly what `keep()` would send to the
 * catalogue (the same gates — reviewed, checked, no student's name in it),
 * for KEEP_ON_DEVICE_MS, the most recent MAX_ON_DEVICE of them. It is never
 * shown to anyone the catalogue would not show it to on this device, and a
 * published copy, when there is one, is found first (LiveClass looks in the
 * catalogue before it looks here).
 *
 * IndexedDB, because a class carries its pictures as data URLs and
 * localStorage holds a few megabytes. Every failure is a miss: the class is
 * then prepared as it always was.
 */

export const KEEP_ON_DEVICE_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_ON_DEVICE = 3;

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
}

export interface PreparedCache {
  /** The class kept for this topic, or null — never an error. */
  find(topicRef: string): Promise<CachedClass | null>;
  /** Keep it; a failure is silent, the class is already playing. */
  remember(topicRef: string, lesson: Lesson, assets: Record<string, string>): Promise<void>;
}

export function createPreparedCache(backend: CacheBackend = indexedDbBackend(), clock: () => number = Date.now): PreparedCache {
  return {
    async find(topicRef) {
      try {
        const kept = await backend.get(topicRef);
        if (!kept || clock() - kept.at > KEEP_ON_DEVICE_MS) return null;
        // What storage hands back is re-read as a lesson, never trusted.
        const read = validateLesson(kept.lesson);
        if (!read.ok) return null;
        return { ...kept, lesson: read.lesson };
      } catch {
        return null;
      }
    },
    async remember(topicRef, lesson, assets) {
      try {
        await backend.put({ topicRef, lesson, assets: { ...assets }, at: clock() });
        const all = (await backend.all()).sort((a, b) => b.at - a.at);
        for (const old of all.slice(MAX_ON_DEVICE)) await backend.remove(old.topicRef);
      } catch {
        // Nothing to say: the next visit prepares it, as before.
      }
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
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        }),
    );
  return {
    get: (topicRef) => run('readonly', (s) => s.get(topicRef) as IDBRequest<CachedClass | undefined>),
    put: (entry) => run('readwrite', (s) => s.put(entry)).then(() => undefined),
    all: () => run('readonly', (s) => s.getAll() as IDBRequest<CachedClass[]>),
    remove: (topicRef) => run('readwrite', (s) => s.delete(topicRef)).then(() => undefined),
  };
}

/** The app's one cache. */
export const preparedCache: PreparedCache = createPreparedCache();
