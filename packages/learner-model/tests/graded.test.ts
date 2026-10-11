import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { MODEL_VERSION, emptyConceptState, emptyModel, foldSession, migrateModel, serverGraded, unassistedView } from '../src/index';

/**
 * C2: WHO SAID THE ANSWER WAS RIGHT (lam-one-brain Task 15).
 *
 * record_evidence (0115) grades a tutor answer to a bank probe against the
 * probe's key and writes `graded: 'server'`; every other tutor answer is
 * `graded: 'phone'`, and the LMS marks homework, tests and practice itself.
 * A phone-graded answer still moves the belief decisions read
 * (`unassistedMastery`), so the lesson adapts to it; `masteredAt` and the
 * figures a teacher reads as "on their own" (`verifiedMastery`,
 * `verifiedObservations`) count only answers the server graded.
 */

const node = (id: string) => ({
  id, klass: 10, subject: 'Maths', chapter: 'ch', title: id, outcome: id, prerequisites: [], difficulty: 2, topicRef: 'x/ch/t',
});
const index = new GraphIndex({ version: 1, nodes: [node('a')] } as never);
const params = emptyParams();
const day = (n: number) => ({ id: `s${n}`, startedAt: new Date(Date.UTC(2026, 8, 1 + n, 10)).toISOString() });

let seq = 0;
const answer = (
  s: { id: string },
  probeId: string,
  correct: boolean,
  opts: { source?: string; graded?: 'server' | 'phone'; rung?: number; surface?: string } = {},
): LedgerEvent =>
  ({
    id: `e${seq}`,
    sessionId: s.id,
    seq: seq++,
    at: '2026-09-01T10:00:00.000Z',
    kind: 'answered',
    source: opts.source ?? 'quiz',
    surface: opts.surface ?? 'tap',
    outcomeIds: ['a'],
    payload: {
      probeId, correct, ms: 4000, attempt: 1, assistanceRung: opts.rung ?? 0, hintsShown: 0, chosenIndex: 0,
      ...(opts.graded ? { graded: opts.graded } : {}),
    },
  }) as unknown as LedgerEvent;

describe('serverGraded', () => {
  const of = (source: string, graded?: string) =>
    serverGraded({ source } as LedgerEvent, { graded } as never);

  it('trusts what the LMS marked and what record_evidence graded, nothing else', () => {
    for (const source of ['homework', 'test', 'practice']) expect(of(source)).toBe(true);
    expect(of('quiz', 'server')).toBe(true);
    expect(of('quiz', 'phone')).toBe(false);
    // The phone's own events, and every answer recorded before 0115.
    for (const source of ['class', 'quiz', 'diagnostic', 'doubt', 'lesson']) expect(of(source)).toBe(false);
  });

  it('does not trust the api source: nothing of the server writes it, and a token could (F1)', () => {
    expect(serverGraded({ source: 'api' } as LedgerEvent, {} as never)).toBe(false);
  });

  it('on the server, the ledger’s own graded_by is the only word on it (F1, 0118)', () => {
    const on = (source: string, gradedBy: 'server' | 'phone', graded?: string) =>
      serverGraded({ source, gradedBy } as LedgerEvent, { graded } as never);
    // A row a token planted before 0110: a school source, or a payload that says 'server'.
    expect(on('homework', 'phone')).toBe(false);
    expect(on('class', 'phone', 'server')).toBe(false);
    expect(on('quiz', 'server')).toBe(true);
    expect(on('homework', 'server')).toBe(true);
  });
});

