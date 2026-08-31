import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';

/**
 * THE PAINTER'S FOUR MOTIONS.
 *
 * A generated diagram may mark a shape `curie-drift`, `curie-flow`,
 * `curie-pulse` or `curie-sway`, and the board makes it move — ink wanders,
 * a current runs along its wire, a heart beats, a leaf rocks. The vocabulary
 * is closed and the gate rejects anything outside it, so the renderer can own
 * these four completely.
 *
 * This is what makes a process feel like a process instead of a still: the
 * whole reason to draw diffusion rather than photograph it.
 */

const diagram = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620">
  <g id="ink">
    <circle class="curie-drift" cx="500" cy="300" r="8" fill="var(--a, #06c)"/>
    <path class="curie-flow" d="M 100 500 L 900 500" stroke="var(--a, #06c)" fill="none"/>
  </g>
</svg>`;

const lesson: Lesson = {
  formatVersion: 1,
  id: 'm',
  title: 'Diffusion',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [
    { kind: 'diagram', id: 'd1', x: 100, y: 150, w: 800, h: 400, src: 'd1.svg', alt: 'ink in water', parts: ['ink'] },
  ],
  beats: [{ id: 'b', topic: 't', narration: 'n', show: ['d1'] }],
};

const html = renderToString(
  <Scene lesson={lesson} visible={['d1']} focus={[]} assets={{ d1: diagram }} />,
);

describe('a drawing that moves', () => {
  it('keeps the motion marks on the inlined shapes', () => {
    expect(html).toContain('curie-drift');
    expect(html).toContain('curie-flow');
  });

  it('owns what every motion means', () => {
    for (const motion of ['curie-drift', 'curie-flow', 'curie-pulse', 'curie-sway']) {
      expect(html).toContain(`@keyframes ${motion}`);
    }
  });

  it('holds still for someone who asked motion to stop', () => {
    // prefers-reduced-motion is a promise the whole page keeps, including her
    // drawings.
    const reduced = html.slice(html.indexOf('prefers-reduced-motion'));
    expect(reduced.length).toBeGreaterThan(20);
    expect(reduced).toContain('curie');
  });
});
