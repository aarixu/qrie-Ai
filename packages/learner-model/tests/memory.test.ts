import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { REVIEW_LADDER_DAYS, emptyConceptState, emptyModel, foldSession, migrateModel, MODEL_VERSION } from '../src/index';

/**
 * F1-F3: MEMORY, IN THE PURE FOLD.
 *
 * Boxes 0-5 on the 1/2/5/12/30/60-day ladder. An unassisted success that is a
 * real retrieval moves up a box, a failure resets it, a hinted success holds.
 * The first taught or answered event opens box 0 with a review a day later.
 * An exposure (taught, or an answer at rung >= 5) is kept apart from a
 * retrieval (cold, >= 24 h after the last exposure), and answers after an
 * exposure in the same session never count toward `masteredAt`.
 */

const node = (id: string) => ({
  id, klass: 10, subject: 'Maths', chapter: 'ch', title: id, outcome: id, prerequisites: [], difficulty: 2, topicRef: 'x/ch/t',
});
const index = new GraphIndex({ version: 1, nodes: [node('a')] } as never);
const params = emptyParams();
const day = (n: number) => ({ id: `s${n}`, startedAt: new Date(Date.UTC(2026, 8, 1 + n, 10)).toISOString() });
let seq = 0;
const ev = (kind: string, payload: unknown, sessionId: string): LedgerEvent =>
  ({ id: `e${seq}`, sessionId, seq: seq++, at: '2026-09-01T10:00:00.000Z', kind, source: 'lesson', surface: 'tap', outcomeIds: ['a'], payload }) as unknown as LedgerEvent;
const taught = (s: { id: string }) => ev('taught', { beatId: `b${seq}` }, s.id);
const answer = (s: { id: string }, correct: boolean, rung = 0) =>
  ev('answered', { correct, ms: 4000, attempt: 1, assistanceRung: rung, hintsShown: rung > 0 ? 1 : 0, chosenIndex: 0, beatId: `q${seq}` }, s.id);
const at = (s: { startedAt: string }, days: number) => new Date(Date.parse(s.startedAt) + days * 86_400_000).toISOString();

describe('the review ladder', () => {
  it('is the plan’s 1/2/5/12/30/60 days', () => {
    expect(REVIEW_LADDER_DAYS).toEqual([1, 2, 5, 12, 30, 60]);
  });

  it('opens box 0 with a review a day later on the first taught event', () => {
    const d0 = day(0);
    const m = foldSession(emptyModel(), d0, [taught(d0)], index, params);
    expect(m.states.a.box).toBe(0);
    expect(m.states.a.nextReviewAt).toBe(at(d0, 1));
    expect(m.states.a.lastExposedAt).toBe(d0.startedAt);
  });

  it('moves up a box on a cold right answer a day after the lesson, and schedules further out', () => {
    const d0 = day(0);
    const d1 = day(1);
    let m = foldSession(emptyModel(), d0, [taught(d0)], index, params);
    m = foldSession(m, d1, [answer(d1, true)], index, params);
    expect(m.states.a.box).toBe(1);
    expect(m.states.a.nextReviewAt).toBe(at(d1, 2));
    expect(m.states.a.lastRetrievedAt).toBe(d1.startedAt);
    expect(m.states.a.retrievalCount).toBe(1);
    expect(m.states.a.retrievalAccuracy).toBe(1);
  });

  it('does not count a right answer straight after the lesson as a retrieval', () => {
    const d0 = day(0);
    const m = foldSession(emptyModel(), d0, [taught(d0), answer(d0, true)], index, params);
    expect(m.states.a.box).toBe(0);
    expect(m.states.a.retrievalCount).toBe(0);
    expect(m.states.a.lastRetrievedAt).toBeNull();
  });

  it('resets to box 0 on any miss, and holds on a hinted success', () => {
    const d0 = day(0);
    const d1 = day(1);
    const d3 = day(3);
    let m = foldSession(emptyModel(), d0, [taught(d0)], index, params);
    m = foldSession(m, d1, [answer(d1, true)], index, params);
    expect(m.states.a.box).toBe(1);
    m = foldSession(m, d3, [answer(d3, true, 3)], index, params);
    expect(m.states.a.box).toBe(1);
    m = foldSession(m, day(5), [answer(day(5), false)], index, params);
    expect(m.states.a.box).toBe(0);
    expect(m.states.a.nextReviewAt).toBe(at(day(5), 1));
  });

  it('counts an answer given with the answer on screen as an exposure, not a retrieval', () => {
    const d0 = day(0);
    const m = foldSession(emptyModel(), d0, [answer(d0, true, 8)], index, params);
    expect(m.states.a.lastExposedAt).toBe(d0.startedAt);
    expect(m.states.a.retrievalCount).toBe(0);
  });

  it('never lets an answer after an exposure in the same session count toward masteredAt', () => {
    // Two cold right answers on different items, a day apart — but each right
    // after that day's lesson. Recall straight after teaching is not mastery.
    const d0 = day(0);
    const d1 = day(1);
    let m = foldSession(emptyModel(), d0, [taught(d0), answer(d0, true)], index, params);
    m = foldSession(m, d1, [taught(d1), answer(d1, true)], index, params);
    expect(m.states.a.masteredAt).toBeNull();
    expect(Object.keys(m.states.a.coldWins)).toHaveLength(0);
  });

  it('is a version bump that migrates, never wipes', () => {
    expect(MODEL_VERSION).toBe(3);
    const { box: _b, lastExposedAt: _e, lastRetrievedAt: _r, ...v2 } = emptyConceptState('a');
    const migrated = migrateModel({ version: 2, foldedThrough: null, helpInFlight: null, states: { a: { ...v2, mastery: 0.8 } } });
    expect(migrated.states.a.mastery).toBe(0.8);
    expect(migrated.states.a.box).toBeNull();
  });
});