describe('a phone-graded answer adapts the lesson and counts for nothing a teacher reads as on their own', () => {
  it('moves the decision belief but not the verified one', () => {
    seq = 0;
    const d0 = day(0);
    const m = foldSession(emptyModel(), d0, [answer(d0, 'p1', true, { source: 'class', graded: 'phone' })], index, params);
    expect(m.states.a.unassistedObservations).toBe(1);
    expect(m.states.a.unassistedMastery).toBeGreaterThan(0.5);
    expect(unassistedView(m).a).toBeGreaterThan(0.5);
    expect(m.states.a.verifiedObservations).toBe(0);
    expect(m.states.a.verifiedMastery).toBe(0.5);
    expect(m.states.a.coldWins).toEqual({});
  });

  it('never sets masteredAt, however many days and items', () => {
    seq = 0;
    let m = emptyModel();
    for (let d = 0; d < 6; d += 1) {
      const s = day(d);
      m = foldSession(m, s, [answer(s, `p${d}`, true, { source: 'class', graded: 'phone' })], index, params);
    }
    expect(m.states.a.unassistedMastery).toBeGreaterThan(0.8);
    expect(m.states.a.masteredAt).toBeNull();
  });

  it('reads an answer with no grade on a tutor source as the phone’s', () => {
    seq = 0;
    let m = emptyModel();
    for (let d = 0; d < 3; d += 1) {
      const s = day(d);
      m = foldSession(m, s, [answer(s, `p${d}`, true)], index, params);
    }
    expect(m.states.a.verifiedObservations).toBe(0);
    expect(m.states.a.masteredAt).toBeNull();
  });

  it('a server-graded retest on a different bank probe a day later stamps it', () => {
    seq = 0;
    const d0 = day(0);
    const d1 = day(1);
    let m = foldSession(emptyModel(), d0, [answer(d0, 'p1', true, { graded: 'server' })], index, params);
    expect(m.states.a.masteredAt).toBeNull();
    m = foldSession(m, d1, [answer(d1, 'p2', true, { graded: 'server' })], index, params);
    expect(m.states.a.verifiedObservations).toBe(2);
    expect(m.states.a.verifiedMastery).toBeGreaterThanOrEqual(0.8);
    expect(m.states.a.masteredAt).toBe(d1.startedAt);
  });

  it('phone-graded rights on day 1 do not make up the first item of the pair', () => {
    seq = 0;
    const d0 = day(0);
    const d1 = day(1);
    let m = foldSession(
      emptyModel(), d0,
      [answer(d0, 'p1', true, { source: 'class', graded: 'phone' }), answer(d0, 'p3', true, { source: 'class', graded: 'phone' })],
      index, params);
    m = foldSession(m, d1, [answer(d1, 'p2', true, { graded: 'server' })], index, params);
    expect(m.states.a.unassistedMastery).toBeGreaterThanOrEqual(0.8);
    expect(m.states.a.masteredAt).toBeNull();
  });

  it('a phone-graded miss can take the stamp away, never give it', () => {
    seq = 0;
    const d0 = day(0);
    const d1 = day(1);
    const d2 = day(2);
    let m = foldSession(emptyModel(), d0, [answer(d0, 'p1', true, { graded: 'server' })], index, params);
    m = foldSession(m, d1, [answer(d1, 'p2', true, { graded: 'server' })], index, params);
    expect(m.states.a.masteredAt).toBe(d1.startedAt);
    m = foldSession(m, d2, [answer(d2, 'p4', false, { source: 'class', graded: 'phone' })], index, params);
    expect(m.states.a.unassistedMastery).toBeLessThan(0.8);
    expect(m.states.a.masteredAt).toBeNull();
    expect(m.states.a.verifiedMastery).toBeGreaterThanOrEqual(0.8);
  });

  it('homework, marked by the LMS, counts as verified with no grade written', () => {
    seq = 0;
    const d0 = day(0);
    const d1 = day(1);
    let m = foldSession(emptyModel(), d0, [answer(d0, 'p1', true, { source: 'homework' })], index, params);
    m = foldSession(m, d1, [answer(d1, 'p2', true, { source: 'homework' })], index, params);
    expect(m.states.a.verifiedObservations).toBe(2);
    expect(m.states.a.verifiedMastery).toBe(m.states.a.unassistedMastery);
    expect(m.states.a.masteredAt).toBe(d1.startedAt);
  });

  it('a hinted answer moves neither cold belief, graded or not', () => {
    seq = 0;
    const d0 = day(0);
    const m = foldSession(emptyModel(), d0, [answer(d0, 'p1', true, { graded: 'server', rung: 3 })], index, params);
    expect(m.states.a.unassistedObservations).toBe(0);
    expect(m.states.a.verifiedObservations).toBe(0);
    expect(m.states.a.assistedPerformance).toBeGreaterThan(0.5);
  });
});

