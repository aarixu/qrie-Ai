import { describe, expect, it } from 'vitest';
import { MODEL_VERSION, emptyConceptState, emptyModel, migrateModel } from '../src/index';

/** Overnight review #14: the v2 bump must not wipe a student's history. */
describe('migrateModel', () => {
  const v1 = () => {
    const { masteredAt: _m, coldWins: _c, ...old } = emptyConceptState('o1');
    return {
      version: 1,
      foldedThrough: { at: '2026-09-20T10:00:00Z', sessionId: 's1', seq: 4 },
      helpInFlight: null,
      states: { o1: { ...old, mastery: 0.71, unassistedMastery: 0.64, observations: 9 } },
    };
  };

  it('keeps every number a v1 model held and fills the fields it lacked', () => {
    const m = migrateModel(v1());
    expect(m.version).toBe(MODEL_VERSION);
    expect(m.states.o1.mastery).toBe(0.71);
    expect(m.states.o1.unassistedMastery).toBe(0.64);
    expect(m.states.o1.observations).toBe(9);
    expect(m.states.o1.masteredAt).toBeNull();
    expect(m.states.o1.coldWins).toEqual({});
    expect(m.foldedThrough).toEqual(v1().foldedThrough);
  });

  it('leaves a current model alone', () => {
    const current = { ...emptyModel(), states: { o1: { ...emptyConceptState('o1'), mastery: 0.9 } } };
    expect(migrateModel(current)).toBe(current);
  });

  it('never guesses at a newer or broken shape', () => {
    expect(migrateModel({ ...v1(), version: MODEL_VERSION + 1 })).toEqual(emptyModel());
    expect(migrateModel(null)).toEqual(emptyModel());
    expect(migrateModel({ version: 1 })).toEqual(emptyModel());
  });
});
