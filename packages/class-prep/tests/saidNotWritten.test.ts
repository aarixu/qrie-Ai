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

/**
 * A SPOKEN QUESTION IS ONLY SPOKEN (Aarav, 2026-10-01). This file used to
 * demand that a question she asked was also written; the board is hers now,
 * and nothing of a question goes on it.
 */
describe('a spoken question needs no ink', () => {
  it('passes a question asked and never written, when the landing line writes', () => {
    // The real beat 2, which this check used to send back: the OBSERVATION
    // was written and the question was not. That is the board as it should be.
    const errors = saidButNotWritten([
      beat('b1', [
        { do: 'say', text: 'Where did the sugar go? Why did the level not rise?' },
        { do: 'write', text: 'Observation: sugar dissolves, level does NOT rise' },
        { do: 'say', text: 'It slips into the spaces.' },
        { do: 'write', text: 'Particles have spaces' },
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
    expect(errors[0]).toMatch(/lands the beat/i);
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

describe('a beat that ends on its question lands on the line before it', () => {
  it('passes a spoken question whose ask writes nothing', () => {
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

  it('holds the line before the asking one to the landing rule', () => {
    const bare = saidButNotWritten([
      beat('b2', [
        { do: 'say', text: 'The heart has four chambers, two up and two down.' },
        { do: 'say', text: 'So which side pumps blood to the lungs?' },
        { do: 'ask', question: 'Which side pumps blood to the lungs?' },
      ]),
    ]);
    expect(bare).toHaveLength(1);
    expect(bare[0]).toContain('four chambers');
    const landed = saidButNotWritten([
      beat('b2', [
        { do: 'say', text: 'The heart has four chambers, two up and two down.' },
        { do: 'write', text: 'Four chambers: two atria, two ventricles' },
        { do: 'say', text: 'So which side pumps blood to the lungs?' },
        { do: 'ask', question: 'Which side pumps blood to the lungs?' },
      ]),
    ]);
    expect(landed).toEqual([]);
  });

  it('asks nothing of a beat that is only its question', () => {
    expect(
      saidButNotWritten([beat('b1', [{ do: 'say', text: 'What did you have for breakfast?' }, { do: 'ask', question: 'What did you have for breakfast?' }])]),
    ).toEqual([]);
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
