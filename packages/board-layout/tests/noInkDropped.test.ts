import { describe, expect, it } from 'vitest';
import { boxOf, CANVAS_H } from '@ai-tutor/lesson-format';
import { findOverlaps } from '../src/overlap';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * EVERYTHING A BEAT ASKS FOR IS DRAWN, AND DRAWN ON THE BOARD.
 *
 * Two silent losses the overlap gate cannot see (canvas audit 2026-10-01, item
 * 6), because a thing that was never drawn overlaps nothing:
 *
 *   - a beat with a LABELLED picture placed the picture, its names, its key
 *     points and its lists by hand and then emptied the block list, so a note,
 *     a card, an equation or a whole scene in the same beat was never drawn —
 *     the prompt's own "definition banner beside a demonstration" among them;
 *     and with TWO figures in the beat every name was dropped instead;
 *   - a figure with its key points beside it wrote down the column and never
 *     turned the page, so four wrapped points ran off the bottom of a 620-unit
 *     board, through the caption on the way.
 */

const ids = (laid: ReturnType<typeof layoutBeat>): string[] => laid.elements.map((el) => el.id);
const beat = (id: string, board: Instruction[]): ScriptBeat => ({ id, topic: 't', narration: '', board });
const overlapsOf = (laid: ReturnType<typeof layoutBeat>) => findOverlaps(laid.elements, { bonds: laid.bonds });

describe('a labelled picture keeps what else its beat wrote', () => {
  const laid = layoutBeat(
    beat('b2', [
      { do: 'picture', ref: 'lungs' },
      { do: 'say', text: 'These are the lungs.' },
      { do: 'label', target: 'lungs#alveoli', text: 'Alveoli' },
      { do: 'card', as: 'banner', heading: 'Respiration', body: 'Breaking down food to release energy' },
      { do: 'note', text: 'Breathing is not respiration.' },
      { do: 'equation', text: 'glucose + oxygen -> carbon dioxide + water + energy' },
      { do: 'write', text: 'Gas exchange happens in the alveoli' },
    ]),
  );

  it('draws the banner, the note and the equation', () => {
    expect(ids(laid).some((id) => id.startsWith('b2_3'))).toBe(true);
    expect(ids(laid)).toContain('b2_4');
    expect(ids(laid)).toContain('b2_5');
  });

  it('puts them on a page of their own rather than over the picture', () => {
    expect(laid.pages).toBeGreaterThan(1);
    expect(overlapsOf(laid)).toEqual([]);
  });

  it('shows each of them on the line that asked for it', () => {
    const shown = laid.steps.at(-1)!.show;
    for (const id of ['b2_4', 'b2_5']) expect(shown).toContain(id);
  });
});

describe('a labelled picture and a scene in one beat', () => {
  it('draws the scene too', () => {
    const laid = layoutBeat(
      beat('b6', [
        { do: 'picture', ref: 'lungs' },
        { do: 'say', text: 'Air comes in.' },
        { do: 'label', target: 'lungs#trachea', text: 'Trachea' },
        { do: 'place', id: 'air', noun: 'air', label: 'air in' },
        { do: 'place', id: 'blood', noun: 'blood', label: 'blood' },
        { do: 'connect', from: 'air', to: 'blood', label: 'oxygen' },
      ]),
    );
    expect(ids(laid)).toEqual(expect.arrayContaining(['b6__air', 'b6__blood', 'b6_2']));
    expect(overlapsOf(laid)).toEqual([]);
  });
});

describe('two figures and names for one of them', () => {
  it('writes the names round the picture they name, and still draws the other figure', () => {
    const laid = layoutBeat(
      beat('b6', [
        { do: 'picture', ref: 'lungs' },
        { do: 'say', text: 'Air goes down the trachea to the alveoli.' },
        { do: 'label', target: 'lungs#trachea', text: 'Trachea' },
        { do: 'label', target: 'lungs#alveoli', text: 'Alveoli' },
        { do: 'flow', steps: [{ label: 'nose' }, { label: 'trachea' }, { label: 'lungs' }] },
      ]),
    );
    expect(ids(laid)).toEqual(expect.arrayContaining(['lungs', 'b6_2', 'b6_3', 'b6_4']));
    expect(overlapsOf(laid)).toEqual([]);
  });
});

describe('a figure with its key points beside it', () => {
  const laid = layoutBeat(
    beat('b5', [
      { do: 'diagram', ref: 'nephron' },
      { do: 'say', text: 'This is a nephron.' },
      { do: 'point', ref: 'nephron', part: 'glomerulus' },
      { do: 'write', text: 'Blood is filtered in the glomerulus under pressure' },
      { do: 'write', text: 'Useful substances like glucose are reabsorbed' },
      { do: 'write', text: "Water is reabsorbed depending on the body's need" },
      { do: 'write', text: 'What remains becomes urine' },
      { do: 'caption', text: 'The nephron: the filtering unit of the kidney' },
    ]),
  );

  it('turns the page rather than writing off the bottom of the board', () => {
    for (const el of laid.elements) {
      const b = boxOf(el);
      expect(b.y + b.h, el.id).toBeLessThanOrEqual(CANVAS_H);
    }
    expect(laid.pages).toBeGreaterThan(1);
  });

  it('keeps every key point clear of the caption and of each other', () => {
    expect(overlapsOf(laid)).toEqual([]);
  });

  it('draws all four points', () => {
    for (const id of ['b5_3', 'b5_4', 'b5_5', 'b5_6']) expect(ids(laid)).toContain(id);
  });
});
