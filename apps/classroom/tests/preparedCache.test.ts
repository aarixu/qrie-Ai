import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { KEEP_ON_DEVICE_MS, MAX_ON_DEVICE, createPreparedCache, memoryBackend } from '../src/lib/preparedCache';

/**
 * A CLASS PREPARED FOR THIS STUDENT IS NOT PAID FOR TWICE (production,
 * 2026-09-29): a kept class waits 'pending' until an operator publishes it, so
 * the same student reloading paid for, and waited ~90 s for, the same class
 * again. The device keeps what the catalogue would keep, for a few days.
 */
const lesson = (id: string): Lesson => ({
  formatVersion: 1,
  id,
  title: 'The Kidney',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'text', id: 't', x: 500, y: 300, text: 'Filters the blood' }],
  beats: [{ id: 'b1', topic: 'kidney', narration: 'The kidney filters the blood.', show: ['t'] }],
});

describe('the prepared class kept on this device', () => {
  it('finds a class it kept, with its pictures', async () => {
    let now = 1_000;
    const cache = createPreparedCache(memoryBackend(), () => now);
    await cache.remember('class10/x/kidney', lesson('k1'), { pic: '<svg/>' });
    now += 60_000;
    expect(await cache.find('class10/x/kidney')).toMatchObject({ lesson: { id: 'k1' }, assets: { pic: '<svg/>' } });
    expect(await cache.find('class10/x/heart')).toBeNull();
  });

  it('forgets it after a few days', async () => {
    let now = 1_000;
    const cache = createPreparedCache(memoryBackend(), () => now);
    await cache.remember('t', lesson('k1'), {});
    now += KEEP_ON_DEVICE_MS + 1;
    expect(await cache.find('t')).toBeNull();
  });

  it('keeps only the most recent few', async () => {
    let now = 1_000;
    const cache = createPreparedCache(memoryBackend(), () => now);
    for (let i = 0; i <= MAX_ON_DEVICE; i++) {
      now += 1_000;
      await cache.remember(`t${i}`, lesson(`k${i}`), {});
    }
    expect(await cache.find('t0')).toBeNull();
    expect(await cache.find(`t${MAX_ON_DEVICE}`)).not.toBeNull();
  });

  it('never serves a stored class that no longer reads as a lesson', async () => {
    const backend = memoryBackend();
    const cache = createPreparedCache(backend, () => 1_000);
    await backend.put({ topicRef: 't', lesson: { id: 'broken' } as unknown as Lesson, assets: {}, at: 1_000 });
    expect(await cache.find('t')).toBeNull();
  });

  it('is a miss, never an error, when storage fails', async () => {
    const failing = {
      get: async () => {
        throw new Error('quota');
      },
      put: async () => {
        throw new Error('quota');
      },
      all: async () => [],
      remove: async () => undefined,
      clear: async () => undefined,
    };
    const cache = createPreparedCache(failing, () => 1_000);
    await expect(cache.remember('t', lesson('k'), {})).resolves.toBeUndefined();
    expect(await cache.find('t')).toBeNull();
  });

  // Fourth review: the device copy carried the per-student lines, and nothing
  // wiped it when the phone passed to another student.
  it('keeps no per-student line, and files the class under its topic', async () => {
    const cache = createPreparedCache(memoryBackend(), () => 1_000);
    const personal = { ...lesson('k'), fill: [{ beatId: 'b1', say: 'Aarav, last Tuesday you mixed these up.' }] } as unknown as Lesson;
    await cache.remember('class10/x/kidney', personal, {});
    const kept = await cache.find('class10/x/kidney');
    expect(kept?.lesson.fill).toBeUndefined();
    expect(kept?.lesson.topicRef).toBe('class10/x/kidney');
  });

  it('serves a class an older version kept without its per-student lines', async () => {
    const backend = memoryBackend();
    const cache = createPreparedCache(backend, () => 1_000);
    const personal = { ...lesson('k'), fill: [{ beatId: 'b1', say: 'Aarav, welcome back.' }] } as unknown as Lesson;
    await backend.put({ topicRef: 't', lesson: personal, assets: {}, at: 1_000 });
    expect((await cache.find('t'))?.lesson.fill).toBeUndefined();
  });

  it('serves a class only in the language it was taught in', async () => {
    const cache = createPreparedCache(memoryBackend(), () => 1_000);
    await cache.remember('t', lesson('k'), {});
    expect(await cache.find('t', 'en')).not.toBeNull();
    expect(await cache.find('t', 'hi-en')).toBeNull();
  });

  it('is emptied when the device is handed over or wiped', async () => {
    const backend = memoryBackend();
    const cache = createPreparedCache(backend, () => 1_000);
    await cache.remember('t', lesson('k'), {});
    await cache.clear();
    expect(await cache.find('t')).toBeNull();
  });

  it('answers a miss, not never, when storage hangs', async () => {
    const hanging = {
      get: () => new Promise<never>(() => undefined),
      put: () => new Promise<never>(() => undefined),
      all: async () => [],
      remove: async () => undefined,
      clear: async () => undefined,
    };
    const cache = createPreparedCache(hanging, () => 1_000, 50);
    expect(await cache.find('t')).toBeNull();
    await expect(cache.remember('t', lesson('k'), {})).resolves.toBeUndefined();
  });
});
