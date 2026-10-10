import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphIndex, emptyParams, type Probe } from '@ai-tutor/knowledge-graph';
import { MODEL_VERSION, emptyConceptState, emptyModel, type LearnerModel } from '@ai-tutor/learner-model';
import type { LedgerEvent } from '@ai-tutor/ledger';

/**
 * THE TUTOR READS THE SERVER'S MODEL (lam-one-brain Task 11, D03).
 *
 * At sign-in and at the start of a lesson the classroom reads what the brain
 * wrote about its learner (public.my_learner_model, 0109), takes it as its
 * base and folds on top only its own events the brain had not read. Its
 * next activity, its warm-up and decide() read the store, so they read the
 * merged model. Offline, or with the brain behind this device, it keeps its
 * own model and the class goes on.
 *
 * The supabase client, the graph context and the catalogue are mocked at the
 * module seam: no cloud, no env. The merge itself is the real one
 * (packages/lms-brain serverModel.ts) on the real library graph.
 */

const X = 'class8-mathematics-rational-numbers-define-rational-number';
const Y = 'class8-mathematics-rational-numbers-closure-addition';
const NOW = new Date('2026-10-10T10:00:00.000Z');
const PAST = '2026-10-05T10:00:00.000Z';

const rpc = vi.fn();
let configured = true;
let signedIn: { id: string } | null = { id: 'kid-1' };
let accountListener: ((a: { id: string } | null) => void) | null = null;

vi.mock('../src/lib/supabase', () => ({
  supabase: () => (configured ? { rpc } : null),
  accountFromStoredSession: async () => ({ known: true, account: signedIn }),
  onAccountChange: (cb: (a: { id: string } | null) => void) => {
    accountListener = cb;
    return () => {
      accountListener = null;
    };
  },
}));

const node = (id: string, title: string, topicRef: string) => ({
  id, klass: 8, subject: 'Mathematics', chapter: 'rational-numbers', title, outcome: id,
  prerequisites: [], difficulty: 1, topicRef,
});
const index = new GraphIndex({
  version: 1,
  nodes: [node(X, 'Define Rational Numbers', 'x/ch/define'), node(Y, 'Closure Under Addition', 'x/ch/closure')],
} as never);
const probe = (id: string, nodeId: string): Probe => ({
  id, nodeId, question: `Which of these is ${id}?`, options: ['one', 'two', 'three'], correctIndex: 0, misconceptions: ['', 'm1', 'm2'],
});

vi.mock('../src/lib/graphContext', () => ({
  currentIndex: () => index,
  currentBank: () => ({ version: 1, probes: [probe('x-1', X), probe('y-1', Y)] }),
  currentParams: () => emptyParams(),
}));
vi.mock('../src/lib/content', () => ({
  fetchCatalog: async () => [
    { id: 'lesson-define', title: 'Define', class: 8, subject: 'Maths', path: '', topicRef: 'x/ch/define' },
    { id: 'lesson-closure', title: 'Closure', class: 8, subject: 'Maths', path: '', topicRef: 'x/ch/closure' },
  ],
}));
vi.mock('../src/lib/quiz', () => ({ buildQuiz: () => [{}] }));

const { learnerModelStore, loadModel, readServerWith, recordLocally, refreshFromServer, settled } = await import(
  '../src/lib/learnerModel'
);
const { readServerModel, startServerModel } = await import('../src/lib/brainModel');
const { beforeNext } = await import('../src/lib/nextStep');
const { warmUpFor } = await import('../src/lib/warmUp');
const { openSession, logAnswer, ledgerOutbox, resetLedgerOutbox } = await import('../src/stores/ledger');
const { rememberSent, resetSentLog, sentFor } = await import('../src/lib/sentLog');

/** A concept_state row as my_learner_model hands it back. */
const row = (outcome: string, over: Record<string, unknown> = {}) => ({
  outcome_id: outcome, mastery: 0.5, unassisted_mastery: 0.5, assisted_performance: 0.5, observations: 0,
  answer_observations: 0, unassisted_observations: 0, taught_count: 0, doubt_count: 0, last_practiced_at: null,
  last_unassisted_success_at: null, mastered_at: null, cold_wins: {}, box: null, last_exposed_at: null,
  last_retrieved_at: null, memory_strength: 0, next_review_at: null, retrieval_count: 0, retrieval_accuracy: 0,
  misconceptions: {}, updated_at: PAST,
  ...over,
});

/** Homework the brain folded: X missed cold twice and due for review. */
const missedXOnHomework = row(X, {
  mastery: 0.2, unassisted_mastery: 0.2, observations: 2, answer_observations: 2, unassisted_observations: 2,
  last_practiced_at: PAST, box: 0, next_review_at: '2026-10-06T10:00:00+00:00',
});

const server = (states: Record<string, unknown>[], foldedThrough: unknown = { at: '2026-10-09T10:00:00.000+00:00', sessionId: 'hw', seq: 3 }) =>
  ({ data: { version: MODEL_VERSION, foldedThrough, states }, error: null });

const nextStep = () => beforeNext({ index, done: null, next: null, now: NOW });

beforeEach(() => {
  localStorage.clear();
  resetLedgerOutbox();
  resetSentLog();
  learnerModelStore.set(emptyModel());
  configured = true;
  signedIn = { id: 'kid-1' };
  rpc.mockReset().mockResolvedValue(server([missedXOnHomework]));
  // What main.tsx's startServerModel wires in.
  readServerWith(readServerModel);
});

