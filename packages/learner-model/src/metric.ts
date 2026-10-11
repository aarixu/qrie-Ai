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

/**
 * A sitting as the server holds it (public.learning_session): its time on
 * task, which the server bounds (close_learning_session, 0107; a hand-in,
 * 0114), and whether it is over.
 */
export interface SittingTime {
  id: string;
  /** learning_session.active_ms; null when nobody measured it. */
  activeMs: number | null;
  /** learning_session.ended_at is set: no more time will be recorded for it. */
  ended: boolean;
}

/**
 * THE METRIC AS THE BRAIN KEEPS IT BETWEEN RUNS (lam-one-brain Task 14), in
 * learner_model.snapshot next to the model, because the nightly purge
 * deletes old sittings and their time with them.
 *
 * A sitting's gain is `unassistedGain` over the model before and after each
 * part of it that is folded (think.ts folds a sitting in the batches the
 * server received it in), summed: per sitting, as `npm run model:metric`
 * reads the metric, not over a learner's whole history. A sitting's gain
 * waits in `open` until the server knows its time on task. Then it is counted
 * with that time; or, when the sitting is over with no time measured (a
 * hand-in sent without it, practice) or is no longer held, it goes to
 * `untimedGain`, which is never in the ratio: dividing gain made in unmeasured
 * time by the minutes of other sittings would overstate it.
 *
 * The tally outlives the purge only while the snapshot does. A rebuild (a
 * forced one, or any snapshot of another MODEL_VERSION, think.ts
 * `usableSnapshot`) starts again from `emptyTally` over the ledger the server
 * still holds, so the gain and minutes of sittings already purged are gone
 * from the figure after it (packages/lms-brain/tests/metric.test.ts).
 */
export interface MetricTally {
  /** Unassisted gain in sittings whose time on task is counted. */
  timedGain: number;
  /** Their time on task, in milliseconds. */
  timedMs: number;
  /** Unassisted gain in sittings that ended with no time measured. */
  untimedGain: number;
  /** Gain per sitting whose time is not known yet. */
  open: Record<string, number>;
  /** Sittings whose time is in timedMs, while the server still holds them, so a late answer adds its gain and not the time again. */
  counted: string[];
}

export const emptyTally = (): MetricTally => ({ timedGain: 0, timedMs: 0, untimedGain: 0, open: {}, counted: [] });

/** A sitting, or one batch of it, folded: `before` and `after` are the model either side. Returns a new tally. */
export function tallySitting(
  tally: MetricTally,
  sittingId: string,
  before: LearnerModel,
  after: LearnerModel,
): MetricTally {
  const gain = unassistedGain(before, after);
  if (tally.counted.includes(sittingId)) return { ...tally, timedGain: tally.timedGain + gain };
  return { ...tally, open: { ...tally.open, [sittingId]: (tally.open[sittingId] ?? 0) + gain } };
}

/**
 * Settles what can be settled, given every sitting of `open` and `counted`
 * the server still holds (one missing is one it no longer holds). Time on
 * task of 0 measured nothing, so it settles as no time, like null.
 */
export function settleSittings(tally: MetricTally, held: readonly SittingTime[]): MetricTally {
  const byId = new Map(held.map((s) => [s.id, s]));
  const next: MetricTally = { ...tally, open: {}, counted: tally.counted.filter((id) => byId.has(id)) };
  for (const [id, gain] of Object.entries(tally.open)) {
    const s = byId.get(id);
    if (s && s.activeMs !== null && s.activeMs > 0) {
      next.timedGain += gain;
      next.timedMs += s.activeMs;
      if (!next.counted.includes(id)) next.counted.push(id);
    } else if (!s || s.ended) {
      next.untimedGain += gain;
    } else {
      next.open[id] = gain;
    }
  }
  return next;
}

/**
 * What the brain writes (learner_model.metrics) and learnerProfile reports.
 * The gain is `unassistedGain`, which reads `unassistedMastery`: it counts
 * cold answers whoever graded them, so a class lesson's answers the phone
 * graded (Task 15) are in it, though they never make `masteredAt` or the
 * teacher's figures on their own.
 */
export interface LearningMetric {
  /** Unassisted gain in sittings with measured time on task. */
  gain: number;
  learningMinutes: number;
  /** gain / learningMinutes; null, not 0, when no minutes are measured. */
  gainPerMinute: number | null;
  /** Unassisted gain in sittings with no measured time: not in the ratio. */
  untimedGain: number;
  /** Sittings whose time is not known yet. */
  openSittings: number;
}

export function learningMetric(tally: MetricTally): LearningMetric {
  const learningMinutes = tally.timedMs / 60_000;
  return {
    gain: tally.timedGain,
    learningMinutes,
    gainPerMinute: tally.timedMs > 0 ? tally.timedGain / learningMinutes : null,
    untimedGain: tally.untimedGain,
    openSittings: Object.keys(tally.open).length,
  };
}
