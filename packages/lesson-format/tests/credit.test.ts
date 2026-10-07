import { describe, expect, it } from 'vitest';
import { validateLesson } from '../src/index';

/**
 * A PICTURE FROM THE WEB CARRIES ITS CREDIT (2026-10-07).
 *
 * Aarav's rule: a real thing on the board is a real photograph, found where
 * its licence lets a school build on it. CC BY and CC BY-SA ask for the
 * author and the licence to be shown with the work, so the credit travels on
 * the element the photograph is drawn as — and a photograph on a scene's
 * placed thing is saved as a file the element points at, with its shape.
 */

const lessonWith = (element: Record<string, unknown>) => ({
  formatVersion: 1,
  id: 'c',
  title: 'C',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [element],
  beats: [{ id: 'b', topic: 't', narration: 'n', show: [element.id] }],
});

const image = (over: Record<string, unknown> = {}) =>
  lessonWith({ kind: 'image', id: 'p', x: 0, y: 0, w: 300, h: 200, src: 'generated/p.jpg', alt: 'a runner', ...over });
const graphic = (over: Record<string, unknown> = {}) =>
  lessonWith({ kind: 'graphic', id: 'g', x: 0, y: 0, w: 120, h: 120, noun: 'runner', ...over });

const credit = {
  author: 'A. Person',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  page: 'https://commons.wikimedia.org/wiki/File:Runner.jpg',
};

describe('a credit on a picture', () => {
  it('is accepted on a picture and on a placed thing', () => {
    expect(validateLesson(image({ credit })).ok).toBe(true);
    expect(validateLesson(graphic({ credit, src: 'generated/photo_runner.jpg', aspect: 1.5 })).ok).toBe(true);
  });

  it('must name its licence', () => {
    expect(validateLesson(image({ credit: { author: 'A. Person' } })).ok).toBe(false);
    expect(validateLesson(image({ credit: { license: '' } })).ok).toBe(false);
  });

  it('links only to a web page, never to script', () => {
    // A credit's link is drawn as a link a student can follow; a saved class
    // is data from a store, and a "javascript:" link in it would run.
    expect(validateLesson(image({ credit: { ...credit, page: 'javascript:alert(1)' } })).ok).toBe(false);
    expect(validateLesson(image({ credit: { ...credit, licenseUrl: 'http://example.org' } })).ok).toBe(false);
  });

  it('is kept short enough to be a credit, not a paragraph', () => {
    expect(validateLesson(image({ credit: { ...credit, author: 'x'.repeat(400) } })).ok).toBe(false);
  });
});

describe('a photograph on a placed thing', () => {
  it('has a shape that is a real width over height', () => {
    for (const aspect of [0, -1, Number.NaN, 'wide']) {
      expect(validateLesson(graphic({ src: 'generated/photo_runner.jpg', aspect })).ok, String(aspect)).toBe(false);
    }
  });

  it('points at a file by a string, when it points at one', () => {
    expect(validateLesson(graphic({ src: 42 })).ok).toBe(false);
  });
});
