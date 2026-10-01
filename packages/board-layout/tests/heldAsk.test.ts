import { describe, expect, it } from 'vitest';
import type { Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import { findOverlaps } from '../src/overlap';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * WHAT THE BOARD HOLDS WHILE THE CLASS WAITS FOR AN ANSWER.
 *
 * The first maths class ever prepared (2026-09-28) held on four questions, and
 * on every one of them the ANSWER was already on the board: b3 asked how to
 * find x with "Solution: x = 49/29, y = 19/29" written underneath. The ink
 * after an ask was revealed with the ask, because reveal is split by `say` and
 * nothing split it at the ask.
 *
 * And since 2026-10-01 (Aarav: no question and no options on screen) an ask
 * writes NOTHING: no question, no lettered options, no room kept for working.
 * It is a board instruction that draws no ink at all, which is exactly the
 * case that used to put reveal out of step with the words.
 */

const beat = (board: Instruction[], id = 'b'): ScriptBeat => ({ id, topic: 't', narration: '', board });

const steps = (board: Instruction[]) => layoutBeat(beat(board)).steps;

const inkWith = (laid: ReturnType<typeof layoutBeat>, text: string): string =>
  laid.elements.find((el) => 'text' in el && el.text === text)!.id;

describe('an ask writes nothing on the board', () => {
  it('draws neither its question nor any options, and keeps no room for working', () => {
    const laid = layoutBeat(
      beat([
        { do: 'say', text: 'Mass or weight?' },
        {
          do: 'ask',
          question: 'Which one changes on the Moon?',
          options: [
            { text: 'Mass', why: 'Mass is the matter itself.' },
            { text: 'Weight', correct: true, why: 'Gravity is weaker there.' },
          ],
        },
      ]),
    );
    expect(laid.elements).toEqual([]);
    expect(laid.asks).toHaveLength(1);
    expect(laid.asks[0].ask.question).toBe('Which one changes on the Moon?');
    expect(laid.asks[0]).not.toHaveProperty('workArea');
  });

  it('leaves the rest of the beat exactly where it would be without the ask', () => {
    const teaching: Instruction[] = [
      { do: 'say', text: 'Look at the heart.' },
      { do: 'picture', ref: 'heart' },
      { do: 'write', text: 'Four chambers' },
      { do: 'say', text: 'So which side pumps to the lungs?' },
    ];
    const asked = layoutBeat(beat([...teaching, { do: 'ask', question: 'Which side pumps blood to the lungs?' }]));
    const plain = layoutBeat(beat(teaching));
    expect(asked.elements).toEqual(plain.elements);
    expect(findOverlaps(asked.elements, { bonds: asked.bonds })).toEqual([]);
  });
});

describe('the ink after an ask waits for the answer', () => {
  it('keeps it off the held moment and brings it in on the next line', () => {
    const laid = layoutBeat(
      beat([
        { do: 'say', text: 'Think about the level.' },
        { do: 'ask', question: 'Where did the sugar go?' },
        { do: 'write', text: 'Into the gaps between water particles' },
        { do: 'say', text: 'Into the gaps, which is why the level stayed put.' },
        { do: 'write', text: 'Particles of matter have spaces between them' },
      ]),
    );
    const answer = inkWith(laid, 'Into the gaps between water particles');

    expect(laid.asks[0].step).toBe(0);
    expect(laid.steps[0].show).not.toContain(answer);
    expect(laid.steps[1].show).toContain(answer);
  });

  it('puts it in a trailing, unspoken moment when no line follows the ask', () => {
    const laid = layoutBeat(
      beat([
        { do: 'say', text: 'One more.' },
        { do: 'ask', question: 'Why did the level not rise?' },
        { do: 'write', text: 'Because the sugar filled the gaps' },
      ]),
    );
    const answer = inkWith(laid, 'Because the sugar filled the gaps');
    expect(laid.steps).toHaveLength(2);
    expect(laid.steps[0].show).not.toContain(answer);
    expect(laid.steps[1].narration).toBe('');
    expect(laid.steps[1].show).toContain(answer);
  });

  it('writes the next key point on the line that says it, not a step late or never', () => {
    const laid = layoutBeat(
      beat([
        { do: 'say', text: 'Mass or weight?' },
        {
          do: 'ask',
          question: 'Which one changes on the Moon?',
          options: [
            { text: 'Mass', why: 'Mass is the matter itself.' },
            { text: 'Weight', correct: true, why: 'Gravity is weaker there.' },
          ],
        },
        { do: 'say', text: 'Weight changes, because the pull is weaker.' },
        { do: 'write', text: 'Weight depends on gravity' },
      ]),
    );
    const point = laid.elements.find(
      (el): el is Extract<Element, { kind: 'handwrite' }> =>
        el.kind === 'handwrite' && el.text.startsWith('Weight depends'),
    )!;
    expect(point).toBeDefined();
    expect(laid.steps[0].show).not.toContain(point.id);
    expect(laid.steps[1].show).toContain(point.id);
  });
});

describe('the ink after an ask waits, however the beat is ordered', () => {
  it('holds it back when the ask comes before the first line', () => {
    // The ask is pinned to the first line's moment, which is the one held.
    const laid = layoutBeat(
      beat([
        { do: 'ask', question: 'What is x?' },
        { do: 'equation', text: 'x = 5' },
        { do: 'say', text: 'Think about what x must be.' },
        { do: 'say', text: 'It is five, because five and two make seven.' },
      ]),
    );
    const answer = inkWith(laid, 'x = 5');
    expect(laid.asks[0].step).toBe(0);
    expect(laid.steps[0].show).not.toContain(answer);
    expect(laid.steps[1].show).toContain(answer);
  });

  it('gives it a trailing, unspoken moment when the ask comes first and one line follows', () => {
    const got = steps([
      { do: 'ask', question: 'What is x?' },
      { do: 'equation', text: 'x = 5' },
      { do: 'say', text: 'Think about what x must be.' },
    ]);
    expect(got).toHaveLength(2);
    expect(got[1].narration).toBe('');
    expect(got[1].show).toHaveLength(1);
    expect(got[0].show).not.toContain(got[1].show[0]);
  });

  it('holds it back in a beat that asks and never says a line', () => {
    const laid = layoutBeat({
      id: 'b',
      topic: 't',
      narration: 'Try this one.',
      board: [
        { do: 'write', text: 'x + 2 = 7' },
        { do: 'ask', question: 'What is x?' },
        { do: 'equation', text: 'x = 5' },
      ],
    });
    const sum = inkWith(laid, 'x + 2 = 7');
    const answer = inkWith(laid, 'x = 5');
    expect(laid.asks[0].step).toBe(0);
    expect(laid.steps[0].narration).toBe('Try this one.');
    expect(laid.steps[0].show).toContain(sum);
    expect(laid.steps[0].show).not.toContain(answer);
    expect(laid.steps).toHaveLength(2);
    expect(laid.steps[1].narration).toBe('');
    expect(laid.steps[1].show).toContain(answer);
  });
});
