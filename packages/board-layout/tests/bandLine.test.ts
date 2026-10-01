import { describe, expect, it } from 'vitest';
import { PAGE_STRIDE, boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * ONE SPOKEN LINE, ONE PAGE — under a labelled picture too (2026-10-02).
 *
 * The Respiration class prepared that night was refused for it: under the
 * yeast picture, "let us compare all three pathways side by side" wrote a list
 * (which goes in the band under the picture) and a card (which goes to the next
 * page). One line on two pages; the camera followed the card and the list was
 * never on screen.
 */
const parts = new Map([['yeast', [{ name: 'cell', x: 0.3, y: 0.3, w: 0.3, h: 0.3 }]]]);
const pageOf = (el: Element): number => Math.floor((boxOf(el).x + boxOf(el).w / 2) / PAGE_STRIDE);

const board: Instruction[] = [
  { do: 'picture', ref: 'yeast' },
  { do: 'say', text: 'This is a yeast cell.' },
  { do: 'label', target: 'yeast#cell', text: 'Yeast cell' },
  { do: 'say', text: 'It makes alcohol without oxygen.' },
  { do: 'write', text: 'No oxygen: ethanol + CO2' },
  { do: 'say', text: 'Let us compare all three pathways side by side.' },
  {
    do: 'list',
    heading: 'Comparing the three pathways',
    items: [
      { term: 'Aerobic', meaning: 'CO2 + water, a lot of energy' },
      { term: 'Yeast', meaning: 'ethanol + CO2, a little energy' },
      { term: 'Muscle', meaning: 'lactic acid, a little energy' },
    ],
  },
  { do: 'card', heading: 'Remember', body: 'Only aerobic respiration uses oxygen.' },
];

describe('a line under a labelled picture', () => {
  const beat: ScriptBeat = { id: 'b5', topic: 't', narration: '', board };
  const { elements } = layoutBeat(beat, parts);
  const byId = (id: string) => elements.filter((el) => el.id === id || el.id.startsWith(`${id}_`));

  it('writes its list and its card on one page', () => {
    const list = elements.find((el) => el.kind === 'list')!;
    const card = byId('b5_7')[0];
    expect(card).toBeDefined();
    expect(pageOf(list)).toBe(pageOf(card));
  });

  it('keeps the lines before it under the picture', () => {
    const picture = elements.find((el) => el.kind === 'image')!;
    const point = elements.find((el) => el.kind === 'handwrite' && el.text.startsWith('No oxygen'))!;
    expect(pageOf(point)).toBe(pageOf(picture));
  });
});
