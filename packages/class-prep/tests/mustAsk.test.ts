import { describe, expect, it } from 'vitest';
import type { ScriptBeat } from '@ai-tutor/board-layout';
import { classMustAsk } from '../src/saidNotWritten';

/**
 * "Involve them through question and answer — teach, don't make them memorise."
 *
 * Aarav's rule, made structural after a class shipped with no questions at
 * all: the prompt ASKS for asks, this REQUIRES them. The first beat opens with
 * one (what do you already know?), and every beat carries at least one — a
 * beat nobody is asked anything in is a beat being recited.
 */

const beat = (id: string, board: ScriptBeat['board']): ScriptBeat => ({
  id,
  topic: 't',
  narration: '',
  board,
});

const say = (text: string) => ({ do: 'say', text }) as const;
const write = (text: string) => ({ do: 'write', text }) as const;
const ask = (question: string): ScriptBeat['board'][number] => ({
  do: 'ask',
  question,
  options: [
    { text: 'A', why: 'no' },
    { text: 'B', correct: true, why: 'yes' },
  ],
});

describe('every beat asks', () => {
  it('passes a class that opens with a question and keeps asking', () => {
    expect(
      classMustAsk([
        beat('open', [say('Hello!'), ask('What do you remember about matter?'), write('?')]),
        beat('teach', [say('Particles have spaces.'), write('Spaces'), ask('Why does sugar vanish?')]),
      ]),
    ).toEqual([]);
  });

  it('flags a first beat that never asks what they already know', () => {
    const errors = classMustAsk([
      beat('open', [say('Hello! Today we study matter.'), write('Matter')]),
      beat('teach', [say('...'), ask('Q?'), write('x')]),
    ]);
    expect(errors.some((e) => e.includes('open') && /already know|opening/i.test(e))).toBe(true);
  });

  it('flags every beat that recites without asking', () => {
    const errors = classMustAsk([
      beat('open', [say('Hello!'), ask('What do you remember?'), write('?')]),
      beat('recite', [say('Particles have spaces.'), write('Spaces')]),
      beat('also-recite', [say('They move.'), write('Move')]),
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('recite');
    expect(errors[1]).toContain('also-recite');
  });
});
