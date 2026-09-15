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
  it('holds only outcomes an ANSWER has spoken about', () => {
    const model = emptyModel();
    model.states.answered = { ...emptyConceptState('answered'), observations: 1, answerObservations: 1 };
    model.states.untouched = emptyConceptState('untouched');
    expect([...evidenceSet(model)]).toEqual(['answered']);
  });

  /**
   * packages/diagnostic/src/session.ts states the rule: attendance raises
   * belief and so can never create a gap on its own, because that lets the
   * difficulty prior back in through the side door. Measured on the real map,
   * one taught event on a difficulty-4 node was enough to return it as a
   * remedial step at 0.46 — a prior nothing had measured.
   */
  it('refuses an outcome that has only been taught', () => {
    const model = emptyModel();
    model.states.satThrough = { ...emptyConceptState('satThrough'), observations: 3, taughtCount: 3 };
    expect([...evidenceSet(model)]).toEqual([]);
  });

  it('accepts a raised hand, because a hand LOWERS belief', () => {
    const model = emptyModel();
    model.states.stopped = { ...emptyConceptState('stopped'), doubtCount: 1 };
    expect([...evidenceSet(model)]).toEqual(['stopped']);
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
