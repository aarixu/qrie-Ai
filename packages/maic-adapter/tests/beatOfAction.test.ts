import { describe, expect, it } from 'vitest';
import { beatOfAction, type BeatRange } from '../src/beatOfAction';

const ranges: BeatRange[] = [
  { beatId: 'b_hook', from: 0, to: 2 },
  { beatId: 'b_teach_outer', from: 2, to: 6 },
  { beatId: 'b_check', from: 6, to: 7 },
];

describe('an action index resolves to the beat that owns it', () => {
  it('finds the beat for the first action of a range', () => {
    expect(beatOfAction(ranges, 0)).toBe('b_hook');
    expect(beatOfAction(ranges, 2)).toBe('b_teach_outer');
    expect(beatOfAction(ranges, 6)).toBe('b_check');
  });

  it('finds the beat for the last action of a range', () => {
    // `to` is exclusive, so the last action of b_hook is index 1.
    expect(beatOfAction(ranges, 1)).toBe('b_hook');
    expect(beatOfAction(ranges, 5)).toBe('b_teach_outer');
  });

  it('returns null past the end — a hand raised after the class is not a doubt about a beat', () => {
    expect(beatOfAction(ranges, 7)).toBeNull();
    expect(beatOfAction(ranges, 99)).toBeNull();
  });

  it('returns null for a negative index rather than guessing', () => {
    expect(beatOfAction(ranges, -1)).toBeNull();
  });

  it('returns null when there are no ranges at all', () => {
    expect(beatOfAction([], 0)).toBeNull();
  });

  it('ignores an empty range instead of claiming an index', () => {
    // A beat that emitted no actions (a silent recap) must never own an index,
    // or it would swallow the first action of the beat after it.
    const withEmpty: BeatRange[] = [
      { beatId: 'b_silent', from: 0, to: 0 },
      { beatId: 'b_real', from: 0, to: 2 },
    ];
    expect(beatOfAction(withEmpty, 0)).toBe('b_real');
  });
});
