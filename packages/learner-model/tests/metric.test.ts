import { describe, expect, it } from 'vitest';
import {
  emptyConceptState,
  emptyModel,
  emptyTally,
  gainPerLearningMinute,
  learningMetric,
  settleSittings,
  tallySitting,
  unassistedGain,
} from '../src/index';

const modelWith = (id: string, unassistedMastery: number, unassistedObservations: number) => {
  const m = emptyModel();
  m.states[id] = { ...emptyConceptState(id), unassistedMastery, unassistedObservations };
  return m;
};

describe('unassistedGain', () => {
  it('is zero when nothing was learned unassisted', () => {
    expect(unassistedGain(emptyModel(), emptyModel())).toBe(0);
  });

  /**
   * Belief rose, but nobody asked them cold — so it is propagation, not proof.
   * Counting it would let the product congratulate itself for inferring things.
   */
  it('counts only movement a NEW unassisted observation stands behind', () => {
    expect(unassistedGain(modelWith('n', 0.5, 0), modelWith('n', 0.9, 0))).toBe(0);
    // Same observation count, higher belief: still propagation.
    expect(unassistedGain(modelWith('n', 0.5, 2), modelWith('n', 0.9, 2))).toBe(0);
  });

  /**
   * FOUND BY RUNNING model:metric AGAINST THE REAL PROJECT, 2026-09-16: a
   * synthetic student's first sitting held a genuine cold success and printed
   * 0.0000, because an outcome with no prior state fell back to its own after
   * value as the baseline. The baseline of an outcome nobody has touched is
   * not unknown — every ConceptState begins at the PRIOR — and a first sitting
   * is where most of a young product's learning happens. A metric that reads
   * a perfect first class as zero is measuring tenure, not learning.
   */
  it('counts the first unassisted success an outcome ever had', () => {
    const gained = unassistedGain(emptyModel(), modelWith('n', 0.78, 1));
    expect(gained).toBeCloseTo(0.28, 10);
  });

  it('counts a first cold FAILURE as a loss from the prior, symmetrically', () => {
    expect(unassistedGain(emptyModel(), modelWith('n', 0.32, 1))).toBeCloseTo(-0.18, 10);
  });

  it('counts a real cold gain', () => {
    expect(unassistedGain(modelWith('n', 0.5, 1), modelWith('n', 0.8, 2))).toBeCloseTo(0.3);
  });

  it('counts a loss as a loss, because a number that can only rise is not a measurement', () => {
    expect(unassistedGain(modelWith('n', 0.8, 1), modelWith('n', 0.5, 2))).toBeCloseTo(-0.3);
  });

  /**
   * REVERSED 2026-09-16, and the old rule's own words are why. It said the
   * prior was a starting point the outcome "was never at" — but
   * emptyConceptState BEGINS unassistedMastery at the prior and the fold
   * computes the first movement from exactly there; and an outcome whose
   * state a neighbour's propagation had already created (unassisted fields
   * untouched, i.e. AT the prior) always counted its first cold answer from
   * the prior anyway. Two identical first cold answers, different gains,
   * decided by whether a neighbour moved first — an implementation artifact
   * wearing an epistemic argument. The observation guard is what keeps
   * propagation out; the baseline is the prior, for every outcome, always.
   */
  it('counts an outcome that did not exist before from the prior, like every other', () => {
    expect(unassistedGain(emptyModel(), modelWith('fresh', 0.78, 1))).toBeCloseTo(0.28, 10);

    // The same first cold answer, but a neighbour's propagation created the
    // state object first: identical evidence, and now an identical gain.
    const touched = emptyModel();
    touched.states.fresh = { ...emptyConceptState('fresh'), mastery: 0.62 };
    expect(unassistedGain(touched, modelWith('fresh', 0.78, 1))).toBeCloseTo(0.28, 10);
  });

  it('adds up across outcomes', () => {
    const before = emptyModel();
    before.states.a = { ...emptyConceptState('a'), unassistedMastery: 0.4, unassistedObservations: 1 };
    before.states.b = { ...emptyConceptState('b'), unassistedMastery: 0.6, unassistedObservations: 1 };
    const after = emptyModel();
    after.states.a = { ...emptyConceptState('a'), unassistedMastery: 0.7, unassistedObservations: 2 };
    after.states.b = { ...emptyConceptState('b'), unassistedMastery: 0.5, unassistedObservations: 2 };
    expect(unassistedGain(before, after)).toBeCloseTo(0.2);
  });
});

describe('gainPerLearningMinute', () => {
  it('divides by time ON TASK', () => {
    const before = modelWith('n', 0.5, 1);
    const after = modelWith('n', 0.8, 2);
    expect(gainPerLearningMinute(before, after, 60_000)).toBeCloseTo(0.3);
    expect(gainPerLearningMinute(before, after, 120_000)).toBeCloseTo(0.15);
  });

  /**
   * A sitting with no time on task measured nothing, and one Infinity poisons
   * every average it is folded into — silently, because an average that has
   * gone to Infinity reads as a display bug rather than a hole in the data.
   */
  it('refuses to divide by nothing', () => {
    const before = modelWith('n', 0.5, 1);
    const after = modelWith('n', 0.8, 2);
    expect(gainPerLearningMinute(before, after, 0)).toBe(0);
    expect(gainPerLearningMinute(before, after, -1)).toBe(0);
  });
});

