import { describe, expect, it } from 'vitest';
import type { ScriptBeat } from '@ai-tutor/board-layout';
import { inkWaitsForALine, saidButNotWritten } from '../src/saidNotWritten';

/**
 * THE CHECK BEHIND THE RULE.
 *
 * "The board shows what you are saying" went into the prompt and the model
 * follows it four times out of five. The fifth time is what a teacher marked
 * on a real transcript: the spoken question whose answer got written but not
 * the question, and the beat-closing line — "there is a force between
 * particles" — said over a board that gained nothing.
 *
 * A prompt asks; this checks. Deterministic, so it feeds the repair round the
 * same way every other validation error does, and the model fixes exactly
 * what is named.
 */

const beat = (id: string, board: ScriptBeat['board']): ScriptBeat => ({
  id,
  topic: 't',
  narration: '',
  board,
});

describe('a spoken question is a written question', () => {
  it('passes when the question she asks is also on the board', () => {
    const errors = saidButNotWritten([
      beat('b1', [
        { do: 'say', text: 'Where did the sugar go? Why did the level not rise?' },
        { do: 'write', text: 'Where did the sugar go?' },
        { do: 'say', text: 'Because of the spaces between particles.' },
        { do: 'write', text: 'Particles have spaces between them' },
      ]),
    ]);
    expect(errors).toEqual([]);
  });

  it('flags a question that was asked and never written', () => {
    // The real beat 2: the OBSERVATION was written, the question was not.
    const errors = saidButNotWritten([
      beat('b1', [
        { do: 'say', text: 'Where did the sugar go? Why did the level not rise?' },
        { do: 'write', text: 'Observation: sugar dissolves, level does NOT rise' },
        { do: 'say', text: 'It slips into the spaces.' },
        { do: 'write', text: 'Particles have spaces' },
      ]),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/b1/);
    expect(errors[0]).toMatch(/question/i);
  });

  it('accepts the question written as a card or note too', () => {
    const errors = saidButNotWritten([
      beat('b1', [
        { do: 'say', text: 'What changed when we lit it?' },
        { do: 'note', text: 'What changed when we lit it?' },
        { do: 'say', text: 'The particles gained energy.' },
        { do: 'write', text: 'Heat increases kinetic energy' },
      ]),
    ]);
    expect(errors).toEqual([]);
  });
});

describe('the line that lands the beat writes something', () => {
  it('flags a final say spoken over a board that gained nothing', () => {
    // The real beat 11: the attraction-force conclusion, said, never written.
    const errors = saidButNotWritten([
      beat('b3', [
        { do: 'say', text: 'Try breaking each of them.' },
        { do: 'write', text: 'Chalk crumbles; the nail does not break' },
        { do: 'say', text: 'A force between particles holds them together, and it varies.' },
      ]),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/b3/);
    expect(errors[0]).toMatch(/final|last/i);
  });

  it('passes when the landing line lands something', () => {
    const errors = saidButNotWritten([
      beat('b3', [
        { do: 'say', text: 'Try breaking each of them.' },
        { do: 'write', text: 'Chalk crumbles; the nail does not break' },
        { do: 'say', text: 'A force between particles holds them together.' },
        { do: 'write', text: 'Particles attract each other — strength varies by substance' },
      ]),
    ]);
    expect(errors).toEqual([]);
  });

  it('lets a lone scene-setting say stand — a teacher talks to a blank board', () => {
    // Only the LAST say must land; the opening breath needs no ink.
    const errors = saidButNotWritten([
      beat('b1', [
        { do: 'say', text: 'Picture your kitchen in the morning.' },
        { do: 'say', text: 'Someone is making tea.' },
        { do: 'place', id: 'pot', noun: 'pot', label: 'Tea pot' },
      ]),
    ]);
    expect(errors).toEqual([]);
  });

  it('says nothing about a beat with no says at all', () => {
    const errors = saidButNotWritten([
      beat('b0', [{ do: 'title', text: 'Matter' }, { do: 'note', text: 'One breath, one board.' }]),
    ]);
    expect(errors).toEqual([]);
  });
});

describe('an ask is the written question (T1.2)', () => {
  /**
   * The first maths class wrote every question twice. The layout writes an
   * ask's question on the board by itself, and this check did not count the
   * ask as ink — so it sent the plan to repair for an "unwritten" question,
   * and the repair dutifully wrote a second copy (b1_9, b2_8, b3_10, b4_4).
   */
  it('passes a spoken question whose only ink is the ask', () => {
    const errors = saidButNotWritten([
      beat('b1', [
        { do: 'say', text: 'How could you find the cost of the pen without guessing?' },
        { do: 'ask', question: 'What can you do with the y in the first equation?' },
        { do: 'say', text: 'Put x plus thirty in its place.' },
        { do: 'write', text: 'Substitute y = x + 30 into x + y = 50' },
      ]),
    ]);
    expect(errors).toEqual([]);
  });
});

describe('the answer after an ask needs a line to arrive under (T1.2)', () => {
  it('flags ink written after the last ask with nothing said after it', () => {
    const errors = inkWaitsForALine([
      beat('b3', [
        { do: 'say', text: 'We have found our first value!' },
        { do: 'ask', question: 'How do we find x now that we know y?' },
        { do: 'equation', text: 'x = 3 - 2(19/29) = 49/29' },
      ]),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/b3/);
    expect(errors[0]).toMatch(/say/);
  });

  it('passes the same ink once a line follows the ask', () => {
    const errors = inkWaitsForALine([
      beat('b3', [
        { do: 'say', text: 'We have found our first value!' },
        { do: 'ask', question: 'How do we find x now that we know y?' },
        { do: 'say', text: 'Put y back into the rearranged equation.' },
        { do: 'equation', text: 'x = 3 - 2(19/29) = 49/29' },
      ]),
    ]);
    expect(errors).toEqual([]);
  });

  it('flags ink after an ask written before the first line, when only that line follows', () => {
    // The ask is held on the first line's moment, so that line does not
    // release what was written after the ask (board-layout's revealSteps).
    const errors = inkWaitsForALine([
      beat('b2', [
        { do: 'ask', question: 'What is x?' },
        { do: 'equation', text: 'x = 5' },
        { do: 'say', text: 'Think about what x must be.' },
      ]),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/b2/);
  });

  it('passes it once a second line follows', () => {
    const errors = inkWaitsForALine([
      beat('b2', [
        { do: 'ask', question: 'What is x?' },
        { do: 'equation', text: 'x = 5' },
        { do: 'say', text: 'Think about what x must be.' },
        { do: 'say', text: 'It is five.' },
      ]),
    ]);
    expect(errors).toEqual([]);
  });

  it('flags ink after the ask in a beat that never says a line', () => {
    const errors = inkWaitsForALine([
      { id: 'b5', topic: 't', narration: 'Try this.', board: [{ do: 'ask', question: 'What is x?' }, { do: 'equation', text: 'x = 5' }] },
    ]);
    expect(errors).toHaveLength(1);
  });

  it('says nothing when the ask is the last thing on the board', () => {
    expect(
      inkWaitsForALine([beat('b1', [{ do: 'say', text: 'So?' }, { do: 'ask', question: 'Why?' }])]),
    ).toEqual([]);
  });
});
