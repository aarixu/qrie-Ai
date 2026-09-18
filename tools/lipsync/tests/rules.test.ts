import { describe, expect, it } from 'vitest';
import type { MouthShape } from '../lib/format.d.mts';
import { SHAPE_WEIGHT, textToUnits, wordToShapes } from '../lib/rules.mjs';

/**
 * THE RULE TABLE — the recogniser that cannot fail for a licensing reason, a
 * tooling reason, or a language reason, because it has no model, no weights
 * and no audio.
 *
 * Approach taken from TalkingHead's lipsync-en.mjs (MIT, @met4citizen):
 * letter-to-sound rules in the lineage of NRL Report 7948 (1976) plus a
 * per-shape relative duration table. The rules below are written here rather
 * than imported, because lipsync-en targets the 15 Oculus visemes and the
 * thing this repo will commission art against is Rhubarb's NINE Hanna-Barbera
 * shapes (docs/research/avatar-3.md:191). Mapping 15 down to 9 after the fact
 * throws away the chance to pick the right shape in the first place.
 *
 * WHAT THESE TESTS ARE AND ARE NOT: English spelling is not a function of
 * pronunciation, so a rule table is wrong on purpose and often. These tests
 * pin the mappings a stylised mouth actually reads — lips shut on P/B/M,
 * teeth on the lip for F/V — not "correct" phonetics. A test asserting this
 * table pronounces English correctly would be asserting a falsehood.
 */
describe('the mappings a viewer can actually see', () => {
  it('shuts the lips on P, B and M', () => {
    // If a stylised mouth gets ONE thing right it has to be this one: a shut
    // mouth on a bilabial. It is the only shape an audience notices
    // consciously.
    expect(wordToShapes('map')).toContain('A');
    expect(wordToShapes('bob')[0]).toBe('A');
    expect(wordToShapes('mum')[0]).toBe('A');
  });

  it('puts the teeth on the lip for F and V', () => {
    expect(wordToShapes('five')[0]).toBe('G');
    expect(wordToShapes('van')[0]).toBe('G');
  });

  it('raises the tongue for L', () => {
    expect(wordToShapes('look')[0]).toBe('H');
  });

  it('puckers for W and the OO sound', () => {
    expect(wordToShapes('we')[0]).toBe('F');
    expect(wordToShapes('blood')).toContain('F');
  });

  it('reads EE as the clenched-teeth shape', () => {
    expect(wordToShapes('see')).toContain('B');
  });

  it('opens wide on the EAR of heart and the AR of arteries', () => {
    // Two different rules, named accurately: `ear` fires in "heart" (it is
    // ordered above `ea` precisely so the vowel is not eaten), `ar` in
    // "arteries". Both land on D, which is the point.
    expect(wordToShapes('heart')).toContain('D');
    expect(wordToShapes('arteries')[0]).toBe('D');
  });

  it('emits only shapes from the nine', () => {
    for (const s of wordToShapes('platelets')) expect('ABCDEFGHX').toContain(s);
  });

  it('never repeats a shape back to back inside a word', () => {
    // Two identical shapes in a row is one drawing held twice as long. It is
    // never a second mouth movement, and counting it as one would inflate
    // every cue-count number the comparison harness reports.
    const shapes = wordToShapes('bubble');
    for (let i = 1; i < shapes.length; i++) expect(shapes[i]).not.toBe(shapes[i - 1]);
  });

  it('gives an empty word no shapes', () => {
    expect(wordToShapes('')).toEqual([]);
    expect(wordToShapes('!!!')).toEqual([]);
  });
});

describe('textToUnits', () => {
  it('puts the idle shape in the gaps between words', () => {
    expect(textToUnits('map map').some((u) => u.v === 'X')).toBe(true);
  });

  it('holds the idle longer at a comma than at a space', () => {
    // A mouth that does not rest at punctuation reads as a machine. These
    // pause weights are the only prosody this driver has.
    const comma = textToUnits('map, map').filter((u) => u.v === 'X');
    const space = textToUnits('map map').filter((u) => u.v === 'X');
    expect(comma[0].w).toBeGreaterThan(space[0].w);
  });

  it('gives every unit a positive weight', () => {
    for (const u of textToUnits('Plasma carries digested food, and waste.')) {
      expect(u.w).toBeGreaterThan(0);
    }
  });

  it('weights every one of the nine shapes', () => {
    const nine: MouthShape[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'];
    for (const s of nine) {
      expect(SHAPE_WEIGHT[s]).toBeGreaterThan(0);
    }
  });

  it('survives Hinglish without throwing', () => {
    // The entire reason this driver exists. It is a LETTER table, so
    // romanised Hindi is just letters — it produces shapes, and whether those
    // shapes are any good is the measurement, not this test.
    const units = textToUnits('Dekho beta, khoon poore shareer mein ghoomta hai.');
    expect(units.length).toBeGreaterThan(10);
    for (const u of units) expect('ABCDEFGHX').toContain(u.v);
  });
});
