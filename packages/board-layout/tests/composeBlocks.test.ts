import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction } from '../src/types';

const beat = (board: Instruction[]) => ({ id: 'b1', topic: 't', narration: '', board });

describe('a summary', () => {
  it('is a banner with its words inside it, on a stacked board too', () => {
    const made = layoutBeat(beat([{ do: 'say', text: 'So remember this.' }, { do: 'summary', text: 'Villi absorb digested food' }]));
    const banner = made.elements.find((e) => e.kind === 'box') as Extract<Element, { kind: 'box' }>;
    expect(banner).toMatchObject({ as: 'banner', tone: 'accent', label: '' });
    const words = made.elements.filter((e) => e.kind === 'text');
    expect(words.map((w) => (w as { text: string }).text).join(' ')).toBe('Villi absorb digested food');
    const frame = boxOf(banner);
    for (const w of words) {
      const b = boxOf(w);
      expect(b.x).toBeGreaterThanOrEqual(frame.x);
      expect(b.x + b.w).toBeLessThanOrEqual(frame.x + frame.w);
      expect(b.y).toBeGreaterThanOrEqual(frame.y);
      expect(b.y + b.h).toBeLessThanOrEqual(frame.y + frame.h);
    }
    expect(made.bonds.filter((bond) => bond.a === banner.id)).toHaveLength(words.length);
  });
});

describe('a comparison', () => {
  const compare: Instruction = {
    do: 'compare',
    left: { heading: 'Without villi', points: ['smooth wall', 'small surface', 'slow absorption'] },
    right: { heading: 'With villi', points: ['millions of fingers', 'huge surface', 'fast absorption'] },
  };

  it('writes two headed columns whose points face each other row by row', () => {
    const made = layoutBeat(beat([{ do: 'say', text: 'Compare the two.' }, compare]));
    const texts = made.elements.filter((e) => e.kind === 'text') as Extract<Element, { kind: 'text' }>[];
    const at = (t: string) => texts.find((x) => x.text === t)!;
    expect(at('Without villi').y).toBe(at('With villi').y);
    expect(at('smooth wall').y).toBe(at('millions of fingers').y);
    expect(at('slow absorption').y).toBe(at('fast absorption').y);
    expect(at('smooth wall').x).toBeLessThan(at('millions of fingers').x);
    expect(made.elements.filter((e) => e.kind === 'box')).toHaveLength(1);
  });

  it('draws nothing for a side with one point, and the board says so', () => {
    const thin: Instruction = { ...compare, left: { heading: 'Without', points: ['smooth'] } } as Instruction;
    const made = layoutBeat(beat([{ do: 'say', text: 'Compare the two.' }, thin]));
    expect(made.elements).toEqual([]);
    expect(made.undrawn).toEqual([{ index: 1, do: 'compare', text: 'Without' }]);
  });
});

describe('a title with a path', () => {
  it('is written as before on a stacked board', () => {
    const plain = layoutBeat(beat([{ do: 'title', text: 'Villi' }]));
    const pathed = layoutBeat(beat([{ do: 'title', text: 'Villi', path: ['Small intestine', 'Villi'] }]));
    expect(pathed.elements).toEqual(plain.elements);
  });
});
