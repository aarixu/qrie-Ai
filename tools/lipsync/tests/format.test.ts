import { describe, expect, it } from 'vitest';
import {
  MOUTH_SHAPES,
  SHAPE_NOTES,
  normaliseCues,
  timelineBytes,
  validateTimeline,
} from '../lib/format.mjs';

/**
 * THE ONE FORMAT. docs/research/avatar-3.md:208 fixes it as
 * `[{ t, d, v }]` — start, duration, mouth shape — and the whole point of
 * pinning it here is that the RENDERER is undecided. Sprites now, Rive
 * later; if the alignment pipeline emits this, neither choice can reach
 * back and change the other.
 *
 * normaliseCues exists because the aligner we actually ran does NOT emit a
 * clean timeline. rhubarb-lip-sync-wasm@0.1.8 on the real narration audio
 * returned cues that overlap each other — measured, not assumed; see
 * docs/research/lipsync-hinglish-result.md. A renderer reading that array
 * frame by frame would show two mouths at once, which is not a thing a face
 * can do. So the overlap is resolved HERE, once, rather than in every
 * consumer.
 */
describe('the nine mouth shapes', () => {
  it('is exactly the set the illustrator gets commissioned against', () => {
    expect(MOUTH_SHAPES).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);
  });

  it('carries the note that tells the illustrator what to draw', () => {
    // Nine shapes with no descriptions is a list of letters. The commission
    // brief is the descriptions (avatar-3.md:191).
    for (const shape of MOUTH_SHAPES) {
      expect(SHAPE_NOTES[shape]).toBeTruthy();
    }
  });
});

describe('normalising a raw aligner timeline', () => {
  it('converts start/end to start/duration', () => {
    const out = normaliseCues([{ start: 0, end: 0.34, value: 'X' }], { duration: 0.34 });
    expect(out).toEqual([{ t: 0, d: 0.34, v: 'X' }]);
  });

  it('resolves the overlap rhubarb-wasm actually produced', () => {
    // These three cues are copied verbatim from a real run over
    // content/class10-blood/audio/hook.m4a — the NO-SCRIPT pass, 138 raw cues.
    // (The +dialog pass over the same clip produces different cues at that
    // instant; naming the arm matters because the two are not interchangeable.)
    // E and B overlap between 0.69 and 0.77. The later cue owns its own span;
    // the earlier one is truncated.
    const out = normaliseCues(
      [
        { start: 0.6, end: 0.77, value: 'E' },
        { start: 0.69, end: 0.77, value: 'B' },
        { start: 0.77, end: 0.89, value: 'E' },
      ],
      { duration: 0.89, padStart: false },
    );
    expect(out).toEqual([
      { t: 0.6, d: 0.09, v: 'E' },
      { t: 0.69, d: 0.08, v: 'B' },
      { t: 0.77, d: 0.12, v: 'E' },
    ]);
  });

  it('merges two runs of the same shape into one cue', () => {
    // Also from that same no-script pass: B 1.14-1.52 and B 1.45-1.60. Two
    // cues showing the same drawing is two bytes spent on nothing.
    const out = normaliseCues(
      [
        { start: 1.14, end: 1.52, value: 'B' },
        { start: 1.45, end: 1.6, value: 'B' },
      ],
      { duration: 1.6, padStart: false },
    );
    expect(out).toEqual([{ t: 1.14, d: 0.46, v: 'B' }]);
  });

  it('fills interior gaps with the idle shape so the timeline is gapless', () => {
    // A renderer asked "what shape at t?" must always get an answer. A gap
    // means the mouth is undefined, and undefined renders as whatever was
    // there last — a frozen mouth mid-word.
    const out = normaliseCues(
      [
        { start: 0, end: 0.2, value: 'C' },
        { start: 0.5, end: 0.7, value: 'D' },
      ],
      { duration: 1.0 },
    );
    expect(out).toEqual([
      { t: 0, d: 0.2, v: 'C' },
      { t: 0.2, d: 0.3, v: 'X' },
      { t: 0.5, d: 0.2, v: 'D' },
      { t: 0.7, d: 0.3, v: 'X' },
    ]);
  });

  it('keeps the tail of a cue that ENCLOSES later ones', () => {
    // NOT from a real run, and saying so matters: I counted the raw output of
    // rhubarb-lip-sync-wasm@0.1.8 over content/class10-blood/audio and found
    // overlaps in quantity and ZERO enveloping cues, so this case does not
    // arise today. It is pinned because the alternative implementation —
    // clipping each cue against the one immediately after it — is the obvious
    // one, and it silently hands 60 % of an open mouth to the idle shape here.
    // A renderer inherits that from whichever aligner comes next.
    const out = normaliseCues(
      [
        { start: 0, end: 1, value: 'D' },
        { start: 0.1, end: 0.2, value: 'B' },
        { start: 0.3, end: 0.4, value: 'A' },
      ],
      { duration: 1 },
    );
    expect(out).toEqual([
      { t: 0, d: 0.1, v: 'D' },
      { t: 0.1, d: 0.1, v: 'B' },
      { t: 0.2, d: 0.1, v: 'D' },
      { t: 0.3, d: 0.1, v: 'A' },
      { t: 0.4, d: 0.6, v: 'D' },
    ]);
    expect(validateTimeline(out)).toEqual([]);
  });

  it('rejects a shape that is not one of the nine', () => {
    // Silently dropping it would ship a timeline with a hole in it.
    expect(() => normaliseCues([{ start: 0, end: 1, value: 'Z' }], { duration: 1 })).toThrow(/Z/);
  });

  it('clamps a cue that runs past the end of the audio', () => {
    const out = normaliseCues([{ start: 0, end: 5 }].map((c) => ({ ...c, value: 'D' })), {
      duration: 2,
    });
    expect(out).toEqual([{ t: 0, d: 2, v: 'D' }]);
  });
});

describe('validateTimeline', () => {
  it('passes a clean timeline', () => {
    expect(validateTimeline([{ t: 0, d: 0.5, v: 'A' }, { t: 0.5, d: 0.5, v: 'B' }])).toEqual([]);
  });

  it('names an overlap rather than shrugging', () => {
    const problems = validateTimeline([
      { t: 0, d: 0.6, v: 'A' },
      { t: 0.5, d: 0.5, v: 'B' },
    ]);
    expect(problems.join(' ')).toMatch(/overlap/i);
  });

  it('names a non-positive duration', () => {
    expect(validateTimeline([{ t: 0, d: 0, v: 'A' }]).join(' ')).toMatch(/duration/i);
  });
});

describe('the size claim', () => {
  it('measures bytes rather than repeating the 2 KB/minute figure', () => {
    // avatar-3.md:208 says "roughly 2 KB per minute". That is a claim about
    // OUR output, so it is measurable here and must never be quoted from the
    // research doc as though it had been checked.
    const oneCue = timelineBytes([{ t: 1.24, d: 0.085, v: 'D' }]);
    expect(oneCue).toBeGreaterThan(0);
    expect(timelineBytes([])).toBeLessThan(oneCue);
  });
});
