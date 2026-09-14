import { describe, expect, it } from 'vitest';
import {
  emptyConceptState,
  emptyModel,
  gainPerLearningMinute,
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

  it('counts a real cold gain', () => {
    expect(unassistedGain(modelWith('n', 0.5, 1), modelWith('n', 0.8, 2))).toBeCloseTo(0.3);
  });

  it('counts a loss as a loss, because a number that can only rise is not a measurement', () => {
    expect(unassistedGain(modelWith('n', 0.8, 1), modelWith('n', 0.5, 2))).toBeCloseTo(-0.3);
  });

  it('counts an outcome that did not exist before from its own starting point', () => {
    // First time anyone asked about it. The gain is measured from where the
    // model now says it is, not from the prior it was never at.
    expect(unassistedGain(emptyModel(), modelWith('fresh', 0.78, 1))).toBe(0);
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
