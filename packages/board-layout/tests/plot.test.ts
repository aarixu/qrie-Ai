import { describe, expect, it } from 'vitest';
import { validateLesson, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

const beat = (board: Instruction[]): ScriptBeat => ({ id: 'b1', topic: 't', narration: '', board });
const plots = (elements: Element[]) => elements.filter((el): el is Extract<Element, { kind: 'plot' }> => el.kind === 'plot');

/** C3: a graph computed from a formula, never drawn by a model. */
describe('a plot', () => {
  it('lays out a graph of the formula it was given', () => {
    const { elements, undrawn } = layoutBeat(
      beat([
        { do: 'say', text: 'Watch how y grows.' },
        { do: 'plot', fn: 'x^2 - 4', from: -3, to: 3, caption: 'y = x² − 4', x: 'x', y: 'y' },
      ]),
    );
    const [plot] = plots(elements);
    expect(plot.fn).toBe('x^2 - 4');
    expect(plot.from).toBe(-3);
    expect(plot.to).toBe(3);
    expect(plot.w).toBeGreaterThan(200);
    expect(plot.h).toBeGreaterThan(120);
    expect(undrawn).toEqual([]);
  });

  it('draws nothing for a formula it cannot read, and says so', () => {
    const { elements, undrawn } = layoutBeat(
      beat([{ do: 'say', text: 'Watch.' }, { do: 'plot', fn: 'window.alert(1)', from: 0, to: 1 }]),
    );
    expect(plots(elements)).toEqual([]);
    expect(undrawn.map((u) => u.do)).toEqual(['plot']);
  });

  it('sits beside the key points about it, like a figure', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'say', text: 'Here is the curve.' },
        { do: 'plot', fn: '2x + 1', from: 0, to: 5 },
        { do: 'say', text: 'It goes up by two.' },
        { do: 'write', text: 'Slope is 2' },
      ]),
    );
    const [plot] = plots(elements);
    const point = elements.find((el) => el.kind === 'handwrite')!;
    expect(point.x).toBeGreaterThan(plot.x + plot.w);
  });
});

describe('a plot element is validated', () => {
  const lessonWith = (el: Record<string, unknown>) => ({
    id: 'p',
    formatVersion: 1,
    language: 'en',
    title: 'P',
    topicRef: { syllabus: 's', topic: 't' },
    canvas: { w: 1000, h: 620 },
    elements: [el],
    beats: [{ id: 'b1', topic: 'graph', narration: 'n', show: [el.id], focus: [] }],
  });
  const plot = { kind: 'plot', id: 'g', x: 100, y: 150, w: 400, h: 250, fn: 'sin(x)', from: 0, to: 6.28 };

  it('accepts one it can compute', () => {
    expect(validateLesson(lessonWith(plot)).ok).toBe(true);
  });

  it('refuses a formula it cannot read, and a range that runs backwards', () => {
    expect(validateLesson(lessonWith({ ...plot, fn: 'x +* 2' })).ok).toBe(false);
    expect(validateLesson(lessonWith({ ...plot, from: 5, to: 1 })).ok).toBe(false);
  });
});
