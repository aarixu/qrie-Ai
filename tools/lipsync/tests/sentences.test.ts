import { describe, expect, it } from 'vitest';
import { splitSentences } from '../lib/sentences.mjs';

/**
 * WHY THE SPLITTER IS ITS OWN MODULE WITH ITS OWN TESTS.
 *
 * The rule-table driver has no audio. It knows the script and the clip's
 * total duration, and nothing else. Drift between the two accumulates across
 * a paragraph, so the only defence is to re-anchor often — avatar-3.md:1F
 * puts it plainly: cut at sentence boundaries and scale per sentence and
 * "drift stays under a syllable".
 *
 * So the splitter is not cosmetic. It is the thing that decides how often the
 * timing is re-anchored, and a splitter that returns one sentence for a
 * 25-second beat hands back a 25-second drift window.
 */
describe('splitSentences', () => {
  it('splits on full stops and keeps the terminator', () => {
    expect(splitSentences('Blood moves. It carries oxygen.')).toEqual([
      'Blood moves.',
      'It carries oxygen.',
    ]);
  });

  it('splits on question and exclamation marks', () => {
    expect(splitSentences('Ready? Go! Now.')).toEqual(['Ready?', 'Go!', 'Now.']);
  });

  it('splits on the Devanagari danda', () => {
    // The tutor register is Hinglish. Even romanised Hinglish narration is
    // written with a danda often enough that ignoring it merges two
    // sentences into one drift window.
    expect(splitSentences('Dekho beta। Blood chalta hai।')).toEqual([
      'Dekho beta।',
      'Blood chalta hai।',
    ]);
  });

  it('does not split inside a decimal number', () => {
    // "5.5 litres" is one sentence. Splitting it invents an anchor point in
    // the middle of a word and the scaling goes with it.
    expect(splitSentences('About 5.5 litres flow.')).toEqual(['About 5.5 litres flow.']);
  });

  it('does not split on the em dash the narration is full of', () => {
    // Every committed lesson narration uses em dashes as asides. They are not
    // sentence ends and the audio does not pause like one.
    expect(splitSentences('Plasma is the liquid — it carries waste.')).toEqual([
      'Plasma is the liquid — it carries waste.',
    ]);
  });

  it('returns nothing for empty or whitespace text', () => {
    expect(splitSentences('   ')).toEqual([]);
    expect(splitSentences('')).toEqual([]);
  });

  it('keeps a trailing fragment that has no terminator', () => {
    expect(splitSentences('One line to keep')).toEqual(['One line to keep']);
  });
});
