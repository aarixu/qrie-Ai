import { describe, expect, it } from 'vitest';
import { deriveRung } from '../src/rung';

describe('deriveRung', () => {
  it('is rung 0 when nothing helped and nothing was recorded', () => {
    expect(deriveRung([], 0)).toBe(0);
  });

  /**
   * THE DEFECT THIS EXISTS FOR. The classroom derives the recorded rung from a
   * per-mount React ref (classLedger.ts:186), so a remount between the hint and
   * the answer files a hinted answer as rung 0 — and rung 0 is produced by the
   * ABSENCE of a `helped` call, so the failure MANUFACTURES unassisted mastery
   * rather than losing it. The `helped` rows are still on the ledger; they are
   * the ground truth the ref was only ever a cache of.
   */
  it('believes the helped rows over a recorded rung that lost them', () => {
    expect(deriveRung([1, 3], 0)).toBe(3);
  });

  it('believes the recorded rung when it is the higher of the two', () => {
    // Help the ledger did not capture still happened. The recorded value is
    // evidence too; it is only untrustworthy in one direction.
    expect(deriveRung([2], 5)).toBe(5);
  });

  it('takes the most help ever offered, not the last', () => {
    expect(deriveRung([4, 1], 0)).toBe(4);
  });

  it('never returns a rung outside the ladder', () => {
    expect(deriveRung([8], 8)).toBe(8);
    expect(deriveRung([], 8)).toBe(8);
  });
});
