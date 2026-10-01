import { describe, expect, it } from 'vitest';
import type { Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

const beat = (board: Instruction[]): ScriptBeat => ({ id: 'b1', topic: 't', narration: '', board });
const inkOf = (elements: Element[], kind: 'handwrite' | 'formula') =>
  elements.filter((el): el is Extract<Element, { kind: typeof kind }> => el.kind === kind);

/** C3: ink timed to the word she is saying, not to the start of her sentence. */
describe('a write anchored to a word', () => {
  const said = 'Food is broken down, and the energy it releases is what every cell uses.';

  it('waits until she reaches that word', () => {
    const { elements } = layoutBeat(
      beat([{ do: 'say', text: said }, { do: 'write', text: 'Energy for every cell', at: 'energy' }]),
    );
    const [line] = inkOf(elements, 'handwrite');
    const expected = said.toLowerCase().indexOf('energy') * (1000 / 14);
    expect(Math.abs((line.after ?? 0) - expected)).toBeLessThan(2);
  });

  it('adds the wait to every line of a write that wrapped', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'say', text: said },
        {
          do: 'write',
          text: 'Respiration releases the energy stored in food so that every cell of the body can do its work',
          at: 'energy',
        },
      ]),
    );
    const lines = inkOf(elements, 'handwrite');
    expect(lines.length).toBeGreaterThan(1);
    const wait = said.toLowerCase().indexOf('energy') * (1000 / 14);
    expect(lines[0].after).toBeGreaterThan(wait - 2);
    expect(lines[1].after!).toBeGreaterThan(lines[0].after!);
  });

  it('times an equation the same way', () => {
    const { elements } = layoutBeat(
      beat([{ do: 'say', text: 'So the speed is distance over time.' }, { do: 'equation', text: 'v = s / t', at: 'distance' }]),
    );
    const [formula] = inkOf(elements, 'formula');
    expect(formula.after).toBeGreaterThan(0);
  });

  it('writes at once when the word is not in her line', () => {
    const { elements } = layoutBeat(
      beat([{ do: 'say', text: said }, { do: 'write', text: 'Energy', at: 'glucose' }]),
    );
    expect(inkOf(elements, 'handwrite')[0].after ?? 0).toBe(0);
  });
});
