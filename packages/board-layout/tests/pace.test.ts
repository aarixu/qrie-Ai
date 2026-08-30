import { describe, expect, it } from 'vitest';
import { writeMs, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * How long a written line takes, asked once.
 *
 * The renderer times each line from its own text — a three-word label should
 * not crawl and a sentence should not blur past. Layout, deciding when the
 * NEXT line may start, was counting a flat 620ms. So a long first line was
 * still being written when its second line began, and the two came out of her
 * hand at once. Same fault, same fix: one ruler.
 */

const hand = (laid: ReturnType<typeof layoutBeat>, id: string) =>
  laid.elements.find((el) => el.id === id) as Extract<Element, { kind: 'handwrite' }>;

describe('a line waits for the line above it to be written', () => {
  const long = 'A long key point that will certainly not fit on one line of a narrow column';

  it('starts the second line when the first is finished', () => {
    const board: Instruction[] = [
      { do: 'diagram', ref: 'd' },
      { do: 'write', text: long },
    ];
    const beat: ScriptBeat = { id: 'w', topic: 't', narration: 'n', board };
    const laid = layoutBeat(beat);
    const first = hand(laid, 'w_1');
    const second = hand(laid, 'w_1_l1');
    expect(second.after).toBe(writeMs(first.text));
  });

  it('measures a long line as longer than a short one', () => {
    expect(writeMs('a much longer line of handwriting than the other')).toBeGreaterThan(
      writeMs('short'),
    );
  });
});
