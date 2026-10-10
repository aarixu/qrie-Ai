import { describe, expect, it } from 'vitest';
import { validateLesson } from '../src/index';

/**
 * A PICTURE OF SOMETHING MOVING MAY MOVE (Aarav, 2026-10-07: "images ya videos
 * ya kuch or jo bhi ho").
 *
 * A picture whose lesson is the movement itself — a heart pumping, a person
 * running — carries the silent loop found for it. The still stays its `src`:
 * what is drawn before the loop plays, and instead of it where it cannot.
 */

const lessonWith = (video: unknown) => ({
  formatVersion: 1,
  id: 'c',
  title: 'C',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'image', id: 'p', x: 0, y: 0, w: 300, h: 200, src: 'generated/p.jpg', alt: 'a heart beating', video }],
  beats: [{ id: 'b', topic: 't', narration: 'n', show: ['p'] }],
});

const webm = { src: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/3/3f/Heart.webm/Heart.webm.480p.vp9.webm', type: 'video/webm' };

describe('a moving picture', () => {
  it('is accepted with one or more web sources', () => {
    expect(validateLesson(lessonWith([webm])).ok).toBe(true);
    expect(validateLesson(lessonWith([webm, { ...webm, src: webm.src.replace('480p', '240p') }])).ok).toBe(true);
  });

  it('plays only from a web address, never a script or a page-relative path', () => {
    expect(validateLesson(lessonWith([{ ...webm, src: 'javascript:alert(1)' }])).ok).toBe(false);
    expect(validateLesson(lessonWith([{ ...webm, src: 'http://example.org/a.webm' }])).ok).toBe(false);
  });

  it('plays only from where the class finds its loops, Wikimedia\'s file host (review, 2026-10-08)', () => {
    // A saved class is data from a store: a loop it names autoplays on every
    // student's board, so it may come only from the one place they are found.
    expect(validateLesson(lessonWith([{ ...webm, src: 'https://example.org/a.webm' }])).ok).toBe(false);
  });

  it('names a video type the board can play', () => {
    expect(validateLesson(lessonWith([{ ...webm, type: 'text/html' }])).ok).toBe(false);
    expect(validateLesson(lessonWith([{ src: webm.src }])).ok).toBe(false);
  });

  it('is a list of sources, not one, and not an empty one', () => {
    expect(validateLesson(lessonWith(webm)).ok).toBe(false);
    expect(validateLesson(lessonWith([])).ok).toBe(false);
  });
});
