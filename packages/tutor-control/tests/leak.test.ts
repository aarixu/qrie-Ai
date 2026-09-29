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
