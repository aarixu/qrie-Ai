import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyModel } from '@ai-tutor/learner-model';
import type { LearningSession, LedgerEvent } from '@ai-tutor/ledger';

/**
 * The map the model is folded against. Mocked rather than loaded, because this
 * file is about the STORE — that a fold happens where an event is recorded, and
 * that it happens once — not about the belief arithmetic, which
 * packages/learner-model tests against the real thing.
 */
/** No cloud: the ledger rebuild cannot run here, and must never reach a live project. */
vi.mock('../src/lib/supabase', () => ({ supabase: () => null }));

vi.mock('../src/lib/graphContext', async () => {
  const kg = await import('@ai-tutor/knowledge-graph');
  const node = (id: string, prerequisites: string[]) => ({
    id,
    klass: 10,
    subject: 'Science',
    chapter: 'ch1',
    title: id,
    outcome: `can do ${id}`,
    prerequisites,
    difficulty: 2,
    topicRef: 'class10-science/ch1/t1',
  });
  const index = new kg.GraphIndex({ version: 1, nodes: [node('n1', [])] } as never);
  return { currentIndex: () => index, currentParams: () => kg.emptyParams() };
});

const { learnerModelStore, loadModel, masteryFromModel, recordLocally } = await import(
  '../src/lib/learnerModel'
);

const session: LearningSession = {
  id: 's1',
  source: 'quiz',
  startedAt: '2026-09-14T10:00:00.000Z',
};

const answer = {
  id: 'e1',
  sessionId: 's1',
  seq: 0,
  at: '2026-09-14T10:00:00.000Z',
  kind: 'answered',
  source: 'quiz',
  surface: 'tap',
  outcomeIds: ['n1'],
  payload: {
    correct: true,
    ms: 3000,
    attempt: 1,
    assistanceRung: 0,
    hintsShown: 0,
    chosenIndex: 0,
  },
} as unknown as LedgerEvent;

describe('the model as the store', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty rather than throwing', () => {
    expect(loadModel()).toEqual(emptyModel());
    expect(masteryFromModel()).toEqual({});
  });

  it('an answer folded locally becomes mastery', async () => {
    await recordLocally(session, [answer]);
    expect(masteryFromModel().n1).toBeGreaterThan(0.5);
    expect(loadModel().states.n1.unassistedObservations).toBe(1);
  });

  /**
   * The reason this is not an ordinary preference blob: a model is an
   * ACCUMULATING RECORD. The cursor is what makes a re-fold harmless — a
   * retried drain, a reload mid-class, a rebuild.
   */
  it('folding the same event twice changes nothing', async () => {
    await recordLocally(session, [answer]);
    const once = masteryFromModel().n1;
    await recordLocally(session, [answer]);
    expect(masteryFromModel().n1).toBe(once);
    expect(loadModel().states.n1.unassistedObservations).toBe(1);
  });

  /**
   * B6. Every reader of `masteryFromModel` makes a decision — the plan's gaps,
   * the doubt tutor's secure/shaky marks, the planner's "they hold securely"
   * line — so it hands them what the student did ALONE. An outcome answered
   * right only with a hint is unknown there, never secure.
   */
  it('hands decisions unassisted belief, and nothing for an outcome only answered with help', async () => {
    // The store caches in memory; an earlier test's answer must not be here.
    learnerModelStore.set(emptyModel());
    const later: LearningSession = { id: 's2', source: 'quiz', startedAt: '2026-09-15T10:00:00.000Z' };
    const hinted = {
      ...answer,
      id: 'e2',
      sessionId: 's2',
      payload: { ...(answer.payload as object), assistanceRung: 3, hintsShown: 1 },
    } as unknown as LedgerEvent;
    await recordLocally(later, [hinted]);
    expect(loadModel().states.n1.mastery).toBeGreaterThan(0.5);
    expect(masteryFromModel().n1).toBeUndefined();

    await recordLocally(later, [{ ...answer, id: 'e3', sessionId: 's2', seq: 1 } as LedgerEvent]);
    expect(masteryFromModel().n1).toBe(loadModel().states.n1.unassistedMastery);
  });

  it('survives storage being unreadable rather than taking the class down', async () => {
    localStorage.setItem('ai-tutor:learner-model', 'not json');
    expect(() => loadModel()).not.toThrow();
    await expect(recordLocally(session, [answer])).resolves.toBeUndefined();
  });
});

/**
 * THE v2 BUMP MUST NOT WIPE A STUDENT (overnight review #14).
 *
 * No cloud here (the supabase client is absent in tests), so the rebuild
 * cannot run and the stored v1 model is migrated in place: its history stays,
 * and the new answer is folded on top of it.
 */
describe('a stored model from an older version', () => {
  beforeEach(() => localStorage.clear());

  it('keeps its history when the next answer is folded', async () => {
    const { emptyConceptState } = await import('@ai-tutor/learner-model');
    const { masteredAt: _m, coldWins: _c, ...old } = emptyConceptState('n2');
    learnerModelStore.set({
      version: 1,
      foldedThrough: null,
      helpInFlight: null,
      states: { n2: { ...old, mastery: 0.82, unassistedMastery: 0.8, observations: 6 } },
    } as never);
    await recordLocally(session, [answer]);
    const model = loadModel();
    expect(model.version).toBe(2);
    expect(model.states.n2?.unassistedMastery).toBe(0.8);
    expect(model.states.n2?.observations).toBe(6);
    expect(model.states.n1.unassistedObservations).toBe(1);
  });
});
