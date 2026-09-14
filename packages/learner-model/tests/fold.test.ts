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

const S1 = { id: 's1', startedAt: '2026-09-14T10:00:00.000Z' };
const S2 = { id: 's2', startedAt: '2026-09-15T10:00:00.000Z' };

let seq = 0;
const ev = (kind: string, outcomeIds: string[], payload: unknown, at?: string): LedgerEvent =>
  ({
    id: `e${seq}`,
    sessionId: 's1',
    seq: seq++,
    at: at ?? '2026-09-14T10:00:00.000Z',
    kind,
    source: 'quiz',
    surface: 'tap',
    outcomeIds,
    payload,
  }) as unknown as LedgerEvent;

const answered = (rung: number, correct = true, ids = ['b'], beatId?: string) =>
  ev('answered', ids, {
    correct,
    ms: 4000,
    attempt: 1,
    assistanceRung: rung,
    hintsShown: rung > 0 ? 1 : 0,
    chosenIndex: 0,
    ...(beatId ? { beatId } : {}),
  });

const helped = (rung: number, ids = ['b'], beatId?: string) =>
  ev('helped', ids, { rung, requested: false, ...(beatId ? { beatId } : {}) });

describe('foldSession', () => {
  it('records an unassisted right answer as unassisted mastery', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [answered(0)], index, params);
    expect(m.states.b.unassistedObservations).toBe(1);
    expect(m.states.b.unassistedMastery).toBeGreaterThan(0.5);
    expect(m.states.b.lastUnassistedSuccessAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('refuses a hinted right answer as unassisted evidence', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [answered(3)], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
    expect(m.states.b.unassistedMastery).toBe(0.5);
    // It is still evidence, just not THAT evidence.
    expect(m.states.b.mastery).toBeGreaterThan(0.5);
    expect(m.states.b.assistedPerformance).toBeGreaterThan(0.5);
  });

  it('uses a helped row the answer forgot about', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [helped(4), answered(0)], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
  });

  it('ignores a helped row that came after the answer', () => {
    seq = 0;
    const first = answered(0);
    const m = foldSession(emptyModel(), S1, [first, helped(4)], index, params);
    expect(m.states.b.unassistedObservations).toBe(1);
  });

  /**
   * THE DEVICE FOLDS ONE EVENT AT A TIME, as the class happens. Help held in a
   * local was invisible to the next call, and the answer was then scored as
   * unassisted — manufacturing mastery a child does not have, which is the one
   * error `deriveRung` says nothing downstream can correct.
   */
  it('remembers help across separate fold calls in one session', () => {
    seq = 0;
    const h = helped(5, ['b'], 'B3');
    const a = answered(0, true, ['b'], 'B3');
    const afterHelp = foldSession(emptyModel(), S1, [h], index, params);
    const afterAnswer = foldSession(afterHelp, S1, [a], index, params);
    expect(afterAnswer.states.b.unassistedObservations).toBe(0);
  });

  it('forgets that help when a different sitting begins', () => {
    seq = 0;
    const afterHelp = foldSession(emptyModel(), S1, [helped(5, ['b'], 'B3')], index, params);
    const next = foldSession(afterHelp, S2, [answered(0, true, ['b'], 'B3')], index, params);
    expect(next.states.b.unassistedObservations).toBe(1);
  });

  it('moves the prerequisite too, because a right answer speaks about what it rests on', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [answered(0)], index, params);
    expect(m.states.a.mastery).toBeGreaterThan(0.5);
    // Propagated belief is NOT unassisted evidence about `a` — nobody asked.
    expect(m.states.a.unassistedObservations).toBe(0);
  });

  /**
   * A beat's `checks` is a LIST: 27 of the 126 authored beats that name any
   * outcome name more than one, and one names seven. Taking only the first
   * threw the rest away — no belief, no observation, no date.
   */
  it('speaks about every outcome the beat said it was checking', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [answered(0, true, ['a', 'b'])], index, params);
    expect(m.states.a.unassistedObservations).toBe(1);
    expect(m.states.b.unassistedObservations).toBe(1);
    expect(m.states.a.lastPracticedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  /**
   * A belief pinned at the floor stops moving, and the region loop skips
   * anything unchanged — so the asked node used to stop being counted while
   * `unassistedObservations` kept rising. A subset counter larger than its own
   * superset is the record disagreeing with itself, and `chooseAsk` ranks on it.
   */
  it('counts the asked outcome even once its belief has stopped moving', () => {
    seq = 0;
    let m = emptyModel();
    for (let i = 0; i < 10; i += 1) {
      m = foldSession(m, { id: `s${i}`, startedAt: `2026-09-${10 + i}T10:00:00.000Z` }, [answered(0, false)], index, params);
    }
    expect(m.states.b.mastery).toBeLessThan(0.1);
    expect(m.states.b.unassistedObservations).toBe(10);
    expect(m.states.b.observations).toBeGreaterThanOrEqual(m.states.b.unassistedObservations);
  });

  it('saturates attendance instead of counting it twice', () => {
    seq = 0;
    const taught = () => ev('taught', ['a'], { beatId: 'x' });
    const once = foldSession(emptyModel(), S1, [taught()], index, params);
    const twice = foldSession(once, S2, [taught()], index, params);
    expect(twice.states.a.taughtCount).toBe(2);
    expect(twice.states.a.mastery).toBeGreaterThan(once.states.a.mastery);
    const firstGain = once.states.a.mastery - 0.5;
    const secondGain = twice.states.a.mastery - once.states.a.mastery;
    expect(secondGain).toBeLessThan(firstGain);
  });

  it('reproduces applyTaught exactly for an outcome with no other evidence', () => {
    seq = 0;
    let m = emptyModel();
    const worth = [0.59, 0.6524, 0.675];
    for (let i = 0; i < 3; i += 1) {
      m = foldSession(m, { id: `t${i}`, startedAt: `2026-09-${10 + i}T10:00:00.000Z` }, [ev('taught', ['a'], {})], index, params);
      expect(m.states.a.mastery).toBeCloseTo(worth[i], 3);
    }
  });

  /**
   * applyDoubt's own rule: "a hand is a nudge rather than a verdict, and a
   * student who asks a lot must never be modelled as a student who knows
   * nothing." `evidenceSet` reads `observations` to decide what may become a
   * gap, so a raised hand must not land there.
   */
  it('counts a raised hand as doubt, never as evidence', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [ev('confused', ['a'], {})], index, params);
    expect(m.states.a.doubtCount).toBe(1);
    expect(m.states.a.observations).toBe(0);
    expect(m.states.a.mastery).toBeLessThan(0.5);
  });

  it('carries the cursor forward and refuses to fold the same event twice', () => {
    seq = 0;
    const one = answered(0);
    const first = foldSession(emptyModel(), S1, [one], index, params);
    const again = foldSession(first, S1, [one], index, params);
    expect(again.states.b.observations).toBe(1);
    expect(again.states.b.unassistedObservations).toBe(1);
    expect(again.foldedThrough).toEqual({ at: S1.startedAt, sessionId: 's1', seq: 0 });
  });

  /**
   * ORDERING IS BY THE SESSION'S CLOCK, NEVER THE DEVICE'S. `at` is stamped by
   * the phone, and phones lie. An earlier draft cursored on it, and one NTP
   * correction mid-session then put the rest of that session permanently behind
   * the cursor — lost for the student's whole life, and not recoverable by a
   * rebuild, because the rebuild replays the same events and re-poisons it.
   */
  it('survives a device clock that steps backwards mid-session', () => {
    seq = 0;
    const events = [
      answered(0, true, ['b']),
      ev('answered', ['b'], { correct: true, ms: 1000, attempt: 1, assistanceRung: 0, hintsShown: 0, chosenIndex: 0 }, '2026-09-14T09:59:00.000Z'),
      ev('answered', ['b'], { correct: true, ms: 1000, attempt: 1, assistanceRung: 0, hintsShown: 0, chosenIndex: 0 }, '2026-09-14T09:59:30.000Z'),
    ];
    const m = foldSession(emptyModel(), S1, events, index, params);
    expect(m.states.b.unassistedObservations).toBe(3);
  });

  it('does not let one future-dated sitting freeze the model', () => {
    seq = 0;
    const future = { id: 'sf', startedAt: '2027-05-01T10:00:00.000Z' };
    const frozen = foldSession(emptyModel(), future, [answered(0)], index, params);
    // A later real session. Its start is EARLIER than the poisoned one, so it
    // is legitimately behind the cursor — but a rebuild folds in started_at
    // order, and then the future sitting comes last and nothing is lost.
    const rebuilt = foldSession(
      foldSession(emptyModel(), S1, [answered(0)], index, params),
      future,
      [answered(0)],
      index,
      params,
    );
    expect(frozen.states.b.unassistedObservations).toBe(1);
    expect(rebuilt.states.b.unassistedObservations).toBe(2);
  });

  it('reads two renderings of the same instant as the same instant', () => {
    seq = 0;
    const zForm = { id: 's1', startedAt: '2026-09-14T10:00:00.000Z' };
    const offsetForm = { id: 's1', startedAt: '2026-09-14T10:00:00+00:00' };
    const one = answered(0);
    const first = foldSession(emptyModel(), zForm, [one], index, params);
    // THE SAME event, re-folded under the other rendering. A string compare
    // reads +00:00 as LATER than Z and folds it again, double-counting the
    // answer. The device writes Z; PostgREST hands back the offset form.
    const again = foldSession(first, offsetForm, [one], index, params);
    expect(again.states.b.unassistedObservations).toBe(1);
  });

  it('keeps two sittings apart even when they begin in the same millisecond', () => {
    seq = 0;
    const first = foldSession(emptyModel(), { id: 'aaa', startedAt: S1.startedAt }, [answered(0)], index, params);
    const second = foldSession(first, { id: 'bbb', startedAt: S1.startedAt }, [answered(0)], index, params);
    expect(second.states.b.unassistedObservations).toBe(2);
  });

  it('rebuilds rather than folding into a model of a different shape', () => {
    seq = 0;
    const stale = { ...emptyModel(), version: 0 };
    stale.states.b = { ...emptyModel().states.b, outcomeId: 'b' } as never;
    const m = foldSession(stale, S1, [answered(0)], index, params);
    expect(m.version).toBe(1);
    expect(m.states.b.unassistedObservations).toBe(1);
  });

  it('is the same state for the same events, every time', () => {
    seq = 0;
    const events = [answered(0)];
    expect(foldSession(emptyModel(), S1, events, index, params)).toEqual(
      foldSession(emptyModel(), S1, events, index, params),
    );
  });

  it('never mutates what it was given', () => {
    seq = 0;
    const model = emptyModel();
    Object.freeze(model);
    Object.freeze(model.states);
    const events = Object.freeze([answered(0)]);
    expect(() => foldSession(model, S1, events, index, params)).not.toThrow();
    expect(model.states).toEqual({});
  });

  /**
   * A SKIP IS NOT "THEY CHOSE OPTION 0". `applyEvidence` reads a null
   * chosenIndex as a skip — a soft "probably not" that moves the node alone and
   * deliberately does not propagate.
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
    const m = foldSession(emptyModel(), S1, [skip], index, params);
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
    const h = helped(4);
    const ans = answered(0);
    const inOrder = foldSession(emptyModel(), S1, [h, ans], index, params);
    const reversed = foldSession(emptyModel(), S1, [ans, h], index, params);
    expect(inOrder.states.b.unassistedObservations).not.toBe(
      reversed.states.b.unassistedObservations,
    );
  });
});
