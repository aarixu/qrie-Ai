import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyModel, foldHistory, type FoldSession } from '@ai-tutor/learner-model';
import type { LearningSession, LedgerEvent } from '@ai-tutor/ledger';

/**
 * THE PHONE NEVER LOSES LATE OR OUT-OF-ORDER EVIDENCE (lam-one-brain Task 8).
 *
 * The device's model store folds each event as it is recorded. Before Task 8 a
 * sitting whose phone clock was behind the last one was skipped by the cursor
 * (truth test L03), and an event behind the cursor vanished with nothing said
 * (L04). Now the store places a sitting where it arrived, and when the fold
 * reports `needsRebuild` it folds its ledger again in order: the server's rows
 * (RLS: the learner's own) and the outbox's unsent events.
 *
 * The supabase client and the graph context are mocked at the module seam: no
 * cloud, no env, no map on disk.
 */

const sessionsResult = { data: [] as unknown, error: null as unknown };
const eventsResult = { data: [] as unknown, error: null as unknown };

const chain = (result: { data: unknown; error: unknown }) => {
  const q = {
    select: () => q,
    order: () => q,
    limit: () => Promise.resolve(result),
  };
  return q;
};

vi.mock('../src/lib/supabase', () => ({
  supabase: () => ({
    from: (table: string) => chain(table === 'learning_session' ? sessionsResult : eventsResult),
  }),
}));

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

const { learnerModelStore, loadModel, rebuildWanted, recordLocally, unfoldedCount } = await import(
  '../src/lib/learnerModel'
);
const { GraphIndex, emptyParams } = await import('@ai-tutor/knowledge-graph');
const { resetLedgerOutbox } = await import('../src/stores/ledger');

const index = new GraphIndex({
  version: 1,
  nodes: [
    {
      id: 'n1',
      klass: 10,
      subject: 'Science',
      chapter: 'ch1',
      title: 'n1',
      outcome: 'can do n1',
      prerequisites: [],
      difficulty: 2,
      topicRef: 'class10-science/ch1/t1',
    },
  ],
} as never);

const sitting = (id: string, startedAt: string): LearningSession => ({ id, source: 'class', startedAt });

const answer = (s: LearningSession, seq: number, correct: boolean): LedgerEvent =>
  ({
    id: `${s.id}-e${seq}`,
    sessionId: s.id,
    seq,
    at: s.startedAt,
    kind: 'answered',
    source: 'class',
    surface: 'tap',
    outcomeIds: ['n1'],
    payload: { correct, ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0, chosenIndex: correct ? 0 : 2 },
  }) as unknown as LedgerEvent;

/** A server row, as PostgREST hands it back. */
const rowOf = (e: LedgerEvent) => ({
  id: e.id,
  session_id: e.sessionId,
  seq: e.seq,
  at: e.at,
  kind: e.kind,
  source: e.source,
  surface: e.surface,
  outcome_ids: e.outcomeIds,
  topic_ref: null,
  payload: e.payload,
});

const inOrder = (sittings: LearningSession[], events: LedgerEvent[]) =>
  foldHistory(
    sittings.map((s): FoldSession => ({ id: s.id, startedAt: s.startedAt })),
    events,
    index,
    emptyParams(),
  ).model;

const S1 = sitting('s1', '2026-09-14T10:00:00.000Z');

beforeEach(() => {
  localStorage.clear();
  resetLedgerOutbox();
  learnerModelStore.set(emptyModel());
  sessionsResult.data = [];
  eventsResult.data = [];
  sessionsResult.error = null;
  eventsResult.error = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a sitting whose phone clock is behind the last one', () => {
  it('is counted, not skipped', async () => {
    const today = sitting('s2', '2026-09-15T10:00:00.000Z');
    const setBack = sitting('s0', '2026-08-15T10:00:00.000Z');
    await recordLocally(today, [answer(today, 0, true)]);
    await recordLocally(setBack, [answer(setBack, 0, false)]);
    await recordLocally(setBack, [answer(setBack, 1, false)]);
    expect(loadModel().states.n1.observations).toBe(3);
    expect(rebuildWanted()).toBe(false);
  });
});

