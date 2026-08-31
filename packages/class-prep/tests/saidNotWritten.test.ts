import { describe, expect, it } from 'vitest';
import type { ScriptBeat } from '@ai-tutor/board-layout';
import { saidButNotWritten } from '../src/saidNotWritten';

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