describe('a learner whose server model says remedial on X (from homework)', () => {
  it('gets X first in the tutor: the next activity, and the warm-up', async () => {
    // Before: this device has never seen X, so the tutor has nothing to fix.
    expect(await nextStep()).toBeNull();

    expect(await refreshFromServer()).toBe('taken');
    expect(rpc).toHaveBeenCalledWith('my_learner_model');

    expect(await nextStep()).toMatchObject({ kind: 'remedial', titles: ['Define Rational Numbers'], route: '/quiz/lesson-define' });
    const warm = await warmUpFor(undefined, [], NOW);
    expect(warm[0]).toMatchObject({ nodeId: X, id: 'x-1' });
  });

  it('GUARD: flipped to right answers on the server, X is not put first', async () => {
    rpc.mockResolvedValue(
      server([row(X, { mastery: 0.9, unassisted_mastery: 0.9, observations: 2, answer_observations: 2, unassisted_observations: 2 })]),
    );
    expect(await refreshFromServer()).toBe('taken');
    expect(await nextStep()).toBeNull();
  });

  it('is read at sign-in', async () => {
    const stop = startServerModel();
    accountListener!({ id: 'kid-1' });
    await vi.waitFor(() => expect(loadModel().states[X]?.unassistedObservations).toBe(2));
    stop();
  });

  it('is not read by a screen rendered without the app around it', async () => {
    readServerWith(null);
    expect(await refreshFromServer()).toBe('unavailable');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('with no network the tutor still works', () => {
  const own: LearnerModel = {
    ...emptyModel(),
    states: { [Y]: { ...emptyConceptState(Y), box: 1, nextReviewAt: PAST, observations: 1, answerObservations: 1 } },
  };

  it('keeps its own model when the read fails, and decides from it', async () => {
    learnerModelStore.set(own);
    rpc.mockRejectedValue(new Error('Failed to fetch'));
    expect(await refreshFromServer()).toBe('unavailable');
    expect(loadModel()).toEqual(own);
    expect(await nextStep()).toMatchObject({ kind: 'review', titles: ['Closure Under Addition'] });
  });

  it('keeps it when the cloud is not configured or nobody is signed in', async () => {
    learnerModelStore.set(own);
    configured = false;
    expect(await refreshFromServer()).toBe('unavailable');
    configured = true;
    signedIn = null;
    expect(await refreshFromServer()).toBe('unavailable');
    expect(rpc).not.toHaveBeenCalled();
    expect(loadModel()).toEqual(own);
  });

  it('does not hold a lesson up waiting for a server that does not answer', async () => {
    rpc.mockReturnValue(new Promise(() => undefined));
    expect(await refreshFromServer({ waitMs: 20 })).toBe('waiting');
  });

  it('still folds what happens in class', async () => {
    rpc.mockRejectedValue(new Error('Failed to fetch'));
    await refreshFromServer();
    const s = { id: 'offline-sitting', source: 'class' as const, startedAt: NOW.toISOString() };
    await recordLocally(s, [answerOn(s.id, 0, X, true)]);
    expect(loadModel().states[X].observations).toBe(1);
  });
});

describe('the server and this device together', () => {
  it('does not take a server model that is behind this device', async () => {
    const own: LearnerModel = {
      ...emptyModel(),
      states: { [X]: { ...emptyConceptState(X), observations: 5, answerObservations: 5 } },
    };
    learnerModelStore.set(own);
    expect(await refreshFromServer()).toBe('kept');
    expect(loadModel()).toEqual(own);
  });

  it('folds this device’s unsent answers on top, once', async () => {
    openSession({ source: 'class', topicRef: 'x/ch/define' });
    logAnswer({ surface: 'tap', outcomeIds: [X], correct: false, chosenIndex: 1, ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0 });
    // The fold of that answer may still be on its way when the server's model lands.
    expect(await refreshFromServer()).toBe('taken');
    await settled();
    expect(loadModel().states[X].unassistedObservations).toBe(3);
    expect(ledgerOutbox.get().pending).toHaveLength(2);
  });

  it('folds what the server took after the brain last ran, and lets go of what the brain has read', async () => {
    const read = answerOn('hw', 2, X, false);
    const late = answerOn('later', 0, X, false);
    rememberSent('kid-1', [
      { event: read, receivedAt: '2026-10-09T09:00:00.000Z' },
      { event: late, receivedAt: '2026-10-09T11:00:00.000Z' },
    ]);
    expect(await refreshFromServer()).toBe('taken');
    expect(loadModel().states[X].unassistedObservations).toBe(3);
    expect(sentFor('kid-1').map((e) => e.event.id)).toEqual([late.id]);
  });

  it('takes the server’s model as the rebuild a fold asked for (Task 8’s flag)', async () => {
    const { rebuildWanted } = await import('../src/lib/learnerModel');
    localStorage.setItem('ai-tutor:learner-model-rebuild', '1');
    openSession({ source: 'class', topicRef: 'x/ch/closure' });
    logAnswer({ surface: 'tap', outcomeIds: [Y], correct: true, chosenIndex: 0, ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0 });
    await settled();
    expect(rebuildWanted()).toBe(false);
    expect(loadModel().states[X].unassistedObservations).toBe(2);
    expect(loadModel().states[Y].observations).toBe(1);
  });

  it('builds on nothing a server of another model version wrote', async () => {
    rpc.mockResolvedValue({ data: { version: MODEL_VERSION - 1, foldedThrough: null, states: [missedXOnHomework] }, error: null });
    expect(await refreshFromServer()).toBe('other-version');
    expect(loadModel().states[X]).toBeUndefined();
  });
});

function answerOn(sessionId: string, seq: number, outcome: string, correct: boolean): LedgerEvent {
  return {
    id: crypto.randomUUID(), sessionId, seq, at: NOW.toISOString(), kind: 'answered', source: 'class', surface: 'tap',
    outcomeIds: [outcome],
    payload: { correct, chosenIndex: correct ? 0 : 1, ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0 },
  } as unknown as LedgerEvent;
}
