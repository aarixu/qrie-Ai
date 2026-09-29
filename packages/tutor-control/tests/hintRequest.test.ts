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
  it('hears a short request for help in English and Hinglish', () => {
    for (const said of ['hint', 'Give me a hint', 'hint do', 'hint dijiye please', 'help', 'madad karo', "I don't know", 'pata nahi', 'samajh nahi aaya', 'not sure'])
      expect(asksForHint(said, { afterOffer: false }), said).toBe(true);
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
