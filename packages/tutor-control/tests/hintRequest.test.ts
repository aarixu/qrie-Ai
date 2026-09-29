import { describe, expect, it } from 'vitest';
import { asksForHint } from '../src/index';

/**
 * A SPOKEN "HINT DO" IS A REQUEST, NOT AN ANSWER (overnight review #21).
 *
 * Her silence nudge offers a hint out loud ("…or shall I give you a small
 * hint?"), and the ear used to send the reply straight to the judge as the
 * child's answer to the question — a wrong answer on record for saying "yes".
 */
describe('asksForHint', () => {
  it('hears the ways children actually ask (third review)', () => {
    for (const said of ['Can I have a hint?', 'may I have a hint', 'hint batao', 'hint bataiye', 'please tell me a hint', 'koi hint milega', 'hint mil sakta hai', 'what is the hint', 'hint de sakte ho'])
      expect(asksForHint(said, { afterOffer: false }), said).toBe(true);
  });

  it('hears a short request for help in English and Hinglish', () => {
    for (const said of ['hint', 'Give me a hint', 'hint do', 'hint dijiye please', 'help', 'help me', 'madad karo', 'ek hint do na'])
      expect(asksForHint(said, { afterOffer: false }), said).toBe(true);
  });

  it("leaves I don't know to the judge, which reads it as a miss so the ladder can climb", () => {
    for (const said of ["I don't know", 'pata nahi', 'samajh nahi aaya', 'not sure'])
      expect(asksForHint(said, { afterOffer: true }), said).toBe(false);
  });

  it('never takes an answer that only uses a help word for one (second review)', () => {
    for (const said of ['Roots help absorb water', 'they help in digestion', 'madad karta hai', 'not sure, maybe 12', 'hint is 12'])
      expect(asksForHint(said, { afterOffer: true }), said).toBe(false);
  });

  it('never takes a thinking noise for a yes', () => {
    expect(asksForHint('hmm', { afterOffer: true })).toBe(false);
  });

  it('takes a bare yes as a request only right after she offered a hint', () => {
    for (const said of ['yes', 'haan', 'Haan ji', 'yeah', 'ha', 'okay'])
      expect(asksForHint(said, { afterOffer: true }), said).toBe(true);
    for (const said of ['yes', 'haan', 'okay']) expect(asksForHint(said, { afterOffer: false }), said).toBe(false);
  });

  it('leaves an answer alone, even one that mentions help', () => {
    for (const said of [
      'x equals four',
      '7',
      'carbon dioxide',
      'the answer is 4 I think',
      'yes because seven has only two factors',
      'haan, photosynthesis mein carbon dioxide leti hai',
    ])
      expect(asksForHint(said, { afterOffer: true }), said).toBe(false);
  });

  it('never reads a long reply as a request', () => {
    expect(asksForHint('I do not know why the sugar goes away in the water', { afterOffer: true })).toBe(false);
  });

  it('never takes yes as a request when yes is itself an answer on the board', () => {
    expect(asksForHint('yes', { afterOffer: true, answers: ['Yes', 'No'] })).toBe(false);
    expect(asksForHint('haan', { afterOffer: true, answers: ['Haan', 'Nahi'] })).toBe(false);
  });
});

describe('asksForHint, fifth review', () => {
  it('leaves an answer about helping as an answer', () => {
    for (const said of ['yes it will help', 'it will help', 'it would help', 'haan madad milegi', 'madad milegi', 'yes more help'])
      expect(asksForHint(said, { afterOffer: false }), said).toBe(false);
  });
  it('hears a question about help as an ask (sixth review)', () => {
    for (const said of ['will you help me', 'would you help me', 'kya madad milegi', 'madad milegi kya', 'mujhe madad milegi', 'more help please'])
      expect(asksForHint(said, { afterOffer: false }), said).toBe(true);
  });

  it('hears a longer polite ask', () => {
    for (const said of ['can you give me a hint', 'mam please give me a hint', 'koi hint mil sakta hai kya', 'miss can I have a hint'])
      expect(asksForHint(said, { afterOffer: false }), said).toBe(true);
  });
});

describe('asksForHint, seventh review', () => {
  it('leaves an answer that mentions "you" or follows a yes as an answer', () => {
    for (const said of ['it will help you', 'yes it will help you', 'it would help you', 'haan mujhe madad milegi', 'you will get more help'])
      expect(asksForHint(said, { afterOffer: false }), said).toBe(false);
  });
});

describe('asksToExplainAgain (H4)', () => {
  it('hears a request to explain it another way, in English and Hinglish', async () => {
    const { asksToExplainAgain } = await import('../src/index');
    for (const said of ['explain it another way', 'can you explain again', 'phir se samjhao', 'doosre tareeke se samjhaiye', 'ek baar aur samjha do'])
      expect(asksToExplainAgain(said), said).toBe(true);
    for (const said of ['explain why 7 is prime', 'it is explained by gravity', 'x = 3']) expect(asksToExplainAgain(said), said).toBe(false);
  });

  // Second review: bare "samjha" is "(I) understood", and filing it as an L7
  // request took rung-0 credit away from the next answer.
  it('hears "samjha" as understood, and not understanding as a request', async () => {
    const { asksToExplainAgain } = await import('../src/index');
    for (const said of ['samjha', 'ji samjha', 'samjha sir', 'haan samjha'])
      expect(asksToExplainAgain(said), said).toBe(false);
    for (const said of ['nahi samjha', 'samajh nahi aaya', "I don't understand", 'I did not understand', 'samjha do', 'samjha dijiye'])
      expect(asksToExplainAgain(said), said).toBe(true);
  });
});
