import { describe, expect, it } from 'vitest';
import { MATCH_FLOOR, matchSpokenAnswer } from '../../tutor-judge/src/match';

/**
 * WHAT THE OPTION TEXT'S REGISTER COSTS, ON A PROBE ANYBODY CAN RE-RUN.
 *
 * `HINGLISH_REGISTER` tells the planner to leave every option's `text` in
 * English even in a Hinglish class, and an earlier docblock justified that with
 * three decimals measured on a probe that was written down nowhere. Three
 * different people measured three different probes and got three different
 * numbers, which is the whole argument for this file existing: a
 * probe-specific figure that is not committed is not a measurement, it is a
 * recollection.
 *
 * So the probe is here, the numbers below came out of this file, and anyone who
 * changes the matcher will see them move.
 *
 * WHAT THEY SHOW, and it is not what that docblock concluded. The thing that
 * decides a local match is not whether the option text is ENGLISH — it is
 * whether the option text is in the SAME REGISTER as the words the student
 * actually says. A Hinglish student answering a Hinglish-worded option matches
 * at 1.000; the same student against English-worded options scores 0.200 and
 * escalates to the paid judge. English option text is the right choice for an
 * English class and the expensive one for a Hinglish class.
 *
 * THIS FILE DOES NOT CHANGE THE INSTRUCTION, because the instruction has a
 * second reason behind it: on the confusable-pairs exception the option text is
 * what the BOARD writes, and the board stays English because it is what a child
 * copies into a notebook for an English exam. Whether that is worth a model
 * call on every spoken Hinglish answer is a product decision with a price on
 * it, and this file is the price.
 */

const EN = [
  'arteries carry blood away from the heart',
  'veins carry blood to the heart',
  'capillaries are the smallest vessels',
];
const HI = [
  'arteries khoon ko dil se door le jaati hain',
  'veins khoon ko dil tak laati hain',
  'capillaries sabse choti vessels hoti hain',
];

const conf = (said: string, options: string[]) => matchSpokenAnswer(said, options).confidence;

describe('the matcher rewards option text written in the register the student speaks', () => {
  it('resolves a verbatim answer locally when the options are in the same register', () => {
    expect(conf(EN[0], EN)).toBe(1);
    expect(conf(HI[0], HI)).toBe(1);
  });

  it('escalates the SAME verbatim answer when the options are in the other register', () => {
    // 0.167 and 0.200 against a floor of 0.55 — both refusals, both a paid
    // judge call for an answer the class already had written down.
    expect(conf(EN[0], HI)).toBeCloseTo(0.167, 3);
    expect(conf(HI[0], EN)).toBeCloseTo(0.2, 3);
    expect(conf(EN[0], HI)).toBeLessThan(MATCH_FLOOR);
    expect(conf(HI[0], EN)).toBeLessThan(MATCH_FLOOR);
  });

  /**
   * The honest other half, and the reason this is a trade rather than a bug:
   * English option text does not RESCUE a Hinglish paraphrase either. A
   * paraphrase escalates in every combination, so the register question only
   * decides what happens to answers that land close to the authored words.
   */
  it('escalates a paraphrase whichever register either side is in', () => {
    const enSaid = 'blood goes away from the heart in arteries';
    const hiSaid = 'arteries dil se khoon bahar le jaati hai';
    for (const c of [conf(enSaid, EN), conf(enSaid, HI), conf(hiSaid, EN), conf(hiSaid, HI)]) {
      expect(c).toBeLessThan(MATCH_FLOOR);
    }
  });
});
