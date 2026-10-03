import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { computeFrame } from '../src/frame';

const picture: Element = {
  kind: 'image', id: 'p', x: 100, y: 120, w: 600, h: 400, src: 'p.png', alt: 'heart',
  parts: [{ name: 'ventricle', x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
};
const note: Element = { kind: 'handwrite', id: 'n', x: 820, y: 200, text: 'pumps' };
const lesson = (elements: Element[]): Lesson => ({
  formatVersion: 1, id: 'l', title: 'L', language: 'en', canvas: { w: 1000, h: 620 },
  elements, beats: [{ id: 'b', topic: 't', narration: 'n', show: elements.map((e) => e.id) }],
});
const contains = (outer: { x: number; y: number; w: number; h: number }, inner: { x: number; y: number; w: number; h: number }) =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;

describe('zoom to a pointed part', () => {
  const part = { x: 400, y: 320, w: 120, h: 80 };

  it('frames the part when the picture is the newest ink', () => {
    const plain = computeFrame(lesson([picture]), ['p'], [], 16 / 9);
    const zoomed = computeFrame(lesson([picture]), ['p'], ['p#ventricle'], 16 / 9);
    expect(zoomed.w).toBeLessThan(plain.w);
    expect(contains(zoomed, part)).toBe(true);
    expect(zoomed.w).toBeGreaterThanOrEqual(1000 / 3 - 0.5);
  });

  it('does not zoom when she has written after the picture', () => {
    const l = lesson([picture, note]);
    expect(computeFrame(l, ['p', 'n'], ['p#ventricle'], 16 / 9)).toEqual(computeFrame(l, ['p', 'n'], [], 16 / 9));
  });

  it('does not zoom to a part the picture does not have', () => {
    const l = lesson([picture]);
    expect(computeFrame(l, ['p'], ['p#atrium'], 16 / 9)).toEqual(computeFrame(l, ['p'], [], 16 / 9));
  });

  it('does not zoom to a diagram part, which has no box in the lesson', () => {
    const diagram: Element = { kind: 'diagram', id: 'd', x: 100, y: 120, w: 600, h: 400, src: 'd.svg', alt: 'd', parts: ['ventricle'] };
    const l = lesson([diagram]);
    expect(computeFrame(l, ['d'], ['d#ventricle'], 16 / 9)).toEqual(computeFrame(l, ['d'], [], 16 / 9));
  });
});
