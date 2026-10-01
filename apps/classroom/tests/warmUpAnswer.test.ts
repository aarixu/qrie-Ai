import { describe, expect, it } from 'vitest';
import { readWarmUpAnswer } from '../src/lib/warmUp';

/**
 * A WARM-UP ANSWER, SAID BACK (2026-10-01). She reads the choices out loud and
 * nothing is shown, so the only safe reading is a choice they named: never a
 * letter, and never a position, because "four" can be a value as well as a
 * place in a list they only heard.
 */
describe('reading a warm-up answer', () => {
  const numbers = ['2', '4', '6', '16'];

  it('takes a number said alone, as a digit or as a word', () => {
    expect(readWarmUpAnswer('4', numbers)).toBe(1);
    expect(readWarmUpAnswer('Four.', numbers)).toBe(1);
    expect(readWarmUpAnswer('sixteen', numbers)).toBe(3);
  });

  it('takes the one number in a sentence when it is a choice', () => {
    expect(readWarmUpAnswer('x is 4', numbers)).toBe(1);
    expect(readWarmUpAnswer('mujhe lagta hai 6 hoga', numbers)).toBe(2);
  });

  it('refuses a sentence with two numbers in it, or a number that is no choice', () => {
    expect(readWarmUpAnswer('2 or 4', numbers)).toBeNull();
    expect(readWarmUpAnswer('8', numbers)).toBeNull();
  });

  it('never reads a letter or a position', () => {
    expect(readWarmUpAnswer('b', numbers)).toBeNull();
    expect(readWarmUpAnswer('the second one', ['photosynthesis', 'respiration'])).toBeNull();
  });

  it('takes the words of a choice', () => {
    const words = ['carbon dioxide', 'oxygen', 'nitrogen'];
    expect(readWarmUpAnswer('Oxygen', words)).toBe(1);
    expect(readWarmUpAnswer('I think it is carbon dioxide', words)).toBe(0);
  });

  it('reads nothing into a shrug or into words that name no choice', () => {
    expect(readWarmUpAnswer('pata nahi', ['carbon dioxide', 'oxygen'])).toBeNull();
    expect(readWarmUpAnswer('banana', ['carbon dioxide', 'oxygen'])).toBeNull();
  });
});
