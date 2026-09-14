import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { emptyModel, foldSession } from '../src/index';

/**
 * Two nodes, `b` resting on `a` — the smallest graph with an edge in it.
 * `GraphIndex` takes a `KnowledgeGraph` (`{ version, nodes }`), not an array.
 */
const node = (id: string, prerequisites: string[]) => ({
  id,
  klass: 10,
  subject: 'Science',
  chapter: 'ch1',
  title: id.toUpperCase(),
  outcome: `can do ${id}`,
  prerequisites,
  difficulty: 2,
  topicRef: 'class10-science/ch1/t1',
});

const index = new GraphIndex({ version: 1, nodes: [node('a', []), node('b', ['a'])] } as never);
const params = emptyParams();

let seq = 0;
const ev = (kind: string, outcomeIds: string[], payload: unknown): LedgerEvent =>
  ({
    id: `e${seq}`,
    sessionId: 's1',
    seq: seq++,
    at: '2026-09-14T10:00:00.000Z',
    kind,
    source: 'quiz',
    surface: 'tap',
    outcomeIds,
    payload,
  }) as unknown as LedgerEvent;

const answered = (rung: number, correct = true) =>
  ev('answered', ['b'], {
    correct,
    ms: 4000,
    attempt: 1,
    assistanceRung: rung,
    hintsShown: rung > 0 ? 1 : 0,
    chosenIndex: 0,
  });

describe('foldSession', () => {
  it('records an unassisted right answer as unassisted mastery', () => {
    seq = 0;
    const m = foldSession(emptyModel(), [answered(0)], index, params);
    expect(m.states.b.unassistedObservations).toBe(1);
    expect(m.states.b.unassistedMastery).toBeGreaterThan(0.5);
    expect(m.states.b.lastUnassistedSuccessAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('refuses a hinted right answer as unassisted evidence', () => {
    seq = 0;
    const m = foldSession(emptyModel(), [answered(3)], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
    expect(m.states.b.unassistedMastery).toBe(0.5);
    // It is still evidence, just not THAT evidence.
    expect(m.states.b.mastery).toBeGreaterThan(0.5);
    expect(m.states.b.assistedPerformance).toBeGreaterThan(0.5);
  });

  /**
   * The whole reason the reducer takes a session rather than an event: the
   * `helped` row sits BEFORE the answer in seq order, and the answer's own
   * recorded rung is a ref that a remount can lose.
   */
  it('uses a helped row the answer forgot about', () => {
    seq = 0;
    const helped = ev('helped', ['b'], { rung: 4, requested: false });
    const m = foldSession(emptyModel(), [helped, answered(0)], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
  });

  it('ignores a helped row that came after the answer', () => {
    seq = 0;
    const first = answered(0);
    const helped = ev('helped', ['b'], { rung: 4, requested: false });
    const m = foldSession(emptyModel(), [first, helped], index, params);
    expect(m.states.b.unassistedObservations).toBe(1);
  });

  it('moves the prerequisite too, because a right answer speaks about what it rests on', () => {
    seq = 0;
    const m = foldSession(emptyModel(), [answered(0)], index, params);
    expect(m.states.a.mastery).toBeGreaterThan(0.5);
    // Propagated belief is NOT unassisted evidence about `a` — nobody asked.
    expect(m.states.a.unassistedObservations).toBe(0);
  });

  it('saturates attendance instead of counting it twice', () => {
    seq = 0;
    const taught = () => ev('taught', ['a'], { beatId: 'x' });
    const once = foldSession(emptyModel(), [taught()], index, params);
    const twice = foldSession(once, [taught()], index, params);
    expect(twice.states.a.taughtCount).toBe(2);
    expect(twice.states.a.mastery).toBeGreaterThan(once.states.a.mastery);
    // The second viewing is worth less than the first.
    const firstGain = once.states.a.mastery - 0.5;
    const secondGain = twice.states.a.mastery - once.states.a.mastery;
    expect(secondGain).toBeLessThan(firstGain);
  });

  it('carries the cursor forward and refuses to fold the same event twice', () => {
    seq = 0;
    const one = answered(0);
    const first = foldSession(emptyModel(), [one], index, params);
    const again = foldSession(first, [one], index, params);
    expect(again.states.b.observations).toBe(first.states.b.observations);
    expect(again.foldedThrough).toEqual({ at: '2026-09-14T10:00:00.000Z', seq: 0 });
  });

  it('is the same state for the same events, every time', () => {
    seq = 0;
    const events = [answered(0)];
    expect(foldSession(emptyModel(), events, index, params)).toEqual(
      foldSession(emptyModel(), events, index, params),
    );
  });

  /**
   * A SKIP IS NOT "THEY CHOSE OPTION 0". `applyEvidence` reads a null
   * chosenIndex as a skip — a soft "probably not" that moves the node alone and
   * deliberately does not propagate. Coercing it to 0 would turn every skipped
   * question into a confident wrong answer and spread that across the region.
   */
  it('keeps a skip a skip', () => {
    seq = 0;
    const skip = ev('answered', ['b'], {
      correct: false,
      ms: 2000,
      attempt: 1,
      assistanceRung: 0,
      hintsShown: 0,
      chosenIndex: null,
    });
    const m = foldSession(emptyModel(), [skip], index, params);
    expect(m.states.b.mastery).toBeLessThan(0.5);
    // A skip says nothing about anything else, so `a` is never even created.
    expect(m.states.a).toBeUndefined();
  });

  /**
   * IF THIS EVER PASSES WITH THE ORDER SHUFFLED, `seq` IS DECORATIVE. The
   * counters replay in packages/ledger commutes and says so in its header; the
   * learner model must not.
   */
  it('is NOT order-independent within a session', () => {
    seq = 0;
    const helped = ev('helped', ['b'], { rung: 4, requested: false });
    const ans = answered(0);
    const inOrder = foldSession(emptyModel(), [helped, ans], index, params);
    const reversed = foldSession(emptyModel(), [ans, helped], index, params);
    expect(inOrder.states.b.unassistedObservations).not.toBe(
      reversed.states.b.unassistedObservations,
    );
  });
});
