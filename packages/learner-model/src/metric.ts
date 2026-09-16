import { PRIOR } from '@ai-tutor/knowledge-graph';
import type { LearnerModel } from './types.ts';

/**
 * THE PRIMARY METRIC'S NUMERATOR.
 *
 * Sums movement in `unassistedMastery`, and ONLY where a NEW unassisted
 * observation stands behind it. Belief that rose by propagation is belief
 * nobody tested: counting it would let the product congratulate itself for
 * inferring things, which is the failure every number in this repo is arranged
 * to prevent.
 *
 * A loss counts as a loss. A figure that can only rise is not a measurement,
 * and a tutor that cannot record having made a student worse at something
 * cannot notice it either.
 */
export function unassistedGain(before: LearnerModel, after: LearnerModel): number {
  let total = 0;
  for (const state of Object.values(after.states)) {
    const was = before.states[state.outcomeId];
    if (state.unassistedObservations <= (was?.unassistedObservations ?? 0)) continue;
    /**
     * AN OUTCOME NOBODY HAD TOUCHED STARTS AT THE PRIOR, and that IS its
     * baseline. This read `?? state.unassistedMastery` until 2026-09-16 —
     * baseline equal to the after value, delta zero — so the first unassisted
     * success an outcome ever had counted as nothing, and a student's whole
     * first sitting printed 0.0000 when model:metric first ran against real
     * rows. The observation guard above already ensures somebody asked cold;
     * zeroing the movement it stands behind measured tenure, not learning.
     */
    const delta = state.unassistedMastery - (was?.unassistedMastery ?? PRIOR);
    // A corrupted belief must not poison the whole figure. This file already
    // refuses to divide by zero for that reason, and then let NaN in through
    // the numerator by the same door — a NaN spreads further than an Infinity
    // and is harder to notice, because it survives every later sum silently.
    if (!Number.isFinite(delta)) continue;
    total += delta;
  }
  return total;
}

/**
 * UNASSISTED MASTERY GAIN PER LEARNING MINUTE — what this whole rebuild
 * optimises for, and Phase 3's own definition of done.
 *
 * Per LEARNING minute: `activeMs` off `session-ended`, never wall clock. A
 * class left open on a table is not learning, and the usual consolation prize
 * for a product that cannot measure learning is that it measures engagement
 * instead.
 *
 * Zero rather than Infinity on zero time. A sitting with no time on task
 * measured nothing, and one Infinity poisons every average it is folded into —
 * silently, because an average that has gone to Infinity looks like a bug in
 * the display rather than a hole in the data.
 */
export function gainPerLearningMinute(
  before: LearnerModel,
  after: LearnerModel,
  activeMs: number,
): number {
  if (activeMs <= 0) return 0;
  return unassistedGain(before, after) / (activeMs / 60_000);
}
