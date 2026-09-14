import { describe, expect, it } from 'vitest';
import { chooseAsk, emptyConceptState, emptyModel, type ConceptState } from '../src/index';

const withStates = (...states: Array<Partial<ConceptState> & { outcomeId: string }>) => {
  const model = emptyModel();
  for (const s of states) model.states[s.outcomeId] = { ...emptyConceptState(s.outcomeId), ...s };
  return model;
};

describe('chooseAsk', () => {
  it('asks about the outcome we have most reason to doubt', () => {
    const model = withStates(
      { outcomeId: 'strong', unassistedMastery: 0.9, unassistedObservations: 3 },
      { outcomeId: 'weak', unassistedMastery: 0.3, unassistedObservations: 2 },
    );
    expect(chooseAsk(model, ['strong', 'weak']).outcomeId).toBe('weak');
  });

  /**
   * A low unassistedMastery with no unassisted observations behind it is the
   * PRIOR, not a finding. Treating it as a weakness is the 0.46 defect — a
   * difficulty prior read as a measurement, which shipped a twelve-step
   * remedial plan for a student who got everything right.
   */
  it('does not mistake a prior for a weakness', () => {
    const model = withStates(
      { outcomeId: 'measured', unassistedMastery: 0.6, unassistedObservations: 4 },
      { outcomeId: 'never-asked', unassistedMastery: 0.5, unassistedObservations: 0 },
    );
    expect(chooseAsk(model, ['measured', 'never-asked']).outcomeId).toBe('measured');
  });

  it('falls back to where we know least when nothing has been asked cold', () => {
    const model = withStates(
      { outcomeId: 'seen-a-lot', observations: 9 },
      { outcomeId: 'barely-seen', observations: 1 },
    );
    expect(chooseAsk(model, ['seen-a-lot', 'barely-seen']).outcomeId).toBe('barely-seen');
  });

  it('takes an outcome it has never heard of over one it has', () => {
    const model = withStates({ outcomeId: 'known', observations: 2 });
    expect(chooseAsk(model, ['known', 'brand-new']).outcomeId).toBe('brand-new');
  });

  it('opens cold when there is nothing against them', () => {
    const model = withStates({ outcomeId: 'x', unassistedMastery: 0.8, unassistedObservations: 2 });
    expect(chooseAsk(model, ['x']).rung).toBe(0);
  });

  it('opens with a hint when they have already failed this cold', () => {
    const model = withStates({ outcomeId: 'x', unassistedMastery: 0.2, unassistedObservations: 2 });
    expect(chooseAsk(model, ['x']).rung).toBe(1);
  });

  it('opens cold on an outcome nobody has ever asked about', () => {
    expect(chooseAsk(emptyModel(), ['fresh']).rung).toBe(0);
  });

  it('says why, for the ledger and never for the student', () => {
    const model = withStates({ outcomeId: 'x', unassistedMastery: 0.2, unassistedObservations: 2 });
    expect(chooseAsk(model, ['x']).because).toMatch(/unassisted/i);
  });

  it('never wanders off the beat it was given', () => {
    // A class that teaches something other than what it said it would is a
    // worse class, whatever the model wants to know.
    const model = withStates({ outcomeId: 'elsewhere', unassistedMastery: 0.01, unassistedObservations: 9 });
    expect(chooseAsk(model, ['a', 'b']).outcomeId).toMatch(/^(a|b)$/);
  });

  it('refuses a beat with nothing to check rather than inventing one', () => {
    expect(() => chooseAsk(emptyModel(), [])).toThrow(/candidate/i);
  });
});
