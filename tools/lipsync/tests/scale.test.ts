import { describe, expect, it } from 'vitest';
import { allocate, scaleUnits } from '../lib/scale.mjs';

/**
 * THE SCALING IS THE WHOLE FALLBACK.
 *
 * The rule table emits UNITLESS relative durations (avatar-3.md:1F). Turning
 * those into seconds against a measured clip length is the only step between
 * "a list of letters" and "a mouth that matches the audio". If the scaled
 * cues do not sum to exactly the clip duration, the mouth finishes early or
 * late — and at 20 seconds a beat, "roughly" is a visible desync.
 */
describe('scaleUnits', () => {
  it('lays cues end to end from the start offset', () => {
    const out = scaleUnits([{ v: 'A', w: 1 }, { v: 'B', w: 1 }], { start: 0, duration: 1 });
    expect(out).toEqual([{ t: 0, d: 0.5, v: 'A' }, { t: 0.5, d: 0.5, v: 'B' }]);
  });

  it('sums to EXACTLY the duration, not merely close to it', () => {
    // toBe, not toBeCloseTo. Closeness is what plain proportional division
    // already gives (MEASURED: the three-equal-weights case lands on 1 either
    // way); exactness is the only thing the last-cue-takes-the-remainder
    // branch actually buys, so exactness is what gets asserted.
    const out = scaleUnits(
      [{ v: 'A', w: 1 }, { v: 'B', w: 1 }, { v: 'C', w: 1 }],
      { start: 0, duration: 1 },
    );
    const end = out[out.length - 1].t + out[out.length - 1].d;
    expect(end).toBe(1);
  });

  it('sums exactly on a weight set where proportional division does not', () => {
    // Real SHAPE_WEIGHT values (A B C D C) over the real length of the `hook`
    // beat. MEASURED: accumulating (19.68 * w / total) for these five lands on
    // 19.679999999999996 — 3.6e-15 short. Small, and it is still the only case
    // in this file where the branch under test changes the answer at all.
    const out = scaleUnits(
      [
        { v: 'A', w: 0.95 },
        { v: 'B', w: 0.9 },
        { v: 'C', w: 1.05 },
        { v: 'D', w: 1.15 },
        { v: 'C', w: 1.05 },
      ],
      { start: 0, duration: 19.68 },
    );
    const last = out[out.length - 1];
    expect(last.t + last.d).toBe(19.68);
  });

  it('honours the start offset', () => {
    const out = scaleUnits([{ v: 'D', w: 1 }], { start: 4.5, duration: 0.25 });
    expect(out).toEqual([{ t: 4.5, d: 0.25, v: 'D' }]);
  });

  it('weights longer shapes longer', () => {
    const out = scaleUnits([{ v: 'A', w: 1 }, { v: 'D', w: 3 }], { start: 0, duration: 1 });
    expect(out[1].d).toBeCloseTo(3 * out[0].d, 6);
  });

  it('returns nothing for no units rather than dividing by zero', () => {
    expect(scaleUnits([], { start: 0, duration: 1 })).toEqual([]);
  });
});

describe('allocate', () => {
  it('splits a clip duration across sentences in proportion to their weight', () => {
    // Two sentences, the second twice the weight of the first, over 3 s.
    expect(allocate([1, 2], 3)).toEqual([1, 2]);
  });

  it('gives the whole clip to a single sentence', () => {
    expect(allocate([7], 12.5)).toEqual([12.5]);
  });

  it('sums to the clip duration exactly', () => {
    const parts = allocate([3, 5, 7, 11], 19.712);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(19.712, 9);
  });

  it('returns nothing for no sentences', () => {
    expect(allocate([], 10)).toEqual([]);
  });
});
