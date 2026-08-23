import { describe, expect, it, vi } from 'vitest';
import {
  createCachedTts,
  createIndexedDbSpeechStore,
  createMemorySpeechStore,
  speechCacheKey,
} from '../src/cachedTts';
import type { SpeechStore, SpeechSynthesizer, SynthesisRequest, SynthesizedSpeech } from '../src/synthesis';

const REQUEST: SynthesisRequest = {
  text: 'Blood is a tissue, not just a red liquid.',
  voice: 'Sulafat',
  model: 'gemini-3.1-flash-tts-preview',
};

function countingSynthesizer(): { inner: SpeechSynthesizer; calls: SynthesisRequest[] } {
  const calls: SynthesisRequest[] = [];
  return {
    calls,
    inner: {
      synthesize: (request) => {
        calls.push(request);
        return Promise.resolve<SynthesizedSpeech>({
          base64: `audio-for-${request.voice}-${calls.length}`,
          mimeType: 'audio/l16; rate=24000; channels=1',
        });
      },
    },
  };
}

describe('speechCacheKey', () => {
  it('ignores re-wrapped whitespace, so reformatting a lesson costs nothing', () => {
    expect(speechCacheKey({ ...REQUEST, text: 'Blood is\n  a tissue.' })).toBe(
      speechCacheKey({ ...REQUEST, text: 'Blood is a tissue.' }),
    );
  });

  it('separates voice, model and words', () => {
    const base = speechCacheKey(REQUEST);
    expect(speechCacheKey({ ...REQUEST, voice: 'Achird' })).not.toBe(base);
    expect(speechCacheKey({ ...REQUEST, model: 'gemini-2.5-flash-preview-tts' })).not.toBe(base);
    expect(speechCacheKey({ ...REQUEST, text: 'Plasma is mostly water.' })).not.toBe(base);
  });
});

