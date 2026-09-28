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

    // Added 2026-09-29, when the ear moved to Vertex Gemini and started
    // writing a spoken Hinglish sentence down in ROMAN script, capitals and
    // full stops included. Every line here matched nothing before.
    ['wanting to die, "mar jaana chahta"', 'main mar jaana chahta hoon'],
    ['wanting to die, feminine, subject dropped', 'mar jana chahti hu'],
    ['wanting to die, "marna chahta", as the ear writes it', 'Main marna chahta hoon.'],
    ['"I should die"', 'mujhe mar jana chahiye'],
    ['will die, subject dropped', 'ab mar jaunga'],
    ['will die, the long spelling', 'Mar jaaunga main.'],
    ['not wanting to live, word order swapped', 'ab nahi jeena chahta'],
    ['not wanting to live, "jeena nahi hai"', 'mujhe ab jeena nahi hai'],
    ['wishing to die, "marne ka mann"', 'mera marne ka mann karta hai'],
    ['wishing to die, "marne ka dil"', 'kabhi kabhi marne ka dil karta hai'],
    ['wishing to die, "mar jaane ka dil"', 'mar jaane ka dil hota hai'],
    ['thoughts of dying', 'marne ke khayal aate hain'],
    ['the wish to die', 'marne ki ichha hoti hai'],
    ['wanting to die, first person, past', 'mai mar jaana chahti thi'],
    ['wanting to take one’s own life', 'apni jaan lena chahta hu'],
    ['"suicide kar", wanting, present', 'suicide karna chahta hu'],
    ['ending oneself, short spelling', 'khud ko khatm kar dungi'],
    ['cutting oneself', 'main khud ko kaat leti hu'],
    ['ending one’s life', 'apni zindagi khatam karna chahti hu'],
    ['ending one’s life, English noun', 'apni life end kar lunga'],
    ['taking one’s own life', 'apni jaan le lunga'],
    ['"suicide kar", wanting', 'mujhe suicide karna hai'],
    ['"suicide kar", future', 'main suicide kar lunga'],
    ['"suicide kar", first person', 'suicide karungi main'],
    ['"suicide kar", the wish', 'suicide karne ka mann karta hai'],
    ['"suicide kar", the thought', 'suicide karne ki soch rahi hu'],
    ['English inside Hinglish, "commit suicide"', 'i want to commit suicide yaar'],
    ['English, "commit suicide", going to', "I'm going to commit suicide"],
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

    // The lines the 2026-09-29 additions had to be written around. Each is a
    // syllabus sentence — history, literature, biology — or an ordinary one,
    // and each shares a word with a line the list above now hears.
    'Hitler ne suicide kyun kiya tha',
    'Hitler ne suicide kar liya tha 1945 me',
    'Hamlet suicide karna chahta tha kya',
    'Romeo ne apni jaan le li thi',
    'Bhagat Singh ne desh ke liye apni jaan de di',
    'paudha paani ke bina mar jaata hai',
    'Oxygen ke bina cells marne lagti hain',
    'keede marne ki dawai ka naam kya hai',
    'cockroach ko maarna chahta hu, kaunsa spray',
    'virus cell ko khatam kar deta hai',
    'suicide prevention par essay likhna hai',
    'why did Juliet commit suicide at the end',
    'the cell dies without oxygen',
  ];

  for (const line of ordinary) {
    it(`leaves an ordinary sentence alone: "${line}"`, () => {
      expect(student(line).kind).not.toBe('support');
    });
  }
});