describe('the review ladder, sixth review', () => {
  it('climbs at most one box a session, and only when the review is due', () => {
    const d0 = day(0);
    let m = foldSession(emptyModel(), d0, [answer(d0, true), answer(d0, true), answer(d0, true), answer(d0, true)], index, params);
    expect(m.states.a.box).toBe(0);
    // Next day it is due: one climb, however many right answers.
    const d1 = day(1);
    m = foldSession(m, d1, [answer(d1, true), answer(d1, true), answer(d1, true)], index, params);
    expect(m.states.a.box).toBe(1);
    // Box 1 is due two days on; a right answer a day early holds.
    const d2 = day(2);
    m = foldSession(m, d2, [answer(d2, true)], index, params);
    expect(m.states.a.box).toBe(1);
  });

  it('never stamps masteredAt from answers given in the session that taught it', () => {
    let m = emptyModel();
    // Cold wins a day and more apart, but unassisted belief held down by misses.
    m = foldSession(m, day(0), [answer(day(0), true), answer(day(0), false), answer(day(0), false)], index, params);
    m = foldSession(m, day(2), [answer(day(2), true), answer(day(2), false), answer(day(2), false)], index, params);
    const d5 = day(5);
    m = foldSession(m, d5, [taught(d5), answer(d5, true), answer(d5, true), answer(d5, true), answer(d5, true), answer(d5, true)], index, params);
    expect(m.states.a.masteredAt).toBeNull();
  });
});

describe('the review ladder, seventh review', () => {
  it('still climbs for a child who practises every day', () => {
    const d0 = day(0);
    let m = foldSession(emptyModel(), d0, [taught(d0)], index, params);
    for (let n = 1; n <= 20; n++) m = foldSession(m, day(n), [answer(day(n), true)], index, params);
    // Due on days 1, 3, 8 and 20: four climbs.
    expect(m.states.a.box).toBe(4);
  });
});

describe('the review ladder, eighth review', () => {
  // At the top box a due right answer cannot climb, and holding the old due
  // date kept a mastered outcome due forever, at the head of every review card.
  it('reschedules a due right answer at the top box instead of leaving it due', () => {
    const d0 = day(0);
    const top = {
      ...emptyConceptState('a'),
      box: 5,
      nextReviewAt: at(d0, 0),
      lastExposedAt: at(d0, -90),
      lastRetrievedAt: at(d0, -60),
    };
    const d1 = day(1);
    const m = foldSession({ ...emptyModel(), states: { a: top } }, d1, [answer(d1, true)], index, params);
    expect(m.states.a.box).toBe(5);
    expect(Date.parse(m.states.a.nextReviewAt!)).toBeGreaterThan(Date.parse(d1.startedAt));
  });
});
