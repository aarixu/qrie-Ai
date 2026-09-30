import { describe, expect, it } from 'vitest';
import { hasDevanagari, romaniseDevanagari } from '../src/romanise';

/**
 * The ear's backstop: what the old instruction actually sent back on
 * 2026-09-30 (tools/voice-probe/probe.mjs), and the words the distress screen
 * must be able to read, spelled the way students type them.
 */
describe('romaniseDevanagari', () => {
  it.each([
    ['मुझे', 'mujhe'],
    ['लगता', 'lagta'],
    ['है', 'hai'],
    ['सांस', 'saans'],
    ['पता', 'pata'],
    ['हां', 'haan'],
    ['समझ', 'samajh'],
    ['गया', 'gaya'],
    ['आगे', 'aage'],
    ['चलो', 'chalo'],
    ['मिलती', 'milti'],
    ['मरना', 'marna'],
    ['एक', 'ek'],
    ['ही', 'hi'],
    ['तो', 'to'],
    ['लेने', 'lene'],
  ])('spells %s as %s', (hindi, roman) => {
    expect(romaniseDevanagari(hindi)).toBe(roman);
  });

  it('turns the transcripts the old ear sent back into Roman script', () => {
    expect(romaniseDevanagari('मुझे लगता है सांस लेने से एनर्जी मिलती है।')).toBe('mujhe lagta hai saans lene se enarji milti hai.');
    expect(romaniseDevanagari('हां समझ आ गया आगे चलो।')).toBe('haan samajh aa gaya aage chalo.');
    expect(hasDevanagari(romaniseDevanagari('अ पता नहीं एक ही तो ना।'))).toBe(false);
  });

  it('reads nukta letters, precomposed or combined', () => {
    expect(romaniseDevanagari('ज़रा')).toBe('zara');
    expect(romaniseDevanagari('ज़रा')).toBe('zara');
  });

  it('leaves Roman text, English words and digits alone', () => {
    const roman = 'Yeast mein oxygen nahi hoti toh alcohol banta hai.';
    expect(romaniseDevanagari(roman)).toBe(roman);
    expect(romaniseDevanagari('मुझे 2 hint दो')).toBe('mujhe 2 hint do');
    expect(romaniseDevanagari('५ मिनट')).toBe('5 minat');
  });

  it('never leaves a Devanagari character behind', () => {
    const everything = Array.from({ length: 0x80 }, (_, i) => String.fromCharCode(0x0900 + i)).join('');
    expect(hasDevanagari(romaniseDevanagari(`${everything} नमस्ते`))).toBe(false);
  });
});