describe('an answer that arrives after its successor', () => {
  const e0 = answer(S1, 0, true);
  const e1 = answer(S1, 1, false);
  const e2 = answer(S1, 2, true);

  it('is folded, and the store then folds its ledger again in order', async () => {
    sessionsResult.data = [{ id: S1.id, started_at: S1.startedAt }];
    eventsResult.data = [e0, e1, e2].map(rowOf);
    await recordLocally(S1, [e0]);
    await recordLocally(S1, [e2]);
    await recordLocally(S1, [e1]);
    expect(loadModel().states.n1.observations).toBe(3);
    expect(loadModel()).toEqual(inOrder([S1], [e0, e1, e2]));
    expect(rebuildWanted()).toBe(false);
  });

  it('takes the outbox events the server has not had yet as part of the ledger', async () => {
    sessionsResult.data = [{ id: S1.id, started_at: S1.startedAt }];
    eventsResult.data = [e0, e2].map(rowOf);
    localStorage.setItem(
      'ai-tutor:ledger-outbox',
      JSON.stringify({ session: S1, nextSeq: 3, pending: [e1], dropped: 0, rejected: 0, orphaned: 0, ownerId: null }),
    );
    await recordLocally(S1, [e0]);
    await recordLocally(S1, [e2]);
    await recordLocally(S1, [e1]);
    expect(loadModel()).toEqual(inOrder([S1], [e0, e1, e2]));
    expect(rebuildWanted()).toBe(false);
  });

  it('keeps asking for the rebuild while the ledger comes back short, and never takes less than it holds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T10:00:00.000Z'));
    sessionsResult.data = [{ id: S1.id, started_at: S1.startedAt }];
    eventsResult.data = [e0].map(rowOf);
    await recordLocally(S1, [e0]);
    await recordLocally(S1, [e2]);
    await recordLocally(S1, [e1]);
    // Folded, out of order, and the short ledger was not taken over it.
    expect(loadModel().states.n1.observations).toBe(3);
    expect(rebuildWanted()).toBe(true);

    // The server catches up; the next answer, after the wait, brings the rebuild.
    eventsResult.data = [e0, e1, e2, answer(S1, 3, true)].map(rowOf);
    vi.setSystemTime(new Date('2026-10-08T10:11:00.000Z'));
    await recordLocally(S1, [answer(S1, 3, true)]);
    expect(rebuildWanted()).toBe(false);
    expect(loadModel()).toEqual(inOrder([S1], [e0, e1, e2, answer(S1, 3, true)]));
    expect(unfoldedCount()).toBe(0);
  });
});

describe('a rebuild taken while a fold waited', () => {
  /**
   * The version bring-forward rebuilds from the server, and the event being
   * folded can already be there. Placed where it arrived, it is ahead of the
   * rebuilt cursor when its sitting is not the last the rebuild folded, so
   * without the rebuild's ids it would be counted twice.
   */
  it('does not count an event the rebuild already folded', async () => {
    const S2 = sitting('s2', '2026-09-15T10:00:00.000Z');
    const a = answer(S1, 0, true);
    const b = answer(S2, 0, true);
    sessionsResult.data = [S1, S2].map((s) => ({ id: s.id, started_at: s.startedAt }));
    eventsResult.data = [a, b].map(rowOf);
    const { emptyConceptState } = await import('@ai-tutor/learner-model');
    learnerModelStore.set({
      version: 3,
      foldedThrough: null,
      helpInFlight: null,
      states: { n1: { ...emptyConceptState('n1'), observations: 1 } },
    } as never);
    await recordLocally(S1, [a]);
    expect(loadModel().states.n1.observations).toBe(2);
    expect(loadModel()).toEqual(inOrder([S1, S2], [a, b]));
  });
});
