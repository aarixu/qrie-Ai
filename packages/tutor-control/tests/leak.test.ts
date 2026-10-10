import { describe, expect, it } from 'vitest';
import { leaks, leakTokens } from '../src/index';

/**
 * THE LEAK CHECK. Before the answer is given, nothing she says or writes may
 * contain it — in digits, in words, in a different case, with different
 * spacing or punctuation. The plan's proof lesson leaked the answer on 4 of 4
 * asks, which is why this is code and not a prompt instruction.
 */
describe('leaks', () => {
  const table: Array<[string, string, string[], boolean]> = [
    ['the number itself', 'The answer is 7.', ['7'], true],
    ['a number said as a word', 'the answer is seven', ['7'], true],
    ['a word secret said as a digit', 'it has 7 sides', ['seven'], true],
    ['an equation said in words', 'so x equals seven', ['x = 7'], true],
    ['an equation said with "is"', 'x is 7', ['x = 7'], true],
    ['the value alone, from an equation secret', 'try 7 and see', ['x = 7'], true],
    ['a hyphenated tens word', 'Twenty-one of them', ['21'], true],
    ['a spaced tens word', 'twenty one apples', ['21'], true],
    ['one hundred', 'one hundred people', ['100'], true],
    ['a hundred', 'a hundred people', ['100'], true],
    ['case, spacing and punctuation', 'CARBON   dioxide!', ['carbon dioxide'], true],
    ['one value of two', 'so x = 49/29 here', ['x = 49/29, y = 19/29'], true],
    ['the other value, spaced', 'y is 19 / 29', ['x = 49/29, y = 19/29'], true],
    ['a decimal', 'it comes to 0.5', ['0.5'], true],
    ['a minus sign does not hide the number', 'minus three', ['-3'], true],
    ['a unicode minus does not either', 'x = −3', ['x = -3'], true],
    ['a shared denominator is not the answer', 'divide both sides by 29', ['x = 49/29, y = 19/29'], false],
    ['a longer number is not the number', 'there were 147', ['7'], false],
    ['a decimal is not its whole part', 'about 7.5', ['7'], false],
    ['part of a word is not the word', 'photo means light', ['photosynthesis'], false],
    ['nothing to hide', 'anything at all', [], false],
    ['blank secrets are ignored', 'anything at all', ['', '   '], false],
    ['an unrelated line', 'Take 3 from both sides first.', ['x = 4'], false],
  ];

  for (const [name, text, secrets, expected] of table) {
    it(`${expected ? 'catches' : 'passes'}: ${name}`, () => {
      expect(leaks(text, secrets)).toBe(expected);
    });
  }

  it('normalises numbers 0 to 100 as words and as digits alike', () => {
    const words = [
      'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
      'nineteen',
    ];
    words.forEach((word, n) => expect(leakTokens(word)).toEqual([String(n)]));
    const tens = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    tens.forEach((word, i) => {
      const base = (i + 2) * 10;
      expect(leakTokens(word)).toEqual([String(base)]);
      for (let unit = 1; unit <= 9; unit += 1) {
        expect(leakTokens(`${word}-${words[unit]}`)).toEqual([String(base + unit)]);
      }
    });
    expect(leakTokens('one hundred')).toEqual(['100']);
  });
});

/**
 * HINGLISH NUMBERS (D27, lam-one-brain Task 13). The truth test (2026-10-06)
 * got 'chaar' and 'char hai' past the check for an answer of 4. In a hi-en
 * line, romanised Hindi number words read as digits; in an English line they
 * do not, because several are English words ("do", "teen", "bees", "sat").
 */
describe('leaks, in a Hinglish line', () => {
  const table: Array<[string, string, string[], boolean]> = [
    ['a number said in Hindi', 'Jawab chaar hai.', ['4'], true],
    ['the other spelling', 'char hai', ['4'], true],
    ['a digit secret said in Hindi, from an equation', 'x saat ke barabar hai', ['x = 7'], true],
    ['an English word secret said in Hindi', 'paanch kone hain', ['five'], true],
    ['ten and above', 'pandrah minute', ['15'], true],
    ['a tens word', 'pachaas log', ['50'], true],
    ['a hundred', 'sau rupaye', ['100'], true],
    ['zero', 'shunya se shuru karo', ['0'], true],
    ['"do" is two here, erring toward a leak', 'isse do se guna karo', ['2'], true],
    ['a different number is not the answer', 'teen se shuru karo', ['4'], false],
    ['part of a word is not the number', 'teenager wali galti', ['3'], false],
    ['a word answer is untouched', 'yeh gas patte lete hain', ['carbon dioxide'], false],
  ];

  for (const [name, text, secrets, expected] of table) {
    it(`${expected ? 'catches' : 'passes'}: ${name}`, () => {
      expect(leaks(text, secrets, 'hi-en')).toBe(expected);
    });
  }

  it('reads Hindi number words only in a hi-en line', () => {
    expect(leaks('Jawab chaar hai.', ['4'])).toBe(false);
    expect(leaks('Jawab chaar hai.', ['4'], 'en')).toBe(false);
    expect(leaks("Let's do it together", ['2'], 'en')).toBe(false);
    expect(leaks("Let's do it together", ['2'], 'hi-en')).toBe(true);
  });

  it('normalises one to ten, the teens and the tens', () => {
    expect(leakTokens('ek do teen chaar paanch chhe saat aath nau das', 'hi-en')).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    ]);
    expect(leakTokens('gyarah barah terah chaudah pandrah solah satrah atharah unnis bees', 'hi-en')).toEqual([
      '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    ]);
    expect(leakTokens('tees chaalis pachaas saath sattar assi nabbe sau', 'hi-en')).toEqual([
      '30', '40', '50', '60', '70', '80', '90', '100',
    ]);
    expect(leakTokens('chaar', 'en')).toEqual(['chaar']);
  });
});
