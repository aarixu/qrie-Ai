// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';

/**
 * WHAT SHE HAS JUST WRITTEN IS NOT DIMMED (human heart, 2026-10-07).
 *
 * A line that lit one loop of the circulation diagram also wrote its key point
 * under it, and the key point came out at 40%: the light dims everything that
 * is not the part. What arrives on the line itself stays at full strength.
 */

const els: Element[] = [
  { kind: 'box', id: 'heart', x: 100, y: 100, w: 200, h: 150, label: 'heart' },
  { kind: 'box', id: 'old', x: 400, y: 100, w: 200, h: 100, label: 'old' },
  { kind: 'handwrite', id: 'kp', x: 500, y: 400, text: 'Pulmonary loop', size: 22 },
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

const opacityOf = (host: HTMLElement, id: string): string | null =>
  host.querySelector(`[data-element-id="${id}"]`)?.getAttribute('opacity') ?? null;

describe('the light on a part', () => {
  it('dims what was there before, not what this line writes', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<Scene lesson={lesson} visible={['heart', 'old']} focus={[]} />));
    act(() => root.render(<Scene lesson={lesson} visible={['heart', 'old', 'kp']} focus={['heart']} />));
    expect(opacityOf(host, 'old')).toBe('0.4');
    expect(opacityOf(host, 'kp')).toBeNull();
    act(() => root.unmount());
  });
});
