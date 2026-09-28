import { describe, expect, it } from 'vitest';
import {
  MAX_ANSWER_CHARS,
  MAX_TUTOR_CHARS,
  normaliseAnswer,
  normaliseTutorText,
} from '../src/normalise';

/**
 * This function is the whole privacy boundary for a child's own words. The
 * limits live in one place precisely so they cannot be forgotten at a call
 * site, so these tests are the specification rather than a formality.
 */

describe('normaliseAnswer', () => {
  it('drops a flagged turn entirely rather than truncating it', () => {
    // If a student disclosed something they should not have had to, the answer
    // to "where is it stored" is nowhere. Not shortened, not redacted.
    expect(normaliseAnswer('something personal and upsetting', { flagged: true })).toBeUndefined();
  });

  it('returns undefined, not an empty string, when there is nothing to keep', () => {
    // An absent field is absent. An empty string is a claim that they answered
    // and said nothing, which is a different fact.
    expect(normaliseAnswer('')).toBeUndefined();
    expect(normaliseAnswer('   \n\t  ')).toBeUndefined();
    expect(normaliseAnswer(null)).toBeUndefined();
    expect(normaliseAnswer(undefined)).toBeUndefined();
  });

  it('collapses whitespace so a stored answer compares the way it reads', () => {
    expect(normaliseAnswer('  lactic   acid\n  banta   hai  ')).toBe('lactic acid banta hai');
  });

  it('strips invisible characters that would make two equal answers unequal', () => {
    const sneaky = 'lactic​acid‮banta﻿hai';
    expect(normaliseAnswer(sneaky)).toBe('lactic acid banta hai');
  });

  it('keeps a normal Hinglish answer whole', () => {
    const real = 'Sir jab oxygen kam padti hai to muscle mein lactic acid ban jaata hai aur cramp hota hai';
    expect(normaliseAnswer(real)).toBe(real);
    expect(real.length).toBeLessThan(MAX_ANSWER_CHARS);
  });

  it('caps a long answer and marks it as cut', () => {
    const long = 'a'.repeat(50) + ' ' + 'b'.repeat(400);
    const out = normaliseAnswer(long)!;
    // The ellipsis counts. The cap is what a column may hold, and the LMS
    // lane's ledger_event_answer_length check refuses a row past it.
    expect(out.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
    expect(out.endsWith('…')).toBe(true);
  });

  it('never exceeds the cap, even with no space to cut on', () => {
    // The case that returned 201: a 200-character hard cut plus the ellipsis.
    for (const long of ['x'.repeat(MAX_ANSWER_CHARS + 1), 'x'.repeat(400), `${'y'.repeat(150)} ${'z'.repeat(300)}`]) {
      const out = normaliseAnswer(long)!;
      expect(out.length, long.slice(0, 20)).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
      expect(out.endsWith('…')).toBe(true);
    }
    // And an answer exactly at the cap is kept whole, with no ellipsis.
    expect(normaliseAnswer('x'.repeat(MAX_ANSWER_CHARS))).toBe('x'.repeat(MAX_ANSWER_CHARS));
  });

  it('cuts on a word boundary when one is near the limit', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const out = normaliseAnswer(words)!;
    expect(out.endsWith('…')).toBe(true);
    // Not stopped mid-word: the character before the ellipsis closes a token.
    expect(out.slice(0, -1)).not.toMatch(/word\d*[a-z]$/);
    expect(out.slice(0, -1).split(' ').every((w) => /^word\d+$/.test(w))).toBe(true);
  });

  it('hard-cuts rather than losing most of the answer to one long token', () => {
    // A single 400-character token has no boundary to cut on. Falling back to a
    // word cut would return almost nothing, which is worse than a blunt one.
    const out = normaliseAnswer('x'.repeat(400))!;
    expect(out.length).toBeGreaterThan(MAX_ANSWER_CHARS * 0.9);
  });

  it('honours a tighter cap when one is asked for, ellipsis included', () => {
    // Was maxChars 7 expecting 'one two…', which is eight: the test asserted
    // the overrun rather than the cap.
    expect(normaliseAnswer('one two three four five', { maxChars: 8 })).toBe('one two…');
    expect(normaliseAnswer('one two three four five', { maxChars: 7 })!.length).toBeLessThanOrEqual(7);
  });
});

/**
 * HER WORDS, WHICH ALSO REACH A COLUMN.
 *
 * `ReflectedPayload.prompt` was the one free-text field in the ledger that
 * never passed through this file: uncapped, uncollapsed, invisible characters
 * unstripped, straight from a model into jsonb — three lines above a
 * `reasoningNormalised` that was doing it correctly. That is exactly the miss
 * the header of normalise.ts predicts when a rule lives in a code review.
 */
describe('the tutor’s own text', () => {
  it('is capped, because model output into an unbounded column grows until something breaks', () => {
    const out = normaliseTutorText('why '.repeat(300));
    expect(out.length).toBeLessThanOrEqual(MAX_TUTOR_CHARS);
    expect(out.endsWith('…')).toBe(true);
  });

  it('strips the invisible characters, so a stored question is one anybody can compare', () => {
    expect(normaliseTutorText('why\u200b does\u0000 that\u202e hold?')).toBe('why does that hold?');
  });

  it('keeps the question on a turn the safety screen stopped', () => {
    // Decided explicitly rather than by omission. The flag is about the words
    // the student has just spoken, and those are dropped; the question was
    // composed a turn earlier out of an answer already screened and stored on
    // its own row. Dropping it would leave a flagged reflection as a stub
    // nobody could ever audit.
    expect(normaliseTutorText('And why does that hold when it is asleep?')).toBe(
      'And why does that hold when it is asleep?',
    );
  });

  it('gives a string and never undefined, because the field it feeds is required', () => {
    // An absent prompt makes the stored reasoning an answer to a question
    // nobody kept — which is the whole reason the field exists.
    expect(normaliseTutorText(undefined)).toBe('');
    expect(normaliseTutorText('   ')).toBe('');
  });
});
