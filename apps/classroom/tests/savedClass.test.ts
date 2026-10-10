import { describe, expect, it } from 'vitest';
import { readSavedClass } from '../src/viewer/savedClass';

/**
 * A PREPARED CLASS, PLAYED FROM A FILE (the viewer, 2026-10-07).
 *
 * The lab prepares a class and keeps it nowhere: a reload, or the computer
 * shutting down, and it is gone. The viewer plays one the lab saved, with no
 * model and no sign-in, so it can be opened on a phone from a static host.
 */

const lesson = {
  formatVersion: 1,
  id: 'c',
  title: 'Villi',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'title', id: 't', x: 500, y: 72, text: 'Villi' }],
  beats: [{ id: 'b1', topic: 'Villi', narration: 'Villi absorb food.', show: ['t'] }],
};

describe('readSavedClass', () => {
  it('takes a saved lesson and its pictures', () => {
    const got = readSavedClass({ lesson, assets: { villus: 'data:image/png;base64,AAAA' } });
    expect(got?.lesson.title).toBe('Villi');
    expect(got?.assets).toEqual({ villus: 'data:image/png;base64,AAAA' });
  });

  it('refuses anything that is not a lesson', () => {
    expect(readSavedClass(null)).toBeNull();
    expect(readSavedClass({ lesson: { title: 'x' }, assets: {} })).toBeNull();
  });

  it('keeps only pictures given as strings', () => {
    expect(readSavedClass({ lesson, assets: { a: 'data:image/png;base64,AA', b: 3 } })?.assets).toEqual({
      a: 'data:image/png;base64,AA',
    });
  });
});
