import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction } from '../src/types';

/**
 * A SCENE A TEACHER WOULD HAVE DRAWN (small intestine, 2026-10-07).
 *
 * In the deployed class, the arrow from the stomach to the intestine ran
 * through an 18-unit gap between the rows, so its words had nowhere to go and
 * were shrunk to 14 and parked far from it; and the second arrow into the
 * intestinal lumen was pushed sideways through the lumen's name.
 */

const composed = (board: Instruction[]) =>
  layoutBeat({ id: 'b1', topic: 't', narration: '', board }, new Map(), new Map(), { composed: true });

type Arrow = Extract<Element, { kind: 'arrow' }>;
type Hand = Extract<Element, { kind: 'handwrite' }>;
const segmentHits = (a: Arrow, r: { x: number; y: number; w: number; h: number }): boolean => {
  for (let t = 0.05; t <= 0.95; t += 0.05) {
    const x = a.from.x + (a.to.x - a.from.x) * t;
    const y = a.from.y + (a.to.y - a.from.y) * t;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
};

describe('a composed scene', () => {
  it('writes the words of an arrow between two rows beside it, at a size a phone can read', () => {
    const made = composed([
      { do: 'say', text: 'Think about what happens after you eat.' },
      { do: 'place', id: 'stomach', noun: 'stomach', label: 'Stomach (partial digestion)', row: 0 },
      { do: 'place', id: 'intestine', noun: 'intestine', label: 'Small intestine (site of complete digestion)', row: 1 },
      { do: 'connect', from: 'stomach', to: 'intestine', label: 'acidic chyme enters', tone: 'accent' },
    ]);
    const arrow = made.elements.find((e) => e.kind === 'arrow') as Arrow;
    const words = made.elements.find((e) => e.kind === 'handwrite' && e.text === 'acidic chyme enters') as Hand;
    // The floor arrow words are written at: 15 in Quicksand (2026-10-07), whose
    // lowercase stands taller than Caveat's did at the 17 this used to hold.
    expect(words.size ?? 26).toBeGreaterThanOrEqual(15);
    const mid = { x: (arrow.from.x + arrow.to.x) / 2, y: (arrow.from.y + arrow.to.y) / 2 };
    const b = boxOf(words);
    expect(Math.hypot(b.x + b.w / 2 - mid.x, b.y + b.h / 2 - mid.y)).toBeLessThanOrEqual(110);
  });

  it('does not push an arrow sideways through a name when two arrows come into one thing from different sides', () => {
    const made = composed([
      { do: 'say', text: 'Two glands pour juices in.' },
      { do: 'place', id: 'liver', noun: 'liver', label: 'Liver', row: 0 },
      { do: 'place', id: 'pancreas', noun: 'pancreas', label: 'Pancreas', row: 0 },
      { do: 'place', id: 'duodenum', noun: 'tube', label: 'Intestinal lumen', row: 1 },
      { do: 'connect', from: 'liver', to: 'duodenum', label: 'Bile: alkaline & emulsifies', tone: 'accent' },
      { do: 'connect', from: 'pancreas', to: 'duodenum', label: 'Pancreatic juice: Trypsin & Lipase', tone: 'accent' },
    ]);
    const arrows = made.elements.filter((e) => e.kind === 'arrow') as Arrow[];
    expect(arrows).toHaveLength(2);
    // A name written beside its picture: the strip right of the icon, the middle of its height.
    const names = made.elements
      .filter((e): e is Extract<Element, { kind: 'graphic' }> => e.kind === 'graphic' && (e as { labelSide?: string }).labelSide === 'beside')
      .map((g) => ({ x: g.x + g.w + 22, y: g.y + g.h * 0.3, w: boxOf(g).w - g.w - 22, h: g.h * 0.4 }));
    expect(names.length).toBeGreaterThan(0);
    for (const a of arrows) for (const n of names) expect(segmentHits(a, n)).toBe(false);
  });
});
