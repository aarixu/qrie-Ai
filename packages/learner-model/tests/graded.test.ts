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
    for (const source of ['homework', 'test', 'practice', 'api']) expect(of(source)).toBe(true);
    expect(of('quiz', 'server')).toBe(true);
    expect(of('quiz', 'phone')).toBe(false);
    // The phone's own events, and every answer recorded before 0115.
    for (const source of ['class', 'quiz', 'diagnostic', 'doubt', 'lesson']) expect(of(source)).toBe(false);
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
    expect(MODEL_VERSION).toBe(5);
    expect(emptyConceptState('x').verifiedMastery).toBe(0.5);
    expect(emptyConceptState('x').verifiedObservations).toBe(0);
  });

  it('a v4 model brought forward has nothing verified yet', () => {
    const v4 = { version: 4, foldedThrough: null, helpInFlight: null, states: { a: { ...emptyConceptState('a'), unassistedObservations: 3 } } };
    delete (v4.states.a as Partial<ReturnType<typeof emptyConceptState>>).verifiedMastery;
    delete (v4.states.a as Partial<ReturnType<typeof emptyConceptState>>).verifiedObservations;
    const m = migrateModel(v4);
    expect(m.version).toBe(5);
    expect(m.states.a.unassistedObservations).toBe(3);
    expect(m.states.a.verifiedObservations).toBe(0);
    expect(m.states.a.verifiedMastery).toBe(0.5);
  });
});
