import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

const beat = (board: Instruction[]): ScriptBeat => ({ id: 'b1', topic: 't', narration: '', board });
type Formula = Extract<Element, { kind: 'formula' }>;
const formulas = (elements: Element[]) => elements.filter((el): el is Formula => el.kind === 'formula');

/** Where the `=` of a formula line sits, measured as the board measures it. */
const equalsAt = (el: Formula): number => {
  const b = boxOf(el);
  const eq = el.text.indexOf('=');
  return b.x + (b.w * (eq + 0.5)) / el.text.length;
};

/** C3: working written step under step, the equals signs in one column. */
describe('a derivation', () => {
  const steps = ['2x + 3 = 11', '2x = 8', 'x = 4'];

  it('writes each step on its own line, top to bottom', () => {
    const { elements } = layoutBeat(beat([{ do: 'say', text: 'Solve it.' }, { do: 'derive', steps }]));
    const lines = formulas(elements);
    expect(lines.map((l) => l.text)).toEqual(steps);
    expect(lines[1].y).toBeGreaterThan(lines[0].y);
    expect(lines[2].y).toBeGreaterThan(lines[1].y);
  });

  it('lines the equals signs up in one column', () => {
    const { elements } = layoutBeat(beat([{ do: 'say', text: 'Solve it.' }, { do: 'derive', steps }]));
    const columns = formulas(elements).map(equalsAt);
    for (const c of columns) expect(Math.abs(c - columns[0])).toBeLessThan(1);
  });

  it('writes each step after the one above it, not all at once', () => {
    const { elements } = layoutBeat(beat([{ do: 'say', text: 'Solve it.' }, { do: 'derive', steps }]));
    const [a, b, c] = formulas(elements);
    expect(a.after ?? 0).toBe(0);
    expect(b.after).toBeGreaterThan(0);
    expect(c.after).toBeGreaterThan(b.after!);
  });

  it('draws nothing for no steps, and says so', () => {
    const { elements, undrawn } = layoutBeat(beat([{ do: 'say', text: 'Solve.' }, { do: 'derive', steps: [] }]));
    expect(formulas(elements)).toEqual([]);
    expect(undrawn.map((u) => u.do)).toEqual(['derive']);
  });
});
