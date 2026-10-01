import { describe, expect, it } from 'vitest';
import { boxOf } from '@ai-tutor/lesson-format';
import { findOverlaps } from '../src/overlap';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * A CONNECTOR'S WORDS NEVER SIT ON A PICTURE.
 *
 * A connector's label is written at the middle of its arrow. Join two things
 * that are not neighbours in a row and the arrow runs straight through the
 * thing between them — and so does its label, over that thing's icon and its
 * name. The solver can only move the label inside the region round the two
 * ends, and a scene that shares its beat with key points is given the 150-unit
 * floor, which leaves no free strip in that region at all. So the label was
 * shrunk to 13.8 and left where it was, and the keep gate refused the class.
 *
 * All three overlaps that refused Class 10 Science on 2026-10-01 were this one
 * shape: `b3__dough_bowl` under `b3_7_label` (respiration), `b4__art` under
 * `b4_4_label` and `b1__food_air` under `b1_6_label` (transportation). The
 * fixtures below are that shape: a respiration scene, as the audit and a seeded
 * search reproduced it with no model call.
 */

const overlapsOf = (laid: ReturnType<typeof layoutBeat>) => findOverlaps(laid.elements, { bonds: laid.bonds });
const beat = (id: string, board: Instruction[]): ScriptBeat => ({ id, topic: 't', narration: '', board });

/** The audit's case A: yeast to the dough bowl, with the sugar standing between them, and two key points. */
const yeast = beat('b3', [
  { do: 'title', text: 'Anaerobic respiration in yeast' },
  { do: 'say', text: 'Yeast lives in the dough.' },
  { do: 'place', id: 'yeast', noun: 'yeast', label: 'yeast cells' },
  { do: 'place', id: 'sugar', noun: 'sugar', label: 'sugar (glucose)' },
  { do: 'place', id: 'dough_bowl', noun: 'bowl', label: 'dough bowl' },
  { do: 'say', text: 'Without oxygen yeast breaks sugar.' },
  { do: 'connect', from: 'yeast', to: 'dough_bowl', label: 'releases carbon dioxide gas' },
  { do: 'say', text: 'This is fermentation.' },
  { do: 'write', text: 'Glucose -> ethanol + carbon dioxide + energy' },
  { do: 'write', text: 'No oxygen is used: anaerobic respiration' },
]);

/** Three respiration scenes a seeded search found overlapping before any picture existed. */
const RESPIRATION = 'Now what happens when living cells do not have oxygen?';
const KEY_POINT = { do: 'write', text: 'Anaerobic respiration: glucose to ethanol and carbon dioxide' } as const;
const found: ScriptBeat[] = [
  beat('b3', [
    { do: 'say', text: RESPIRATION },
    { do: 'place', id: 'alcohol', noun: 'bottle', label: 'Ethanol', group: 'g' },
    { do: 'place', id: 'co2', noun: 'bubbles', label: 'Carbon dioxide', group: 'g' },
    { do: 'place', id: 'energy', noun: 'lightning', label: 'Energy' },
    { do: 'place', id: 'sugar', noun: 'sugar', label: 'Sugar (glucose)' },
    { do: 'place', id: 'yeast', noun: 'yeast', label: 'Yeast' },
    { do: 'say', text: 'Watch the yeast.' },
    { do: 'connect', from: 'co2', to: 'sugar', label: 'releases' },
    { do: 'connect', from: 'sugar', to: 'energy', label: 'gives off' },
    { do: 'connect', from: 'energy', to: 'alcohol', label: 'eats' },
    KEY_POINT,
  ]),
  beat('b3', [
    { do: 'say', text: RESPIRATION },
    { do: 'place', id: 'dough_bowl', noun: 'bowl', label: 'Dough' },
    { do: 'place', id: 'co2', noun: 'bubbles', label: 'Carbon dioxide' },
    { do: 'place', id: 'yeast', noun: 'yeast', label: 'Yeast', group: 'g' },
    { do: 'place', id: 'alcohol', noun: 'bottle', label: 'Ethanol' },
    { do: 'place', id: 'energy', noun: 'lightning', label: 'Energy' },
    { do: 'say', text: 'Watch the yeast.' },
    { do: 'connect', from: 'co2', to: 'alcohol', label: 'gives off' },
    { do: 'connect', from: 'co2', to: 'dough_bowl', label: 'gives off' },
    { do: 'connect', from: 'co2', to: 'yeast', label: 'broken down without oxygen' },
    KEY_POINT,
  ]),
  beat('b3', [
    { do: 'say', text: RESPIRATION },
    { do: 'place', id: 'dough_bowl', noun: 'bowl', label: 'Dough', group: 'g' },
    { do: 'place', id: 'yeast', noun: 'yeast', label: 'Yeast' },
    { do: 'place', id: 'sugar', noun: 'sugar', label: 'Sugar (glucose)' },
    { do: 'place', id: 'co2', noun: 'bubbles', label: 'Carbon dioxide' },
    { do: 'say', text: 'Watch the yeast.' },
    { do: 'connect', from: 'co2', to: 'yeast', label: 'gives off' },
    { do: 'connect', from: 'sugar', to: 'dough_bowl', label: 'releases' },
    KEY_POINT,
  ]),
];

describe('a connector across a row', () => {
  it('writes its words clear of the thing it runs past', () => {
    expect(overlapsOf(layoutBeat(yeast))).toEqual([]);
  });

  it('writes them above the row, still over its own arrow', () => {
    const laid = layoutBeat(yeast);
    const words = boxOf(laid.elements.find((el) => el.id === 'b3_6_label')!);
    const graphics = laid.elements.filter((el) => el.kind === 'graphic').map(boxOf);
    const rowTop = Math.min(...graphics.map((g) => g.y));
    expect(words.y + words.h).toBeLessThanOrEqual(rowTop);
    const arrow = laid.elements.find((el) => el.id === 'b3_6')! as { from: { x: number }; to: { x: number } };
    const centre = words.x + words.w / 2;
    expect(centre).toBeGreaterThan(Math.min(arrow.from.x, arrow.to.x));
    expect(centre).toBeLessThan(Math.max(arrow.from.x, arrow.to.x));
  });

  it('never lifts the words out of the teaching band, over the heading', () => {
    const laid = layoutBeat(yeast);
    // MAIN starts at 150; the solver's own first room starts ten above it.
    for (const el of laid.elements.filter((e) => e.kind !== 'title')) expect(boxOf(el).y).toBeGreaterThanOrEqual(140);
  });

  found.forEach((shape, n) => {
    it(`clears respiration scene ${n + 1} of the seeded search`, () => {
      expect(overlapsOf(layoutBeat(shape))).toEqual([]);
    });
  });
});
