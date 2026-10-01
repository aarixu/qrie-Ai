import { describe, expect, it } from 'vitest';
import { PAGE_STRIDE, boxOf } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

const beat = (board: Instruction[]): ScriptBeat => ({ id: 'b1', topic: 't', narration: '', board });
const pageOf = (x: number): number => Math.floor(x / PAGE_STRIDE);

/** C3: `newPage` — she wipes to clean board before the next idea. */
describe('a new page', () => {
  it('starts what follows on a fresh page, though the first had room for it', () => {
    const { elements, pages } = layoutBeat(
      beat([
        { do: 'say', text: 'First the word.' },
        { do: 'write', text: 'Respiration' },
        { do: 'say', text: 'Now, a clean board.' },
        { do: 'newPage' },
        { do: 'write', text: 'Glucose gives energy' },
      ]),
    );
    const first = elements.find((el) => el.kind === 'handwrite' && el.text === 'Respiration')!;
    const second = elements.find((el) => el.kind === 'handwrite' && el.text === 'Glucose gives energy')!;
    expect(pageOf(boxOf(first).x)).toBe(0);
    expect(pageOf(boxOf(second).x)).toBe(1);
    expect(pages).toBe(2);
  });

  it('turns no page when nothing is on this one yet', () => {
    const { elements, pages } = layoutBeat(
      beat([{ do: 'newPage' }, { do: 'say', text: 'Look.' }, { do: 'write', text: 'Respiration' }]),
    );
    expect(pages).toBe(1);
    expect(pageOf(boxOf(elements.find((el) => el.kind === 'handwrite')!).x)).toBe(0);
  });

  it('draws nothing of its own', () => {
    const { elements, undrawn } = layoutBeat(beat([{ do: 'say', text: 'Look.' }, { do: 'newPage' }]));
    expect(elements).toEqual([]);
    expect(undrawn).toEqual([]);
  });
});