describe('version 5', () => {
  it('starts every outcome unverified', () => {
    expect(MODEL_VERSION).toBeGreaterThanOrEqual(5);
    expect(emptyConceptState('x').verifiedMastery).toBe(0.5);
    expect(emptyConceptState('x').verifiedObservations).toBe(0);
  });

  it('a v4 model brought forward has nothing verified yet', () => {
    const v4 = { version: 4, foldedThrough: null, helpInFlight: null, states: { a: { ...emptyConceptState('a'), unassistedObservations: 3 } } };
    delete (v4.states.a as Partial<ReturnType<typeof emptyConceptState>>).verifiedMastery;
    delete (v4.states.a as Partial<ReturnType<typeof emptyConceptState>>).verifiedObservations;
    const m = migrateModel(v4);
    expect(m.version).toBe(MODEL_VERSION);
    expect(m.states.a.unassistedObservations).toBe(3);
    expect(m.states.a.verifiedObservations).toBe(0);
    expect(m.states.a.verifiedMastery).toBe(0.5);
  });

  /** A v6 model as a v4 phone stored it: no verified belief, no asked items. */
  const asV4 = (m: ReturnType<typeof emptyModel>) => {
    const states: Record<string, Partial<ReturnType<typeof emptyConceptState>>> = {};
    for (const [id, st] of Object.entries(m.states)) {
      const { verifiedMastery: _vm, verifiedObservations: _vo, askedItems: _ai, ...rest } = st;
      states[id] = rest;
    }
    return { ...m, states, version: 4 };
  };

  it('a v4 stamp brought forward is kept by a phone-graded right, as a v6 one is', () => {
    seq = 0;
    const d0 = day(0);
    const d1 = day(1);
    const d2 = day(2);
    let m = foldSession(emptyModel(), d0, [answer(d0, 'p1', true, { graded: 'server' })], index, params);
    m = foldSession(m, d1, [answer(d1, 'p2', true, { graded: 'server' })], index, params);
    expect(m.states.a.masteredAt).toBe(d1.startedAt);
    const right = (model: typeof m) =>
      foldSession(model, d2, [answer(d2, 'p4', true, { source: 'class', graded: 'phone' })], index, params);
    expect(right(m).states.a.masteredAt).toBe(d1.startedAt);
    const migrated = migrateModel(asV4(m));
    expect(migrated.states.a.masteredAt).toBe(d1.startedAt);
    expect(right(migrated).states.a.masteredAt).toBe(d1.startedAt);
  });

  it('a v4 outcome not mastered brings no cold wins forward: they were graded on the phone', () => {
    seq = 0;
    const d0 = day(0);
    const d1 = day(1);
    const d2 = day(2);
    // Two phone-graded rights a day apart: under v4 these were cold wins.
    let m = foldSession(emptyModel(), d0, [answer(d0, 'p1', true, { source: 'class', graded: 'phone' })], index, params);
    m = foldSession(m, d1, [answer(d1, 'p3', true, { source: 'class', graded: 'phone' })], index, params);
    const v4 = asV4(m);
    v4.states.a = { ...v4.states.a, coldWins: { 'probe:p1': { first: d0.startedAt, last: d0.startedAt }, 'probe:p3': { first: d1.startedAt, last: d1.startedAt } } };
    const migrated = migrateModel(v4);
    expect(migrated.states.a.masteredAt).toBeNull();
    expect(migrated.states.a.coldWins).toEqual({});
    expect(migrated.states.a.verifiedObservations).toBe(0);
    // Two server-graded rights a day apart are still needed.
    let after = foldSession(migrated, d2, [answer(d2, 'p2', true, { graded: 'server' })], index, params);
    after = foldSession(after, d2, [answer(d2, 'p5', true, { graded: 'server' })], index, params);
    expect(after.states.a.masteredAt).toBeNull();
  });
});

describe('only a server-graded cold right clears a wrong idea (F4)', () => {
  const ev = (s: { id: string }, source: string, payload: Record<string, unknown>): LedgerEvent =>
    ({
      id: `f4-${seq}`, sessionId: s.id, seq: seq++, at: '2026-09-01T10:00:00.000Z', kind: 'answered', source,
      surface: 'tap', outcomeIds: ['a'],
      payload: { ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0, ...payload },
    }) as unknown as LedgerEvent;
  const idea = 'adds the denominators';

  it('phone-graded rights leave a confirmed idea standing; the server’s clear it', () => {
    seq = 0;
    const d0 = day(0);
    const d1 = day(1);
    const d2 = day(2);
    let m = foldSession(emptyModel(), d0, [
      ev(d0, 'homework', { itemId: 'i1', correct: false, chosenIndex: 1, misconceptionId: idea }),
      ev(d0, 'homework', { itemId: 'i2', correct: false, chosenIndex: 1, misconceptionId: idea }),
    ], index, params);
    const id = Object.keys(m.states.a.misconceptions)[0];
    expect(m.states.a.misconceptions[id]).toMatchObject({ clearedAt: null, items: ['item:i1', 'item:i2'] });

    m = foldSession(m, d1, [
      ev(d1, 'class', { beatId: 'x1', correct: true }),
      ev(d1, 'class', { beatId: 'x2', correct: true }),
    ], index, params);
    expect(m.states.a.misconceptions[id].clearedAt).toBeNull();
    expect(m.states.a.misconceptions[id].clearing).toEqual([]);

    m = foldSession(m, d2, [
      ev(d2, 'quiz', { probeId: 'p1', correct: true, chosenIndex: 0, graded: 'server' }),
      ev(d2, 'quiz', { probeId: 'p2', correct: true, chosenIndex: 0, graded: 'server' }),
    ], index, params);
    expect(m.states.a.misconceptions[id].clearedAt).toBe(d2.startedAt);
  });
});
