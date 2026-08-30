import { describe, expect, it } from 'vitest';
import { validateLesson, type Beat, type Element } from '@ai-tutor/lesson-format';
import { assemble } from '../src/prepare';
import type { Blueprint } from '../src/types';

// Probe for the reviewer claim: re-shown diagram in b3 -> dead blank page + dup id in show.
const blueprint: Blueprint = {
  id: 'demo',
  title: 'Speed',
  beats: [
    { id: 'b1', topic: 'open', narration: 'Here we go.', board: [{ do: 'title', text: 'Speed' }] },
    {
      id: 'b2',
      topic: 'graph',
      narration: 'Look at the slope.',
      board: [
        { do: 'diagram', ref: 'd_graph' },
        { do: 'point', ref: 'd_graph', part: 'line_fast' },
        { do: 'caption', text: 'Steeper means faster.' },
      ],
    },
    {
      id: 'b3',
      topic: 'only art',
      narration: 'And here it is again.',
      board: [{ do: 'diagram', ref: 'd_graph' }],
    },
  ],
  visuals: [
    { id: 'd_graph', parts: ['axes', 'line_fast'], brief: 'a graph', alt: 'a distance-time graph' },
  ],
};

describe('claim probe', () => {
  it('reproduces: dead blank third page + duplicate d_graph in b3.show, validation still ok', () => {
    const { lesson } = assemble(blueprint, new Set(['d_graph']));
    const doc = lesson as { canvas: { w: number; h: number }; elements: Element[]; beats: Beat[] };

    // Validation passes, so nothing pins this behavior.
    expect(validateLesson(lesson).ok).toBe(true);

    // Three pages claimed -> canvas w = 2*1080 + 1000 = 3160.
    expect(doc.canvas.w).toBe(3160);

    // ...but page 2 (x in [2160, 3160)) holds no element at all: dead blank page.
    const onPage3 = doc.elements.filter((e) => 'x' in e && (e as { x: number }).x >= 2160);
    expect(onPage3.map((e) => e.id)).toEqual([]);

    // Only one d_graph element exists (the dedup kept b2's copy on page 1).
    const copies = doc.elements.filter((e) => e.id === 'd_graph');
    expect(copies).toHaveLength(1);
    expect((copies[0] as { x: number }).x).toBeGreaterThanOrEqual(1080);
    expect((copies[0] as { x: number }).x).toBeLessThan(2160);

    // b3.show lists 'd_graph' twice: once via shownSoFar (from b2), once via its own step.show.
    const b3 = doc.beats.find((b) => b.id === 'b3');
    expect(b3).toBeDefined();
    const dupCount = (b3!.show as string[]).filter((id) => id === 'd_graph').length;
    expect(dupCount).toBe(2);

    // The camera frame points at the (b2-page) copy, i.e. pans back rather than to page 2.
    expect(b3!.frame).toEqual(['d_graph']);
  });
});
