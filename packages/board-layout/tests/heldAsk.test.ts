import { describe, expect, it } from 'vitest';
import { PAGE_STRIDE, boxOf, type Element } from '@ai-tutor/lesson-format';
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
 * And an ask with options put its reveal out of step with the words: the
 * layout expands an ask into two pieces of ink (the question and the lettered
 * list), so every instruction after it sat one index further along than the
 * board instruction that made it, while reveal read by the board's index.
 */

const beat = (board: Instruction[], id = 'b'): ScriptBeat => ({ id, topic: 't', narration: '', board });

const steps = (board: Instruction[]) => layoutBeat(beat(board)).steps;

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
    const question = laid.elements.find((el) => el.kind === 'handwrite' && el.text.includes('?'))!;
    const answer = laid.elements.find(
      (el) => el.kind === 'handwrite' && el.text.startsWith('Into the gaps'),
    )!;

    expect(laid.asks[0].step).toBe(0);
    expect(laid.steps[0].show).toContain(question.id);
    expect(laid.steps[0].show).not.toContain(answer.id);
    expect(laid.steps[1].show).toContain(answer.id);
  });

  it('puts it in a trailing, unspoken moment when no line follows the ask', () => {
    const got = steps([
      { do: 'say', text: 'One more.' },
      { do: 'ask', question: 'Why did the level not rise?' },
      { do: 'write', text: 'Because the sugar filled the gaps' },
    ]);
    const answerId = 'b_2';
    expect(got).toHaveLength(2);
    expect(got[0].show).not.toContain(answerId);
    expect(got[1].narration).toBe('');
    expect(got[1].show).toContain(answerId);
  });
});

describe('an ask with options keeps the reveal in step with the words', () => {
  const board: Instruction[] = [
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
  ];
  const laid = layoutBeat(beat(board));
  const list = laid.elements.find((el) => el.kind === 'list')!;
  const point = laid.elements.find(
    (el): el is Extract<Element, { kind: 'handwrite' }> =>
      el.kind === 'handwrite' && el.text.startsWith('Weight depends'),
  )!;

  it('shows the lettered options while it holds on the question', () => {
    expect(laid.steps[0].show).toContain(list.id);
  });

  it('writes the next key point on the line that says it, not a step late or never', () => {
    expect(point).toBeDefined();
    expect(laid.steps[0].show).not.toContain(point.id);
    expect(laid.steps[1].show).toContain(point.id);
  });
});

describe('a work area beside the held question', () => {
  const board: Instruction[] = [
    { do: 'title', text: 'Step 2 & 3: Substitute and Solve' },
    { do: 'say', text: 'Put three minus two y in place of x in the first equation.' },
    { do: 'equation', text: '7(3 - 2y) - 15y = 2' },
    { do: 'say', text: 'Now expand the bracket carefully.' },
    { do: 'equation', text: '21 - 14y - 15y = 2' },
    { do: 'say', text: 'Combine the like terms.' },
    { do: 'equation', text: '21 - 29y = 2' },
    { do: 'equation', text: '-29y = 2 - 21 = -19' },
    { do: 'write', text: 'y = 19 / 29' },
    { do: 'say', text: 'We have found our first value!' },
    { do: 'ask', question: 'How do we find the value of x now that we know y?' },
    { do: 'say', text: 'Put y back into the rearranged equation.' },
    { do: 'equation', text: 'x = 3 - 2(19/29) = (87 - 38)/29 = 49 / 29' },
  ];
  const laid = layoutBeat(beat(board, 'b3'));
  const area = laid.asks[0].workArea!;
  const question = laid.elements.find((el) => el.kind === 'handwrite' && el.text.includes('?'))!;

  it('is reserved on the question’s own page, under it', () => {
    expect(area).toBeDefined();
    expect(area.id).toBe(`${question.id}_work`);
    const q = boxOf(question);
    expect(Math.floor(area.x / PAGE_STRIDE)).toBe(Math.floor(q.x / PAGE_STRIDE));
    expect(area.y).toBeGreaterThanOrEqual(q.y + q.h);
    expect(area.w).toBeGreaterThan(200);
    expect(area.h).toBeGreaterThan(60);
  });

  it('holds no prepared ink, and nothing else overlaps either', () => {
    expect(findOverlaps(laid.elements, { bonds: laid.bonds, reserved: [{ id: area.id, box: area }] })).toEqual([]);
  });

  it('is reserved beside a question written in a column next to a picture', () => {
    const columned = layoutBeat(
      beat([
        { do: 'say', text: 'Look at the heart.' },
        { do: 'picture', ref: 'heart' },
        { do: 'write', text: 'Four chambers' },
        { do: 'say', text: 'So which side pumps to the lungs?' },
        { do: 'ask', question: 'Which side pumps blood to the lungs?' },
      ]),
    );
    const work = columned.asks[0].workArea!;
    expect(work).toBeDefined();
    expect(
      findOverlaps(columned.elements, { bonds: columned.bonds, reserved: [{ id: work.id, box: work }] }),
    ).toEqual([]);
  });
});

describe('the ink after an ask waits, however the beat is ordered', () => {
  const inkWith = (laid: ReturnType<typeof layoutBeat>, text: string): string =>
    laid.elements.find((el) => 'text' in el && el.text === text)!.id;

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
    const question = inkWith(laid, 'What is x?');
    const answer = inkWith(laid, 'x = 5');
    expect(laid.asks[0].step).toBe(0);
    expect(laid.steps[0].show).toContain(question);
    expect(laid.steps[0].show).not.toContain(answer);
    expect(laid.steps[1].show).toContain(answer);
  });

  it('gives it a trailing, unspoken moment when the ask comes first and one line follows', () => {
    const laid = layoutBeat(
      beat([
        { do: 'ask', question: 'What is x?' },
        { do: 'equation', text: 'x = 5' },
        { do: 'say', text: 'Think about what x must be.' },
      ]),
    );
    const answer = inkWith(laid, 'x = 5');
    expect(laid.steps).toHaveLength(2);
    expect(laid.steps[0].show).not.toContain(answer);
    expect(laid.steps[1].narration).toBe('');
    expect(laid.steps[1].show).toContain(answer);
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
    const question = inkWith(laid, 'What is x?');
    const answer = inkWith(laid, 'x = 5');
    expect(laid.asks[0].step).toBe(0);
    expect(laid.steps[0].narration).toBe('Try this one.');
    expect(laid.steps[0].show).toEqual(expect.arrayContaining([sum, question]));
    expect(laid.steps[0].show).not.toContain(answer);
    expect(laid.steps).toHaveLength(2);
    expect(laid.steps[1].narration).toBe('');
    expect(laid.steps[1].show).toContain(answer);
  });
});
