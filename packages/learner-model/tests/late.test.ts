import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import {
  emptyModel,
  foldHistory,
  foldSession,
  foldSessionReport,
  placeOnArrival,
  type FoldSession,
  type LearnerModel,
} from '../src/index';

/**
 * LATE AND OUT-OF-ORDER EVIDENCE (lam-one-brain Task 8; truth test L03/L04).
 *
 * The fold's cursor is a high-water mark. Before this, anything at or behind it
 * was skipped with no signal: a sitting whose phone clock was behind the last
 * one, an answer delivered after its successor, an older sitting delivered
 * late. And a redelivered older sitting wiped the help the live sitting had
 * been given, so its next answer read as cold.
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

const S1: FoldSession = { id: 's1', startedAt: '2026-09-14T10:00:00.000Z' };
const S2: FoldSession = { id: 's2', startedAt: '2026-09-15T10:00:00.000Z' };
const S3: FoldSession = { id: 's3', startedAt: '2026-09-17T10:00:00.000Z' };

const ev = (session: FoldSession, seq: number, kind: string, outcomeIds: string[], payload: unknown): LedgerEvent =>
  ({
    id: `${session.id}-e${seq}`,
    sessionId: session.id,
    seq,
    at: session.startedAt,
    kind,
    source: 'class',
    surface: 'tap',
    outcomeIds,
    payload,
  }) as unknown as LedgerEvent;

const answer = (session: FoldSession, seq: number, ids: string[], correct: boolean, extra: object = {}) =>
  ev(session, seq, 'answered', ids, {
    correct,
    ms: 4000,
    attempt: 1,
    assistanceRung: 0,
    hintsShown: 0,
    chosenIndex: correct ? 0 : 2,
    ...extra,
  });

const help = (session: FoldSession, seq: number, ids: string[], beatId: string, rung = 4) =>
  ev(session, seq, 'helped', ids, { beatId, rung, requested: false });

describe('an event behind the cursor is never dropped in silence', () => {
  it('reports an older sitting delivered after a newer one, and folds nothing from it', () => {
    const newer = foldSession(emptyModel(), S2, [answer(S2, 0, ['b'], true)], index, params);
    const r = foldSessionReport(newer, S1, [answer(S1, 0, ['b'], false)], index, params);
    expect(r.needsRebuild).toBe(true);
    expect(r.skipped).toBe(1);
    expect(r.model.states).toEqual(newer.states);
    expect(r.model.foldedThrough).toEqual(newer.foldedThrough);
  });

  it('does not report a repeat of what this sitting already folded', () => {
    const one = [answer(S1, 0, ['b'], true), answer(S1, 1, ['a'], true)];
    const first = foldSession(emptyModel(), S1, one, index, params);
    const again = foldSessionReport(first, S1, one, index, params);
    expect(again.needsRebuild).toBe(false);
    expect(again.skipped).toBe(0);
    expect(again.model).toEqual(first);
  });

  it('folds an answer that arrives after its successor, and reports that it came out of order', () => {
    let m = foldSession(emptyModel(), S1, [answer(S1, 0, ['b'], true), answer(S1, 2, ['b'], true)], index, params);
    expect(m.foldedThrough?.gaps).toEqual([[1, 1]]);
    const r = foldSessionReport(m, S1, [answer(S1, 1, ['b'], false)], index, params);
    m = r.model;
    expect(r.needsRebuild).toBe(true);
    expect(r.outOfOrder).toBe(1);
    expect(m.states.b.observations).toBe(3);
    expect(m.foldedThrough?.gaps).toBeUndefined();
    // And once it is in, it is a repeat like any other.
    const again = foldSessionReport(m, S1, [answer(S1, 1, ['b'], false)], index, params);
    expect(again.needsRebuild).toBe(false);
    expect(again.model.states.b.observations).toBe(3);
  });

  it('folds one batch in seq order whatever order the list is in', () => {
    const h = help(S1, 0, ['b'], 'B1');
    const a = answer(S1, 1, ['b'], true, { beatId: 'B1' });
    const inOrder = foldSession(emptyModel(), S1, [h, a], index, params);
    const listedBackwards = foldSession(emptyModel(), S1, [a, h], index, params);
    expect(listedBackwards).toEqual(inOrder);
    // The help came first by seq, so the answer was not cold.
    expect(listedBackwards.states.b.unassistedObservations).toBe(0);
  });
});

describe('a redelivered older sitting', () => {
  /**
   * L04: the newer sitting is given help (rung 5), the older sitting's batch is
   * delivered again, then the answer arrives. The help was wiped, the answer
   * folded as cold, and unassisted mastery went to 0.783 — manufactured.
   */
  it('leaves the live sitting its help', () => {
    const old = [answer(S1, 0, ['a'], true)];
    let m = foldSession(emptyModel(), S1, old, index, params);
    m = foldSession(m, S2, [help(S2, 0, ['b'], 'B3', 5)], index, params);
    m = foldSession(m, S1, old, index, params);
    m = foldSession(m, S2, [answer(S2, 1, ['b'], true, { beatId: 'B3' })], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
    expect(m.states.b.unassistedMastery).toBe(0.5);
    expect(m.helpInFlight).toEqual({ sessionId: 's2', byAsk: expect.any(Object) });
  });
});

