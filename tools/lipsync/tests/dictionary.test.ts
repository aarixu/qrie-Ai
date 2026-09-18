import { describe, expect, it } from 'vitest';
import { coverage } from '../lib/dictionary.mjs';

/**
 * THE DENOMINATOR OF THE MOST QUOTED NUMBER IN THIS SPIKE.
 *
 * `docs/research/lipsync-hinglish-result.md` leads on "48.2 % of Hinglish word
 * tokens are out of vocabulary", and that figure is this function's arithmetic
 * over a Set. The Set itself is 125,945 words read out of a 37 MB WASM payload
 * and cannot be a unit test; the counting can, and this is it.
 *
 * HONESTY NOTE ON HOW THIS FILE CAME TO EXIST, in the same spirit as
 * rules-driver.test.ts: it was added after the implementation, when review
 * pointed out that the phase's headline number rested on an untested pure
 * function. It is a characterisation test — it pins the tokenising convention
 * that is already in use rather than driving a new design.
 */

// A deliberately tiny stand-in for CMUdict. Every word here is one this spike
// actually looked up: `plasma` and `oxygen` are hits in the real dictionary,
// `beta` is the hit that is a trap (the Greek letter, not the Hindi word).
const WORDS = new Set(['blood', 'plasma', 'oxygen', 'beta', "don't", 'iron', 'rich']);

describe('coverage', () => {
  it('counts tokens rather than distinct words', () => {
    // Three hits and three misses of the SAME two words. The mouth is driven
    // by tokens, so a word that recurs is counted every time it recurs.
    const c = coverage('blood hai blood hai blood hai', WORDS);
    expect(c.tokens).toBe(6);
    expect(c.inDictionary).toBe(3);
    expect(c.outOfVocabulary).toBe(3);
    expect(c.oovRate).toBeCloseTo(0.5, 12);
  });

  it('deduplicates and sorts the missing types', () => {
    const c = coverage('hai dekho hai khoon dekho', WORDS);
    expect(c.missingTypes).toEqual(['dekho', 'hai', 'khoon']);
  });

  it('is case-insensitive, because the dictionary is lowercase', () => {
    expect(coverage('BLOOD Plasma', WORDS).outOfVocabulary).toBe(0);
  });

  it('splits a hyphenated compound into two tokens', () => {
    // The corpus's own "iron-rich" — CMUdict has no hyphenated compounds, so
    // counting it as one token would report a miss for a word the dictionary
    // was never asked about. Both halves are looked up separately.
    const c = coverage('iron-rich food', WORDS);
    expect(c.tokens).toBe(3);
    expect(c.missingTypes).toEqual(['food']);
  });

  it('keeps an apostrophe inside a word', () => {
    // CMUdict carries contractions with the apostrophe in the headword, so
    // splitting on it would invent two misses out of one hit.
    const c = coverage("don't", WORDS);
    expect(c.tokens).toBe(1);
    expect(c.outOfVocabulary).toBe(0);
  });

  it('does not count digits as tokens at all', () => {
    // "5.5 litres" is one token, not two and not three. Named here because it
    // moves the denominator of every OOV rate this tool prints.
    const c = coverage('5.5 litres', WORDS);
    expect(c.tokens).toBe(1);
    expect(c.missingTypes).toEqual(['litres']);
  });

  it('returns 0 for empty input rather than NaN', () => {
    for (const empty of ['', '   ', '...', '123']) {
      const c = coverage(empty, WORDS);
      expect(c.tokens).toBe(0);
      expect(c.oovRate).toBe(0);
      expect(c.missingTypes).toEqual([]);
    }
  });

  it('treats a whole line of Devanagari as no tokens, not as misses', () => {
    // Worth pinning because it is a real trap: the tokeniser matches [a-z']
    // only, so a Devanagari line scores 0 % OOV — a perfect-looking result
    // from zero lookups. Any reader of an OOV rate needs the token count
    // beside it, which is why `tokens` is reported and not just `oovRate`.
    const c = coverage('यह चार अलग टीम है', WORDS);
    expect(c.tokens).toBe(0);
    expect(c.oovRate).toBe(0);
  });
});
