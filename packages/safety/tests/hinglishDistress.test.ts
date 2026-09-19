import { describe, expect, it } from 'vitest';
import { SUPPORT_REPLY, screen } from '../src/screen';

/**
 * THE SENTENCE THAT MATTERS MOST, IN THE LANGUAGE THE CHILD IS TAUGHT IN.
 *
 * The distress list was English only, and this screen runs on BOTH directions:
 * the tutor's narration on its way out and a student's own words on their way
 * back in through /api/hear. The product has always expected Hinglish from
 * students — tutor-judge's matcher is built for "wo lamba wala" and "B hoga
 * na" — so an English-only list was always a hole. The language thread, which
 * makes the tutor speak Hinglish FIRST, is what makes it the likely case
 * rather than an edge one.
 *
 * TWO SUITES, AND THE SECOND IS NOT OPTIONAL. A distress list that catches
 * everything is a tutor that stops a physics class to offer a helpline, which
 * teaches a child that the tutor does not listen. "machhar marna hai" is a
 * sentence about a mosquito.
 *
 * NOT VERIFIED against any corpus of real student writing — there is none in
 * this repository. Romanised Hindi has no spelling, so this is a floor and
 * never a ceiling, and the list in screen.ts says so.
 */

const student = (text: string) => screen(text, 'from-student');
const tutor = (text: string) => screen(text, 'to-student');

describe('Hinglish distress: what must always be heard', () => {
  const heard = [
    ['intent, plain', 'mujhe marna hai'],
    ['intent, the short spellings a phone produces', 'muje ab marna h'],
    ['intent, "mar jana"', 'mujhe mar jana hai'],
    ['intent, first person future', 'main mar jaunga'],
    ['intent, feminine', 'mai mar jaungi ab'],
    ['not wanting to live', 'jeena nahi chahta'],
    ['not wanting to live, respelled', 'jina nhi chahti'],
    ['no will to live', 'jeene ka mann nahi karta'],
    ['no will to live, respelled', 'jine ka dil nhi hai'],
    ['not staying alive', 'zinda nahi rehna'],
    ['the noun WITH intent attached', 'mujhe khudkushi karni hai'],
    ['the other noun, with intent', 'atmahatya karna chahta hu'],
    ['harming oneself', 'apne aap ko maar dunga'],
    ['harming oneself, other phrasing', 'khud ko nuksan pahuchaya'],
    ['being hit, by a named adult', 'papa mujhe maarte hain'],
    ['being hit, feminine verb', 'mummy muje bahut peetti hai'],
    ['being hit, nobody named', 'mujhe roz maarta hai'],
    ['afraid to go home', 'ghar jane se darr lagta hai'],
    ['being touched', 'mujhe galat tarike se chhuta hai'],
  ] as const;

  for (const [what, line] of heard) {
    it(`hears ${what}: "${line}"`, () => {
      const out = student(line);
      expect(out.kind).toBe('support');
      expect(out.kind === 'support' && out.say).toBe(SUPPORT_REPLY);
    });
  }

  it('hears it in the tutor’s own narration too, which is what screenSpine runs', () => {
    expect(tutor('mujhe marna hai').kind).toBe('support');
  });
});

describe('Hinglish distress: the sentences that must NOT trip it', () => {
  const ordinary = [
    'machhar marna hai to spray use karo',
    'is question ka answer marks ke liye important hai',
    'market me kitne log the',
    'mard aur aurat me difference kya hai',
    'Bhagat Singh ki atmahatya nahi thi, wo fansi thi',
    'cell division kaise hota hai',
    'mujhe ye chapter samajh nahi aaya',
    'mujhe maths nahi aati',
    'jeene ki kala ek essay topic hai',
    'ghar jane ka time ho gaya',
    'suicide ek chapter me aaya tha history me',
    'mujhe padhna hai',
    'mujhe ghar jana hai',
    'main jaunga school',
    'ise mar do matlab multiply karo',
    'mujhe ye samajh nahi aa raha',
    'paani ka level mar gaya kya',
  ];

  for (const line of ordinary) {
    it(`leaves an ordinary sentence alone: "${line}"`, () => {
      expect(student(line).kind).not.toBe('support');
    });
  }
});