describe('the phone places a sitting where it arrived (placeOnArrival)', () => {
  it('counts a sitting whose phone clock is behind the last one', () => {
    const today = foldSession(emptyModel(), S2, [answer(S2, 0, ['b'], true)], index, params);
    // The phone's clock was set back a month before the next class.
    const setBack: FoldSession = { id: 's0', startedAt: '2026-08-15T10:00:00.000Z' };
    const placed = placeOnArrival(today, setBack);
    const r = foldSessionReport(today, placed, [answer(setBack, 0, ['b'], false)], index, params);
    expect(r.needsRebuild).toBe(false);
    expect(r.model.states.b.observations).toBe(2);
    // Placed after what was folded, still timed by its own sitting.
    expect(Date.parse(r.model.foldedThrough!.at)).toBeGreaterThan(Date.parse(S2.startedAt));
    expect(r.model.states.b.lastPracticedAt).toBe(setBack.startedAt);
  });

  it('keeps counting real sittings after one stamped in 2099', () => {
    const wrong: FoldSession = { id: 's9', startedAt: '2099-01-01T00:00:00.000Z' };
    let m = foldSession(emptyModel(), wrong, [answer(wrong, 0, ['b'], true)], index, params);
    for (const s of [S1, S2, S3]) {
      m = foldSession(m, placeOnArrival(m, s), [answer(s, 0, ['b'], true)], index, params);
    }
    expect(m.states.b.observations).toBe(4);
  });

  it('keeps a sitting in its place across the calls that fold it', () => {
    const setBack: FoldSession = { id: 's0', startedAt: '2026-08-15T10:00:00.000Z' };
    let m = foldSession(emptyModel(), S2, [answer(S2, 0, ['b'], true)], index, params);
    m = foldSession(m, placeOnArrival(m, setBack), [help(setBack, 0, ['b'], 'B1')], index, params);
    const placed = placeOnArrival(m, setBack);
    expect(placed.orderAt).toBe(m.foldedThrough!.at);
    const r = foldSessionReport(m, placed, [answer(setBack, 1, ['b'], true, { beatId: 'B1' })], index, params);
    expect(r.needsRebuild).toBe(false);
    expect(r.model.states.b.observations).toBe(2);
    // The help from the first call still counts against the answer in the second.
    expect(r.model.states.b.unassistedObservations).toBe(1);
  });

  it('leaves a sitting that begins after the cursor where it is', () => {
    const m = foldSession(emptyModel(), S1, [answer(S1, 0, ['b'], true)], index, params);
    expect(placeOnArrival(m, S2)).toEqual(S2);
    expect(placeOnArrival(emptyModel(), S1)).toEqual(S1);
  });
});

/**
 * THE PLAN'S TEST: shuffled delivery of a recorded stream ends at the same
 * model as sorted delivery. A store that folds each batch as it arrives and
 * folds its whole history again (`foldHistory`) whenever the fold reports
 * `needsRebuild` must hold, after every batch, exactly the model of what it has
 * been given in order — and so end where in-order delivery ends.
 */