/**
 * THE BRIEF'S METRIC, KEPT BY THE BRAIN (lam-one-brain Task 14).
 *
 * Unassisted gain per learning minute for one learner over everything the
 * server has folded: each sitting's gain (unassistedGain before and after it)
 * is held open until the server knows the sitting's time on task, then
 * counted with that time, or, when the sitting ended with no measured time,
 * kept apart and never put in the ratio.
 */
describe('the metric tally', () => {
  const MIN = 60_000;
  const helpedOnly = () => {
    const m = emptyModel();
    m.states.n = { ...emptyConceptState('n'), assistedPerformance: 0.9, answerObservations: 3, unassistedObservations: 0 };
    return m;
  };

  it('computes the ratio exactly for a learner who gains on their own over N minutes', () => {
    let t = emptyTally();
    t = tallySitting(t, 's1', emptyModel(), modelWith('n', 0.78, 1));
    t = tallySitting(t, 's2', modelWith('n', 0.78, 1), modelWith('n', 0.9, 2));
    t = settleSittings(t, [
      { id: 's1', activeMs: 4 * MIN, ended: true },
      { id: 's2', activeMs: 6 * MIN, ended: true },
    ]);
    const m = learningMetric(t);
    expect(m.learningMinutes).toBe(10);
    expect(m.gain).toBeCloseTo(0.4, 10);
    expect(m.gainPerMinute).toBeCloseTo(0.04, 10);
    expect(m.untimedGain).toBe(0);
    expect(m.openSittings).toBe(0);
  });

  it('gives no ratio (null, not 0) when no minutes are measured', () => {
    expect(learningMetric(emptyTally()).gainPerMinute).toBeNull();
    let t = tallySitting(emptyTally(), 'hw', emptyModel(), modelWith('n', 0.78, 1));
    // A hand-in with no time on task: over, and nobody measured it.
    t = settleSittings(t, [{ id: 'hw', activeMs: null, ended: true }]);
    const m = learningMetric(t);
    expect(m.gainPerMinute).toBeNull();
    expect(m.learningMinutes).toBe(0);
    expect(m.gain).toBe(0);
    expect(m.untimedGain).toBeCloseTo(0.28, 10);
  });

  it('does not count gains made only with help', () => {
    let t = tallySitting(emptyTally(), 's1', emptyModel(), helpedOnly());
    t = settleSittings(t, [{ id: 's1', activeMs: 5 * MIN, ended: true }]);
    const m = learningMetric(t);
    expect(m.gain).toBe(0);
    expect(m.learningMinutes).toBe(5);
    expect(m.gainPerMinute).toBe(0);
  });

  it('keeps a sitting open until its time is known, and counts its minutes even when it gained nothing', () => {
    let t = tallySitting(emptyTally(), 'class', emptyModel(), emptyModel());
    t = settleSittings(t, [{ id: 'class', activeMs: null, ended: false }]);
    expect(learningMetric(t)).toMatchObject({ learningMinutes: 0, gainPerMinute: null, openSittings: 1 });
    t = settleSittings(t, [{ id: 'class', activeMs: 3 * MIN, ended: true }]);
    expect(learningMetric(t)).toMatchObject({ learningMinutes: 3, gain: 0, gainPerMinute: 0, openSittings: 0 });
  });

  it('never counts a sitting\'s minutes twice when a late answer arrives after they were counted', () => {
    let t = tallySitting(emptyTally(), 's1', emptyModel(), modelWith('n', 0.78, 1));
    t = settleSittings(t, [{ id: 's1', activeMs: 2 * MIN, ended: true }]);
    t = tallySitting(t, 's1', modelWith('n', 0.78, 1), modelWith('n', 0.9, 2));
    t = settleSittings(t, [{ id: 's1', activeMs: 2 * MIN, ended: true }]);
    const m = learningMetric(t);
    expect(m.learningMinutes).toBe(2);
    expect(m.gain).toBeCloseTo(0.4, 10);
  });

  it('counts the gain of a sitting the server no longer holds apart, as untimed', () => {
    let t = tallySitting(emptyTally(), 'gone', emptyModel(), modelWith('n', 0.78, 1));
    t = settleSittings(t, []);
    expect(learningMetric(t)).toMatchObject({ gain: 0, learningMinutes: 0, openSittings: 0 });
    expect(learningMetric(t).untimedGain).toBeCloseTo(0.28, 10);
  });

  it('forgets a counted sitting once the server no longer holds it, keeping its minutes', () => {
    let t = tallySitting(emptyTally(), 's1', emptyModel(), modelWith('n', 0.78, 1));
    t = settleSittings(t, [{ id: 's1', activeMs: 2 * MIN, ended: true }]);
    expect(t.counted).toEqual(['s1']);
    t = settleSittings(t, []);
    expect(t.counted).toEqual([]);
    expect(learningMetric(t).learningMinutes).toBe(2);
  });

  it('does not change the tally it is given', () => {
    const t = emptyTally();
    tallySitting(t, 's1', emptyModel(), modelWith('n', 0.78, 1));
    settleSittings(t, [{ id: 's1', activeMs: MIN, ended: true }]);
    expect(t).toEqual(emptyTally());
  });
});
