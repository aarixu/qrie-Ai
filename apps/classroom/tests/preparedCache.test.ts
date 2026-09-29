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
    };
    const cache = createPreparedCache(failing, () => 1_000);
    await expect(cache.remember('t', lesson('k'), {})).resolves.toBeUndefined();
    expect(await cache.find('t')).toBeNull();
  });
});