describe('shuffled delivery', () => {
  const sittings = [S1, S2, S3];

  const stream: LedgerEvent[] = sittings.flatMap((s, i) => [
    ev(s, 0, 'session-started', [], {}),
    ev(s, 1, 'taught', ['a'], {}),
    help(s, 2, ['b'], 'B1', 3 + i),
    answer(s, 3, ['b'], i !== 1, { beatId: 'B1' }),
    answer(s, 4, ['a'], false, { probeId: `p${i}`, misconceptionId: 'adds the bottoms' }),
    answer(s, 5, ['b'], true, { probeId: `q${i}` }),
    ev(s, 6, 'confused', ['b'], {}),
    answer(s, 7, ['a', 'b'], i === 2, { probeId: `r${i}` }),
  ]);

  /** A seeded shuffle, so a failure names the seed that broke it. */
  const rng = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  function shuffled(seed: number): LedgerEvent[][] {
    const r = rng(seed);
    const batches: LedgerEvent[][] = [];
    for (const s of sittings) {
      const own = stream.filter((e) => e.sessionId === s.id);
      for (let i = 0; i < own.length; ) {
        const n = 1 + Math.floor(r() * 3);
        batches.push(own.slice(i, i + n));
        i += n;
      }
    }
    for (let i = batches.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [batches[i], batches[j]] = [batches[j], batches[i]];
    }
    // And each batch listed in its own shuffled order.
    return batches.map((b) => [...b].sort(() => r() - 0.5));
  }

  const sittingOf = (e: LedgerEvent) => sittings.find((s) => s.id === e.sessionId)!;

  const inOrder = (events: readonly LedgerEvent[]): LearnerModel =>
    foldHistory(sittings, events, index, params).model;

  it('lands, batch by batch, on the model of what was given in order', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let model = emptyModel();
      const given: LedgerEvent[] = [];
      let rebuilt = 0;
      for (const batch of shuffled(seed)) {
        given.push(...batch);
        const r = foldSessionReport(model, sittingOf(batch[0]), batch, index, params);
        if (r.needsRebuild) rebuilt += 1;
        model = r.needsRebuild ? inOrder(given) : r.model;
        expect(model, `seed ${seed}`).toEqual(inOrder(given));
      }
      expect(model, `seed ${seed}`).toEqual(inOrder(stream));
      expect(given).toHaveLength(stream.length);
      // The seeds do deliver out of order; otherwise this proves nothing.
      if (seed === 1) expect(rebuilt).toBeGreaterThan(0);
    }
  });

  it('in order, folds to the same model one sitting at a time', () => {
    let m = emptyModel();
    for (const s of sittings) m = foldSession(m, s, stream.filter((e) => e.sessionId === s.id), index, params);
    expect(inOrder(stream)).toEqual(m);
  });

  it('orders sittings that began in the same millisecond by id, whatever order they are listed in', () => {
    const a: FoldSession = { id: 'aaa', startedAt: S1.startedAt };
    const b: FoldSession = { id: 'bbb', startedAt: S1.startedAt };
    const events = [answer(b, 0, ['b'], true), answer(a, 0, ['b'], false)];
    const one = foldHistory([a, b], events, index, params);
    const other = foldHistory([b, a], events, index, params);
    expect(other.model).toEqual(one.model);
    expect(one.model.states.b.observations).toBe(2);
    expect(one.folded.map((e) => e.id)).toEqual(['aaa-e0', 'bbb-e0']);
  });

  it('folds on top of a model it is given, as if that model had folded the earlier sittings (Task 11)', () => {
    // The phone's merge: the server's model as the start, its own sittings on top.
    const base = foldHistory([S1], [answer(S1, 0, ['b'], false)], index, params).model;
    const start = { ...base, foldedThrough: null, helpInFlight: null };
    const onTop = foldHistory([S2], [answer(S2, 0, ['b'], true)], index, params, start);
    const whole = foldHistory([S1, S2], [answer(S1, 0, ['b'], false), answer(S2, 0, ['b'], true)], index, params);
    expect(onTop.model.states).toEqual(whole.model.states);
    expect(onTop.folded.map((e) => e.id)).toEqual(['s2-e0']);
  });

  it('counts events whose sitting it was not given instead of folding them', () => {
    const lost: FoldSession = { id: 'zz', startedAt: S1.startedAt };
    const out = foldHistory([S1], [answer(S1, 0, ['b'], true), answer(lost, 0, ['b'], true)], index, params);
    expect(out.orphaned).toBe(1);
    expect(out.model.states.b.observations).toBe(1);
  });
});