describe('createCachedTts', () => {
  it('calls the inner synthesizer once for two identical requests', async () => {
    const { inner, calls } = countingSynthesizer();
    const cached = createCachedTts(inner, createMemorySpeechStore());

    const first = await cached.synthesize(REQUEST);
    const second = await cached.synthesize({ ...REQUEST });

    expect(calls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('calls it twice when the voice changes — a different voice is a different take', async () => {
    const { inner, calls } = countingSynthesizer();
    const cached = createCachedTts(inner, createMemorySpeechStore());

    await cached.synthesize(REQUEST);
    await cached.synthesize({ ...REQUEST, voice: 'Achird' });

    expect(calls).toHaveLength(2);
  });

  it('calls it twice when the model changes', async () => {
    const { inner, calls } = countingSynthesizer();
    const cached = createCachedTts(inner, createMemorySpeechStore());

    await cached.synthesize(REQUEST);
    await cached.synthesize({ ...REQUEST, model: 'gemini-2.5-pro-preview-tts' });

    expect(calls).toHaveLength(2);
  });

  it('shares one request between two callers asking at the same moment', async () => {
    const { inner, calls } = countingSynthesizer();
    const cached = createCachedTts(inner, createMemorySpeechStore());

    const [a, b] = await Promise.all([cached.synthesize(REQUEST), cached.synthesize({ ...REQUEST })]);

    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it('keeps working when the store is broken', async () => {
    const { inner, calls } = countingSynthesizer();
    const broken: SpeechStore = {
      get: () => Promise.reject(new Error('storage blocked')),
      set: () => Promise.reject(new Error('quota exceeded')),
    };
    const cached = createCachedTts(inner, broken);

    await expect(cached.synthesize(REQUEST)).resolves.toBeDefined();
    await expect(cached.synthesize(REQUEST)).resolves.toBeDefined();
    expect(calls).toHaveLength(2); // no caching, but the class is not harmed
  });

  it('lets a failed synthesis through instead of caching it', async () => {
    const inner: SpeechSynthesizer = { synthesize: () => Promise.reject(new Error('500')) };
    const cached = createCachedTts(inner, createMemorySpeechStore());

    await expect(cached.synthesize(REQUEST)).rejects.toThrow('500');
    await expect(cached.synthesize(REQUEST)).rejects.toThrow('500');
  });
});

describe('createMemorySpeechStore', () => {
  const speech = (base64: string): SynthesizedSpeech => ({ base64, mimeType: 'audio/l16; rate=24000' });

  it('returns what it was given, and undefined for a miss', async () => {
    const store = createMemorySpeechStore();
    await store.set('a', speech('one'));
    expect(await store.get('a')).toEqual(speech('one'));
    expect(await store.get('b')).toBeUndefined();
  });

  it('evicts the least recently used entry once it is full', async () => {
    const store = createMemorySpeechStore(2);
    await store.set('a', speech('one'));
    await store.set('b', speech('two'));
    await store.get('a'); // 'a' is now the recent one
    await store.set('c', speech('three'));

    expect(await store.get('b')).toBeUndefined();
    expect(await store.get('a')).toEqual(speech('one'));
    expect(await store.get('c')).toEqual(speech('three'));
  });
});

// ---------------------------------------------------------------------------
// A fake IndexedDB, so the storage path is exercised without a browser. It
// fires its callbacks on the microtask queue exactly as the real one does —
// handlers are assigned after the request is made, and code that assumes
// otherwise passes against a synchronous fake and fails in Chrome.
// ---------------------------------------------------------------------------

interface FakeRequest<T> {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  onblocked: (() => void) | null;
  result: T;
}

function createFakeIndexedDb(): { factory: IDBFactory; stores: Map<string, Map<string, unknown>> } {
  const stores = new Map<string, Map<string, unknown>>();
  let upgraded = false;

  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore(name: string): void {
      stores.set(name, new Map<string, unknown>());
    },
    transaction(name: string, _mode: string) {
      const data = stores.get(name) ?? new Map<string, unknown>();
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: () => ({
          get(key: string) {
            const request: FakeRequest<unknown> = {
              onsuccess: null,
              onerror: null,
              onupgradeneeded: null,
              onblocked: null,
              result: undefined,
            };
            queueMicrotask(() => {
              request.result = data.get(key);
              request.onsuccess?.();
            });
            return request;
          },
          put(value: unknown, key: string): void {
            data.set(key, value);
            queueMicrotask(() => tx.oncomplete?.());
          },
        }),
      };
      return tx;
    },
  };

  const factory = {
    open(_name: string, _version?: number) {
      const request: FakeRequest<typeof db> = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
        result: db,
      };
      queueMicrotask(() => {
        if (!upgraded) {
          upgraded = true;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
  };

  return { factory: factory as unknown as IDBFactory, stores };
}

describe('createIndexedDbSpeechStore', () => {
  it('round-trips a take through storage', async () => {
    const { factory } = createFakeIndexedDb();
    const store = createIndexedDbSpeechStore({ factory });
    const value: SynthesizedSpeech = { base64: 'abc', mimeType: 'audio/l16; rate=24000' };

    await store.set('key', value);
    expect(await store.get('key')).toEqual(value);
    expect(await store.get('other')).toBeUndefined();
  });

  it('degrades to no caching when the browser has no IndexedDB', async () => {
    const store = createIndexedDbSpeechStore({ factory: undefined });

    await expect(store.set('key', { base64: 'abc', mimeType: 'x' })).resolves.toBeUndefined();
    expect(await store.get('key')).toBeUndefined();
  });

  it('degrades to no caching when opening the database fails', async () => {
    const factory = {
      open: () => {
        throw new Error('storage is blocked in this context');
      },
    } as unknown as IDBFactory;
    const store = createIndexedDbSpeechStore({ factory });

    await expect(store.set('key', { base64: 'abc', mimeType: 'x' })).resolves.toBeUndefined();
    expect(await store.get('key')).toBeUndefined();
  });

  it('ignores a record written in some other shape', async () => {
    const { factory, stores } = createFakeIndexedDb();
    const store = createIndexedDbSpeechStore({ factory });
    await store.set('key', { base64: 'abc', mimeType: 'audio/l16' });

    // What a record from an older format, or another tab, could look like.
    stores.get('speech')?.set('stale', { audio: 'abc' });
    expect(await store.get('stale')).toBeUndefined();
  });

  it('still synthesises through a cache backed by unavailable storage', async () => {
    const { inner, calls } = countingSynthesizer();
    const cached = createCachedTts(inner, createIndexedDbSpeechStore({ factory: undefined }));

    const speech = await cached.synthesize(REQUEST);
    expect(speech.base64).toContain('audio-for-Sulafat');
    expect(calls).toHaveLength(1);
  });
});

describe('the cache in front of the tutor', () => {
  it('never lets a store failure surface to the player', async () => {
    const set = vi.fn(() => Promise.reject(new Error('quota')));
    const store: SpeechStore = { get: () => Promise.resolve(undefined), set };
    const { inner } = countingSynthesizer();

    await expect(createCachedTts(inner, store).synthesize(REQUEST)).resolves.toBeDefined();
    expect(set).toHaveBeenCalledTimes(1);
  });
});
