import { describe, expect, it } from 'vitest';
import { boxOf, type ImagePart } from '@ai-tutor/lesson-format';
import { findOverlaps } from '../src/overlap';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * THE NAMES ROUND A PICTURE, ONCE THE PICTURE HAS BEEN LOOKED AT.
 *
 * A class is laid out twice: first before any picture exists (the draft the
 * room opens on, and the copy every in-prep gate judges), then again once each
 * picture's parts and shape are known (the copy that is kept). In the first
 * pass no part has a place, so the names alternate sides from the top and
 * never meet. In the second each name goes to the side its part is on and
 * level with it — and names were stacked in AUTHORING order, each below the
 * last and then clamped to the bottom of the figure, so a side whose first
 * name pointed low piled every later name onto the same spot. A class that
 * passed every check in preparation then failed the keep gate on its own
 * labels (canvas audit 2026-10-01, item 3: 34.5% of random 3-6-label pictures).
 */

const overlapsOf = (laid: ReturnType<typeof layoutBeat>) => findOverlaps(laid.elements, { bonds: laid.bonds });

/** The audit's case C: a kidney, five names, every part on the left, listed bottom-first. */
const kidney: Instruction[] = [
  { do: 'picture', ref: 'kidney' },
  { do: 'say', text: 'This is the kidney.' },
  { do: 'label', target: 'kidney#ureter', text: 'Ureter' },
  { do: 'label', target: 'kidney#renal artery', text: 'Renal artery' },
  { do: 'label', target: 'kidney#renal vein', text: 'Renal vein' },
  { do: 'label', target: 'kidney#cortex', text: 'Cortex' },
  { do: 'label', target: 'kidney#medulla', text: 'Medulla' },
  { do: 'write', text: 'Each kidney filters about 180 litres of blood a day' },
  { do: 'write', text: 'Urine leaves through the ureter' },
];
const kidneyParts = new Map<string, readonly ImagePart[]>([
  [
    'kidney',
    [
      { name: 'ureter', x: 0.1, y: 0.85, w: 0.1, h: 0.1 },
      { name: 'renal artery', x: 0.1, y: 0.35, w: 0.1, h: 0.08 },
      { name: 'renal vein', x: 0.15, y: 0.45, w: 0.1, h: 0.08 },
      { name: 'cortex', x: 0.05, y: 0.15, w: 0.15, h: 0.1 },
      { name: 'medulla', x: 0.2, y: 0.6, w: 0.15, h: 0.1 },
    ],
  ],
]);
const beat: ScriptBeat = { id: 'b2', topic: 'kidney', narration: '', board: kidney };

describe('names on a measured picture never land on each other', () => {
  it('lays the draft out clean, as before', () => {
    expect(overlapsOf(layoutBeat(beat))).toEqual([]);
  });

  for (const aspect of [1, 1.6, 0.6]) {
    it(`keeps them apart once the parts are known (aspect ${aspect})`, () => {
      expect(overlapsOf(layoutBeat(beat, kidneyParts, new Map([['kidney', aspect]])))).toEqual([]);
    });
  }

  it('writes a side top to bottom in the order its parts run, whatever order they were said in', () => {
    const laid = layoutBeat(beat, kidneyParts, new Map([['kidney', 1]]));
    const yOf = (id: string) => boxOf(laid.elements.find((el) => el.id === id)!).y;
    // cortex 0.15, renal artery 0.35, renal vein 0.45, medulla 0.6, ureter 0.85
    const order = ['b2_5', 'b2_3', 'b2_4', 'b2_6', 'b2_2'].map(yOf);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('still draws one line from each name to its part', () => {
    const laid = layoutBeat(beat, kidneyParts, new Map([['kidney', 1]]));
    for (const id of ['b2_2', 'b2_3', 'b2_4', 'b2_5', 'b2_6']) {
      expect(laid.elements.some((el) => el.id === `${id}_line`)).toBe(true);
    }
  });
});

describe('any labelled picture, measured, is no worse than its draft', () => {
  /** Deterministic, so a failure names its seed. */
  const rng = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const NAMES = [
    'Right atrium',
    'Left ventricle (pumps oxygenated blood to the body)',
    'Aorta',
    'Pulmonary artery',
    'Vena cava',
    'Septum',
    'Bowman capsule',
    'Glomerulus',
    'Renal artery',
    'Ureter',
  ];
  const WRITES = ['Blood carries oxygen to every cell', 'The heart has four chambers'];

  it('over 120 random pictures of 2-6 names, at four shapes each', () => {
    const worse: string[] = [];
    for (let seed = 1; seed <= 120; seed += 1) {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
      const board: Instruction[] = [{ do: 'say', text: 'Look.' }, { do: 'picture', ref: 'art' }];
      const n = 2 + Math.floor(r() * 5);
      const parts: ImagePart[] = [];
      for (let k = 0; k < n; k += 1) {
        const w = 0.08 + r() * 0.25;
        const h = 0.08 + r() * 0.25;
        parts.push({ name: `part${k}`, x: r() * (1 - w), y: r() * (1 - h), w, h });
        board.push({ do: 'say', text: `Here is part ${k}.` });
        board.push({ do: 'label', target: `art#part${k}`, text: pick(NAMES) });
      }
      for (let k = Math.floor(r() * 3); k > 0; k -= 1) board.push({ do: 'write', text: pick(WRITES) });
      const one: ScriptBeat = { id: 'b1', topic: 't', narration: '', board };
      if (overlapsOf(layoutBeat(one)).length > 0) continue;
      for (const aspect of [0.6, 1, 1.5, 2.5]) {
        const found = overlapsOf(layoutBeat(one, new Map([['art', parts]]), new Map([['art', aspect]])));
        if (found.length > 0) worse.push(`seed ${seed} aspect ${aspect}: ${JSON.stringify(found)}`);
      }
    }
    expect(worse).toEqual([]);
  });
});
