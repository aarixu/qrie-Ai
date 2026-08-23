/**
 * SYNTHESISE EACH SENTENCE ONCE.
 *
 * One class is watched by every student in the cohort and rewatched by half of
 * them the night before a test. The words never change between those views, so
 * paying the API and the two-second wait again is money and latency spent on a
 * byte-identical answer.
 *
 * The key is a hash of text + voice + model, because those three are the whole
 * input: change the words, the voice or the model and it is a different take
 * that must not be served from a cache.
 *
 * Two stores ship. Memory is per-tab and instant, and is what a rewatched beat
 * hits. IndexedDB survives the tab closing, which is what makes the second
 * viewing of a lesson free — and it DEGRADES TO NO CACHING rather than throwing
 * when storage is unavailable (private windows, blocked storage, a full quota).
 * A student in a private window must still hear the class.
 */

import { hashNarration, normaliseNarration } from './hash';
import type { SpeechStore, SpeechSynthesizer, SynthesisRequest, SynthesizedSpeech } from './synthesis';

/**
 * The cache key.
 *
 * The normalised length rides along with the hash because a collision here is
 * not a slow class, it is a student hearing a completely different sentence in
 * the tutor's voice. Two lines that hash the same AND are the same length is a
 * far smaller target than two lines that merely hash the same.
 */
export function speechCacheKey(request: SynthesisRequest): string {
  const text = normaliseNarration(request.text);
  return `${request.voice}|${request.model}|${text.length}|${hashNarration(text)}`;
}

/**
 * Wraps a synthesizer with a store. Store failures are swallowed: a cache that
 * can break synthesis is worse than no cache at all.
 */
export function createCachedTts(inner: SpeechSynthesizer, store: SpeechStore): SpeechSynthesizer {
  // Two beats with the same narration can be in flight at once (a repeated
  // bridging line, two students on one device). Sharing the promise makes that
  // one request instead of two.
  const inFlight = new Map<string, Promise<SynthesizedSpeech>>();

  return {
    async synthesize(request: SynthesisRequest): Promise<SynthesizedSpeech> {
      const key = speechCacheKey(request);

      const hit = await store.get(key).catch(() => undefined);
      if (hit) return hit;

      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise = inner.synthesize(request);
      inFlight.set(key, promise);
      try {
        const speech = await promise;
        // Not awaited: the tutor should start talking now, not after the disk
        // write. A failed write only costs the next student a cache miss.
        void store.set(key, speech).catch(() => undefined);
        return speech;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}

/**
 * In-memory store, least-recently-used.
 *
 * Bounded by entries rather than bytes because a base64 minute of speech is
 * roughly two megabytes and forty of them is a lesson — the bound exists to
 * stop a long session growing without limit, not to be precise.
 */
export function createMemorySpeechStore(maxEntries = 40): SpeechStore {
  const limit = Math.max(1, Math.floor(maxEntries));
  const entries = new Map<string, SynthesizedSpeech>();

  return {
    get(key: string): Promise<SynthesizedSpeech | undefined> {
      const hit = entries.get(key);
      if (hit) {
        // Re-insert so Map's insertion order is recency order and the eviction
        // below drops the sentence nobody has come back to.
        entries.delete(key);
        entries.set(key, hit);
      }
      return Promise.resolve(hit);
    },
    set(key: string, value: SynthesizedSpeech): Promise<void> {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      return Promise.resolve();
    },
  };
}

export interface IndexedDbStoreOptions {
  dbName?: string;
  storeName?: string;
  /** Injected for tests. Defaults to the browser's, and to nothing where absent. */
  factory?: IDBFactory;
}

const isSpeech = (value: unknown): value is SynthesizedSpeech => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { base64?: unknown; mimeType?: unknown };
  return typeof record.base64 === 'string' && typeof record.mimeType === 'string';
};

/**
 * IndexedDB store that never throws and never rejects.
 *
 * Every failure — no IndexedDB at all, a blocked open, a quota-exceeded write,
 * a record written by an older format — resolves as "not cached". The class
 * then behaves exactly as it does on a first viewing, which is the correct
 * degradation: slower, never broken.
 */
export function createIndexedDbSpeechStore(options: IndexedDbStoreOptions = {}): SpeechStore {
  const dbName = options.dbName ?? 'ai-tutor-voice';
  const storeName = options.storeName ?? 'speech';
  const factory =
    options.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);

  // Opened once and remembered, including the "it did not open" answer, so a
  // browser that refuses storage is asked once per session rather than per beat.
  let opening: Promise<IDBDatabase | null> | null = null;

  const open = (): Promise<IDBDatabase | null> => {
    if (!factory) return Promise.resolve(null);
    opening ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = factory.open(dbName, 1);
        request.onupgradeneeded = (): void => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => resolve(null);
        request.onblocked = (): void => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return opening;
  };

  return {
    async get(key: string): Promise<SynthesizedSpeech | undefined> {
      const db = await open();
      if (!db) return undefined;
      return new Promise<SynthesizedSpeech | undefined>((resolve) => {
        try {
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
          request.onsuccess = (): void => {
            resolve(isSpeech(request.result) ? request.result : undefined);
          };
          request.onerror = (): void => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      });
    },

    async set(key: string, value: SynthesizedSpeech): Promise<void> {
      const db = await open();
      if (!db) return;
      return new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put({ base64: value.base64, mimeType: value.mimeType }, key);
          tx.oncomplete = (): void => resolve();
          // A quota-exceeded write aborts the transaction. Nothing to do about
          // it and nothing worth telling the student.
          tx.onerror = (): void => resolve();
          tx.onabort = (): void => resolve();
        } catch {
          resolve();
        }
      });
    },
  };
}
