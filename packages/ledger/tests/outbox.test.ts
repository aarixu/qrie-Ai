import { describe, expect, it } from 'vitest';
import {
  MAX_PENDING,
  acknowledge,
  batch,
  emptyOutbox,
  endSession,
  record,
  recordAnswer,
  startSession,
  type Outbox,
} from '../src/outbox';

/**
 * The outbox exists so a class can run with no signal and still be remembered.
 * These tests are about the two ways that goes wrong: losing an event, and
 * counting one twice.
 */

const opened = (): Outbox =>
  startSession(emptyOutbox(), {
    id: 'sess-1',
    at: '2026-09-12T10:00:00.000Z',
    source: 'class',
    topicRef: 'class10-science/life-processes/respiration',
  });

const answer = (o: Outbox, n: number): Outbox =>
  recordAnswer(o, {
    id: `a${n}`,
    at: '2026-09-12T10:01:00.000Z',
    surface: 'voice',
    outcomeIds: ['sci10-lp-respiration-equation'],
    correct: true,
    ms: 4200,
    attempt: 1,
    assistanceRung: 0,
    hintsShown: 0,
  });

describe('a session', () => {
  it('opens with an event, so the sitting itself is in the record', () => {
    const o = opened();
    expect(o.session?.id).toBe('sess-1');
    expect(o.pending).toHaveLength(1);
    expect(o.pending[0].kind).toBe('session-started');
  });

  it('refuses to invent a session for a homeless event', () => {
    // Dropping it loudly beats attributing it to a sitting that never happened:
    // an event with no session cannot be ordered, replayed or attributed.
    const o = record(emptyOutbox(), {
      id: 'x',
      at: '2026-09-12T10:00:00.000Z',
      kind: 'taught',
      surface: 'tap',
      payload: {},
    });
    expect(o.pending).toHaveLength(0);
    expect(o.session).toBeNull();
  });

  it('carries the session topicRef onto events that do not name one', () => {
    const o = answer(opened(), 1);
    expect(o.pending[1].topicRef).toBe('class10-science/life-processes/respiration');
  });

  it('closes with time ON TASK, which is what the primary metric divides by', () => {
    const o = endSession(answer(opened(), 1), {
      id: 'end',
      at: '2026-09-12T10:20:00.000Z',
      activeMs: 11 * 60_000,
      completed: true,
    });
    expect(o.session?.activeMs).toBe(660_000);
    expect(o.session?.endedAt).toBe('2026-09-12T10:20:00.000Z');
    const last = o.pending[o.pending.length - 1];
    expect(last.kind).toBe('session-ended');
    expect(last.payload).toMatchObject({ activeMs: 660_000, completed: true });
  });

  it('will not close a session that was never opened', () => {
    const o = endSession(emptyOutbox(), { id: 'e', at: 'now', activeMs: 1, completed: false });
    expect(o.pending).toHaveLength(0);
  });
});

describe('seq', () => {
  it('is gap-free and monotonic, because ordering cannot trust a phone clock', () => {
    let o = opened();
    for (let i = 1; i <= 5; i++) o = answer(o, i);
    expect(o.pending.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps counting across a drain, so a flush cannot renumber a session', () => {
    let o = opened();
    o = answer(o, 1);
    o = acknowledge(o, batch(o).map((e) => e.id));
    o = answer(o, 2);
    // Not 0 again: the server already holds seq 0 and 1 for this session, and a
    // second event claiming seq 0 would collide with it.
    expect(o.pending[0].seq).toBe(2);
  });
});

describe('draining', () => {
  it('acknowledges only what was actually sent', () => {
    let o = opened();
    for (let i = 1; i <= 4; i++) o = answer(o, i);
    const sent = batch(o, 3);
    o = acknowledge(o, sent.map((e) => e.id));
    expect(o.pending).toHaveLength(2);
    expect(o.pending.map((e) => e.seq)).toEqual([3, 4]);
  });

  it('is safe to re-send a batch whose response was lost', () => {
    // The ids are client-minted and are the table's primary key, so replay is a
    // no-op server-side. What must NOT happen is acknowledging optimistically:
    // that is the one mistake here that loses data for good.
    let o = opened();
    o = answer(o, 1);
    const first = batch(o);
    const again = batch(o); // nothing acknowledged in between
    expect(again.map((e) => e.id)).toEqual(first.map((e) => e.id));
    expect(o.pending).toHaveLength(2);
  });

  it('acknowledging nothing changes nothing', () => {
    const o = answer(opened(), 1);
    expect(acknowledge(o, [])).toBe(o);
  });
});

describe('overflow', () => {
  it('drops the oldest and COUNTS it, because a silent loss is a lie', () => {
    let o = opened();
    for (let i = 0; i < MAX_PENDING + 10; i++) o = answer(o, i);
    expect(o.pending).toHaveLength(MAX_PENDING);
    expect(o.dropped).toBe(11); // the 10 over, plus the session-started event
    // Recency survives: the newest event is still there.
    expect(o.pending[o.pending.length - 1].seq).toBe(MAX_PENDING + 10);
  });

  it('does not drop anything below the cap', () => {
    let o = opened();
    for (let i = 0; i < 50; i++) o = answer(o, i);
    expect(o.dropped).toBe(0);
  });
});

describe('purity', () => {
  it('never mutates the outbox it was handed', () => {
    const before = opened();
    const snapshot = JSON.stringify(before);
    answer(before, 1);
    acknowledge(before, [before.pending[0].id]);
    endSession(before, { id: 'e', at: 'now', activeMs: 1, completed: true });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('an answer', () => {
  it('records the rung in force, which is what assisted-vs-unassisted is made of', () => {
    const o = recordAnswer(opened(), {
      id: 'a',
      at: '2026-09-12T10:05:00.000Z',
      surface: 'voice',
      outcomeIds: ['sci10-lp-lactic-acid'],
      correct: true,
      ms: 31_000,
      attempt: 3,
      assistanceRung: 4,
      hintsShown: 2,
      verdict: 'right',
      misconceptionId: 'thinks-cramp-is-oxygen-debt',
      answerNormalised: 'lactic acid banta hai',
    });
    const e = o.pending[1];
    expect(e.kind).toBe('answered');
    expect(e.payload).toMatchObject({
      correct: true,
      attempt: 3,
      assistanceRung: 4,
      hintsShown: 2,
      verdict: 'right',
    });
    // The distinction the old counter could not make: correct, but only after
    // help — which must not count as mastery.
    expect((e.payload as { assistanceRung: number }).assistanceRung).toBeGreaterThan(0);
  });
});
