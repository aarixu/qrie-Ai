// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';

/**
 * WHAT SHE WRITES IS IN A NORMAL FACE (Aarav, 2026-10-07).
 *
 * "Writing font ko normal kr do, ye handwriting ajeeb lg rhi hai." Her lines,
 * the names under pictures and a picture's placeholder are drawn in the
 * board's own face, the one the ruler in lesson-format measures, and never in
 * a handwriting face.
 */

const els: Element[] = [
  { kind: 'handwrite', id: 'kp', x: 500, y: 300, text: 'Pulmonary loop', size: 22 },
  { kind: 'graphic', id: 'g', x: 100, y: 100, w: 120, h: 120, noun: 'runner', label: 'Working muscles' },
];
const lesson: Lesson = {
  formatVersion: 1,
  id: 'c',
  title: 'C',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: els,
  beats: [{ id: 'b', topic: 't', narration: 'n', show: els.map((e) => e.id) }],
};

describe('the face she writes in', () => {
  it('is the board face, not a handwriting face', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<Scene lesson={lesson} visible={['kp', 'g']} focus={[]} />));
    const faces = [...host.querySelectorAll('text')]
      .filter((t) => /Pulmonary loop|Working muscles|runner/.test(t.textContent ?? ''))
      .map((t) => t.getAttribute('font-family') ?? '');
    expect(faces.length).toBeGreaterThanOrEqual(2);
    for (const face of faces) {
      expect(face).toMatch(/^'Quicksand Variable'/);
      expect(face).not.toMatch(/Caveat|cursive|Script|Hand/);
    }
    act(() => root.unmount());
  });
});
