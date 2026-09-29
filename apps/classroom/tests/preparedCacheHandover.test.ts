// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { handOverDevice, wipeDevice } from '../src/stores/localStore';
import { preparedCache } from '../src/lib/preparedCache';

/**
 * Fourth review: the device copy of a class was never cleared when the phone
 * passed to another student, or when a student was deleted. The app's one
 * cache registers its reset (jsdom has no IndexedDB, so it runs in memory).
 */
const lesson: Lesson = {
  formatVersion: 1,
  id: 'kidney',
  title: 'The Kidney',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'text', id: 't', x: 500, y: 300, text: 'Filters the blood' }],
  beats: [{ id: 'b1', topic: 'kidney', narration: 'The kidney filters the blood.', show: ['t'] }],
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the device copy of a prepared class', () => {
  it('goes when the device passes to another student', async () => {
    localStorage.clear();
    handOverDevice('student-a');
    await preparedCache.remember('class10/x/kidney', lesson, {});
    expect(await preparedCache.find('class10/x/kidney')).not.toBeNull();
    handOverDevice('student-b');
    await settle();
    expect(await preparedCache.find('class10/x/kidney')).toBeNull();
  });

  it('goes when the device is wiped', async () => {
    await preparedCache.remember('class10/x/kidney', lesson, {});
    wipeDevice();
    await settle();
    expect(await preparedCache.find('class10/x/kidney')).toBeNull();
  });
});
