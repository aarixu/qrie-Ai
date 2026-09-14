import { describe, expect, it } from 'vitest';
import { emptyConceptState, emptyModel, evidenceSet, masteryView } from '../src/index';

describe('masteryView', () => {
  it('projects an empty model to an empty map', () => {
    expect(masteryView(emptyModel())).toEqual({});
  });

  it('projects each outcome to its mastery and nothing else', () => {
    const model = emptyModel();
    model.states.a = { ...emptyConceptState('a'), mastery: 0.78, unassistedMastery: 0.5 };
    model.states.b = { ...emptyConceptState('b'), mastery: 0.12 };
    expect(masteryView(model)).toEqual({ a: 0.78, b: 0.12 });
  });
});

describe('evidenceSet', () => {
  /**
   * The gate exists so a node nobody examined cannot become a weakness by
   * arithmetic alone — the 0.46 defect, which shipped a twelve-step remedial
   * plan for a flawless student.
   */
  it('holds only outcomes something has actually touched', () => {
    const model = emptyModel();
    model.states.seen = { ...emptyConceptState('seen'), observations: 1 };
    model.states.untouched = emptyConceptState('untouched');
    expect([...evidenceSet(model)]).toEqual(['seen']);
  });
});

describe('emptyConceptState', () => {
  it('starts at the prior, unobserved, and with no dates', () => {
    const s = emptyConceptState('x');
    expect(s).toMatchObject({
      outcomeId: 'x',
      mastery: 0.5,
      unassistedMastery: 0.5,
      observations: 0,
      unassistedObservations: 0,
      taughtCount: 0,
      lastPracticedAt: null,
      lastUnassistedSuccessAt: null,
    });
  });
});
