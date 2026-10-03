import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { renderBeats } from './helpers/beats';
import { SEQUENCE_CAP_MS, staggerDelays } from '../src/stagger';

const lesson = (elements: Element[]): Lesson => ({
  formatVersion: 1, id: 'l', title: 'L', language: 'en', canvas: { w: 1000, h: 620 },
  elements, beats: [{ id: 'b', topic: 't', narration: 'n', show: elements.map((e) => e.id) }],
});

const flow: Element = { kind: 'flow', id: 'f', x: 60, y: 200, w: 880, steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Intestine' }, { label: 'Blood' }] };
const chart: Element = { kind: 'chart', id: 'c', x: 100, y: 120, w: 700, h: 300, chartType: 'bar', data: Array.from({ length: 12 }, (_, i) => ({ label: `m${i}`, value: i + 1 })) };
const list: Element = { kind: 'list', id: 'l1', x: 80, y: 120, w: 600, heading: 'Parts', items: [{ term: 'Root' }, { term: 'Stem' }, { term: 'Leaf' }] };
const title: Element = { kind: 'title', id: 't', x: 500, y: 60, text: 'Title' };

/** The animation delays of `selector` inside `node`, read off the style attribute (SVG-safe in jsdom). */
const delaysIn = (node: globalThis.Element | null, selector = '[style*="animation-delay"]'): number[] =>
  [...node!.querySelectorAll(selector)].map((n) => Number(/animation-delay:\s*(\d+)ms/.exec(n.getAttribute('style') ?? '')?.[1] ?? NaN));
const groupOf = (board: HTMLElement, id: string) => board.querySelector(`[data-element-id="${id}"]`);

describe('staggerDelays', () => {
  it('squeezes the gaps so the last piece starts within the cap', () => {
    expect(staggerDelays(4, 450, SEQUENCE_CAP_MS)).toEqual([0, 450, 900, 1350]);
    const many = staggerDelays(20, 450, SEQUENCE_CAP_MS);
    expect(many[19]).toBeLessThanOrEqual(SEQUENCE_CAP_MS);
    expect(many).toHaveLength(20);
  });
});

describe('pieces arrive in order when new', () => {
  it('flow: each step on its beat, an arrow drawn after each, and no pop for the whole', () => {
    const board = renderBeats(lesson([flow]), [['f']]);
    const group = groupOf(board, 'f')!;
    expect(delaysIn(group, 'g.stage-pop')).toEqual(staggerDelays(4, 450, SEQUENCE_CAP_MS));
    expect(group.querySelectorAll('line.stage-draw')).toHaveLength(3);
    expect(group.querySelector(':scope > g')!.getAttribute('class')).toBeNull();
  });

  it('chart: twelve bars still finish growing inside the cap', () => {
    const board = renderBeats(lesson([chart]), [['c']]);
    const group = groupOf(board, 'c')!;
    expect(group.querySelectorAll('.stage-grow')).toHaveLength(12);
    expect(Math.max(...delaysIn(group))).toBeLessThanOrEqual(SEQUENCE_CAP_MS + 500);
  });

  it('list: one item after another', () => {
    const board = renderBeats(lesson([list]), [['l1']]);
    const listDelays = delaysIn(groupOf(board, 'l1'), 'g.stage-pop');
    expect(listDelays).toEqual([0, ...staggerDelays(3, 350, SEQUENCE_CAP_MS)]);
  });
});

describe('a board the student seeks back to is complete', () => {
  it('draws an element already there in the last beat with no animation at all', () => {
    const board = renderBeats(lesson([title, flow, chart, list]), [['t', 'f', 'c', 'l1'], ['t', 'f', 'c', 'l1', 'x']]);
    for (const id of ['f', 'c', 'l1']) {
      const group = groupOf(board, id)!;
      expect(group.querySelectorAll('.stage-pop, .stage-grow, .stage-draw')).toHaveLength(0);
      expect(delaysIn(group)).toEqual([]);
    }
  });
});
