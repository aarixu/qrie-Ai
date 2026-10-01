import { describe, expect, it } from 'vitest';
import { boxOf } from '@ai-tutor/lesson-format';
import { findOverlaps } from '../src/overlap';
import { layoutBeat } from '../src/layout';
import type { ScriptBeat } from '../src/types';

/**
 * A CARD'S BODY WRAPS INSIDE ITS CARD.
 *
 * Each body was one line of text, shrunk to fit its card down to size 12 and
 * then simply left wider than the card: three forty-character bodies in a row
 * ran past their own frames into the next card (canvas audit 2026-10-01, item
 * 5), and the substitution-method plan was refused on `b4_2_c0` over `b4_2_b1`
 * for exactly this. Text cannot be moved by the solver, so nothing else was
 * ever going to fix it.
 */

const cards: ScriptBeat = {
  id: 'b5',
  topic: 't',
  narration: '',
  board: [
    { do: 'say', text: 'Three ways to break down glucose.' },
    { do: 'card', heading: 'Aerobic', body: 'Uses oxygen; glucose fully broken to CO2' },
    { do: 'card', heading: 'Anaerobic (yeast)', body: 'No oxygen; ethanol and CO2 are produced' },
    { do: 'card', heading: 'Anaerobic (muscle)', body: 'Lack of oxygen; lactic acid builds up' },
  ],
};

describe('three cards with sentence-long bodies', () => {
  const laid = layoutBeat(cards);

  it('overlap nothing', () => {
    expect(findOverlaps(laid.elements, { bonds: laid.bonds })).toEqual([]);
  });

  it('keep every word of a body inside its own card', () => {
    for (let n = 0; n < 3; n += 1) {
      const frame = boxOf(laid.elements.find((el) => el.id === `b5_1_c${n}`)!);
      const words = laid.elements.filter((el) => el.id === `b5_1_b${n}` || el.id.startsWith(`b5_1_b${n}_l`));
      expect(words.length).toBeGreaterThan(0);
      for (const w of words) {
        const b = boxOf(w);
        expect(b.x).toBeGreaterThanOrEqual(frame.x);
        expect(b.x + b.w).toBeLessThanOrEqual(frame.x + frame.w);
        expect(b.y + b.h).toBeLessThanOrEqual(frame.y + frame.h);
      }
    }
  });

  it('write the body at a size a desk can read, not 12', () => {
    for (const el of laid.elements.filter((e) => /_b\d/.test(e.id))) {
      expect((el as { size?: number }).size ?? 0).toBeGreaterThanOrEqual(13);
    }
  });

  it('say every word of the body, in order, across its lines', () => {
    const body = laid.elements
      .filter((el) => el.id === 'b5_1_b1' || el.id.startsWith('b5_1_b1_l'))
      .map((el) => (el as { text: string }).text)
      .join(' ');
    expect(body).toBe('No oxygen; ethanol and CO2 are produced');
  });
});

describe('a short body', () => {
  it('stays one line in the middle of its card, exactly as before', () => {
    const laid = layoutBeat({
      ...cards,
      board: [
        { do: 'card', heading: 'Aerobic', body: 'Uses oxygen' },
        { do: 'card', heading: 'Anaerobic', body: 'No oxygen' },
      ],
    });
    const frame = boxOf(laid.elements.find((el) => el.id === 'b5_0_c0')!);
    const body = laid.elements.find((el) => el.id === 'b5_0_b0')! as { y: number };
    expect(body.y).toBe(frame.y + 78);
    expect(laid.elements.some((el) => el.id.startsWith('b5_0_b0_l'))).toBe(false);
  });
});
