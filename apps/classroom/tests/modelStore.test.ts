import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyModel } from '@ai-tutor/learner-model';
import type { LearningSession, LedgerEvent } from '@ai-tutor/ledger';

/**
 * The map the model is folded against. Mocked rather than loaded, because this
 * file is about the STORE — that a fold happens where an event is recorded, and
 * that it happens once — not about the belief arithmetic, which
 * packages/learner-model tests against the real thing.
 */
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

const { loadModel, masteryFromModel, recordLocally } = await import('../src/lib/learnerModel');

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

  it('survives storage being unreadable rather than taking the class down', async () => {
    localStorage.setItem('ai-tutor:learner-model', 'not json');
    expect(() => loadModel()).not.toThrow();
    await expect(recordLocally(session, [answer])).resolves.toBeUndefined();
  });
});
