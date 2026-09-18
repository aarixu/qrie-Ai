import { describe, expect, it } from 'vitest';
import { SHUT_SHAPES, validateTimeline } from '../lib/format.mjs';
import { alignByRules } from '../lib/rules-driver.mjs';

/**
 * THE FALLBACK PIPELINE, END TO END.
 *
 * HONESTY NOTE ON HOW THIS FILE CAME TO EXIST: the four modules underneath it
 * were written test-first. This one was not — it was added after the
 * measurement run, when it became clear that the composition is the thing the
 * product actually depends on and that nothing was pinning its contract. It is
 * a contract test, not a design test, and saying so is cheaper than pretending
 * otherwise.
 *
 * What it pins is the promise every consumer relies on and no single module
 * can make alone: whatever text goes in, what comes out is a valid, ordered,
 * gapless timeline that covers exactly the clip. A renderer asking "what shape
 * at t?" gets an answer for every t inside the audio, or the tutor's mouth
 * freezes mid-word and nothing upstream finds out.
 */

// The first TWO SENTENCES of the opening beat of content/class10-blood (165 of
// the beat's 258 characters, content/class10-blood/lesson.json), scaled to the
// whole beat's measured length (19.68 s, content/class10-blood/audio/
// narration.json). The ratio is wrong on purpose-free grounds — it simply does
// not matter to the structural assertions below, none of which depend on words
// per second. Said here rather than left to be discovered.
const NARRATION =
  "Hold out your wrist and look at the veins. About five litres of blood are looping through you " +
  'right now, completing a full round trip of your body in under a minute.';
const HINGLISH =
  'Apni kalai dekho — nason ko dekho. Abhi is waqt tumhare andar lagbhag paanch litre khoon ' +
  'ghoom raha hai, poore shareer ka ek chakkar ek minute se bhi kam mein.';
// The same beat in Devanagari. Not a corpus line — nothing in this repo is
// written this way — but it is the input that used to produce a mouth shut for
// the whole clip, exit 0, and no warning.
const DEVANAGARI = 'अपनी कलाई देखो — नसों को देखो। इस वक्त तुम्हारे अंदर लगभग पाँच लीटर खून घूम रहा है।';

/** How much of the clip the mouth spends in a shape that is not shut. */
function openFraction(cues: { d: number; v: string }[], duration: number): number {
  return cues.filter((c) => !SHUT_SHAPES.has(c.v)).reduce((s, c) => s + c.d, 0) / duration;
}

describe('alignByRules', () => {
  it('produces a valid timeline for English narration', () => {
    expect(validateTimeline(alignByRules(NARRATION, 19.68))).toEqual([]);
  });

  it('produces a valid timeline for Hinglish narration, and one that OPENS', () => {
    // The whole reason the driver exists. Romanised Hindi is letters, so
    // nothing here is a special case — which is the claim being checked.
    //
    // The open-mouth assertion is the load-bearing half. `validateTimeline`
    // alone is satisfied by a single idle cue spanning the whole clip, so a
    // suite that only checked validity would have passed a tutor who never
    // opens her mouth. MEASURED on this fixture: 71 % open.
    const cues = alignByRules(HINGLISH, 19.68);
    expect(validateTimeline(cues)).toEqual([]);
    expect(cues.length).toBeGreaterThan(40);
    expect(openFraction(cues, 19.68)).toBeGreaterThan(0.3);
  });

  it('refuses a script it cannot read, rather than returning a shut mouth', () => {
    // THE FAILURE THIS TEST EXISTS FOR. The table reads Latin letters; every
    // Devanagari character falls through to the pause branch, so the "timeline"
    // was one idle cue holding a shut mouth for 19.68 seconds — ordered,
    // gapless, non-overlapping, structurally perfect and completely wrong.
    // An empty array is the refusal; a mouth that never opens is not an answer.
    expect(alignByRules(DEVANAGARI, 19.68)).toEqual([]);
  });

  it('covers the clip from zero to the end with no gaps', () => {
    const cues = alignByRules(NARRATION, 19.68);
    expect(cues[0].t).toBe(0);
    const last = cues[cues.length - 1];
    expect(last.t + last.d).toBeCloseTo(19.68, 3);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].t).toBeCloseTo(cues[i - 1].t + cues[i - 1].d, 9);
    }
  });

  it('scales with the clip: the same text over twice the time holds each shape longer', () => {
    const fast = alignByRules(NARRATION, 10);
    const slow = alignByRules(NARRATION, 20);
    expect(slow.length).toBe(fast.length);
    const meanOf = (cues: { d: number }[]) => cues.reduce((s, c) => s + c.d, 0) / cues.length;
    expect(meanOf(slow)).toBeGreaterThan(meanOf(fast) * 1.9);
  });

  it('shifts the whole mouth earlier when asked to lead the audio', () => {
    // Animators lead the mouth ahead of the sound. A build-step pipeline can,
    // because it can see the future — but the amount is an art decision, so
    // the default is 0 and this only checks the lever works.
    //
    // ASSERT PAST THE CLAMP. The first cue starts at t=0 in both runs, because
    // normaliseCues clamps the lead-shifted negative start back to zero — so
    // comparing first cues compares 0 with 0 and passes with the lever removed
    // entirely. A cue in the middle of the clip is where the shift is visible.
    const plain = alignByRules(NARRATION, 19.68);
    const led = alignByRules(NARRATION, 19.68, { leadMs: 40 });
    expect(led.length).toBe(plain.length);
    const i = 10; // MEASURED: 1.658 s plain, 1.618 s led.
    expect(led[i].t).toBeCloseTo(plain[i].t - 0.04, 3);
    expect(validateTimeline(led)).toEqual([]);
  });

  it('refuses to invent a mouth with no text or no clock', () => {
    expect(alignByRules('', 19.68)).toEqual([]);
    expect(alignByRules(NARRATION, 0)).toEqual([]);
  });

  it('opens the mouth for most of an English clip too', () => {
    // The same assertion as the Hinglish one, on the arm the report calls the
    // English path. Both are here so that no future change can make either
    // driver quietly mute without a test noticing.
    expect(openFraction(alignByRules(NARRATION, 19.68), 19.68)).toBeGreaterThan(0.3);
  });
});
