import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { lessonFolder, pictureUrls } from '../src/lib/diagrams';

/**
 * THE LESSON'S ARTWORK, UNDER THE APP'S OWN ROOT (Aarav, 2026-10-03: "koi
 * image nahi dikha raha"). The site serves the tutor at /app/, and the folder
 * was built from the origin root: /class10-respiration/assets.json, a 404 —
 * so on the live site no lesson drew a single graphic, diagram or drawing.
 */
describe('where a lesson’s artwork is fetched from', () => {
  const entry = (path: string) => ({ id: 'x', title: 'x', path }) as never;

  it('is under the app’s root, whichever it is', () => {
    expect(lessonFolder(entry('class10-respiration/lesson.json'), '/app/')).toBe('/app/class10-respiration');
    expect(lessonFolder(entry('class10-respiration/lesson.json'), '/')).toBe('/class10-respiration');
  });

  it('is the class’s own place when the class carries a whole URL', () => {
    expect(lessonFolder(entry('https://cdn.example/classes/k1/lesson.json'), '/app/')).toBe('https://cdn.example/classes/k1');
  });
});

describe('a picture named relative to its lesson', () => {
  const lesson = {
    elements: [
      { kind: 'image', id: 'rel', src: 'generated/cell.png' },
      { kind: 'image', id: 'abs', src: 'https://upload.wikimedia.org/x.png' },
      { kind: 'image', id: 'root', src: '/class10-x/generated/y.png' },
      { kind: 'box', id: 'b' },
    ],
  } as unknown as Lesson;

  it('is loaded from the lesson’s folder, not from the page’s address', () => {
    expect(pictureUrls(lesson, '/app/class10-x')).toEqual({ rel: '/app/class10-x/generated/cell.png' });
  });
});
