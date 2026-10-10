import { describe, expect, it } from 'vitest';
import type { Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

const beat = (board: Instruction[]): ScriptBeat => ({ id: 'b1', topic: 't', narration: '', board });
const tools = (elements: Element[]) => elements.filter((el): el is Extract<Element, { kind: 'tool' }> => el.kind === 'tool');
const air = { slices: [{ label: 'Nitrogen', value: 78 }, { label: 'Oxygen', value: 21 }, { label: 'Other', value: 1 }], percent: true };

describe('a tool on the board', () => {
  it('becomes one tool element carrying its params, at its shape', () => {
    const { elements, undrawn } = layoutBeat(beat([{ do: 'say', text: 'Look at what air is made of.' }, { do: 'pieChart', ...air }]));
    const [pie] = tools(elements);
    expect(pie.tool).toBe('pieChart');
    expect(pie.params).toEqual(air);
    expect(pie.w / pie.h).toBeCloseTo(1.6, 1);
    expect(pie.w).toBeGreaterThanOrEqual(340);
    expect(undrawn).toEqual([]);
  });

  it('waits for its anchor word, like a written line', () => {
    const { elements } = layoutBeat(
      beat([{ do: 'say', text: 'Air is mostly nitrogen, with some oxygen.' }, { do: 'pieChart', at: 'nitrogen', ...air }]),
    );
    const [pie] = tools(elements);
    expect(pie.after).toBe(Math.round('Air is mostly '.length * (1000 / 14)));
    expect('at' in pie.params).toBe(false);
  });

  it('is still placed when its params are wrong, so validation can name them', () => {
    const { elements } = layoutBeat(beat([{ do: 'say', text: 'Look.' }, { do: 'pieChart', slices: [] }]));
    expect(tools(elements)).toHaveLength(1);
  });

  it('sits beside the key points about it, like a figure', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'say', text: 'Here is air.' },
        { do: 'pieChart', ...air },
        { do: 'say', text: 'Mostly nitrogen.' },
        { do: 'write', text: 'Nitrogen 78%' },
      ]),
    );
    const [pie] = tools(elements);
    const note = elements.find((el) => el.kind === 'handwrite')!;
    expect(note.x).toBeGreaterThan(pie.x + pie.w - 1);
  });
});
