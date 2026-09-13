import { describe, expect, it } from 'vitest';
import {
  MAX_PENDING,
  acknowledge,
  batch,
  claim,
  emptyOutbox,
  endSession,
  quarantine,
  record,
  recordAnswer,
  recordReflection,
  startSession,
  type Outbox,
  type ReflectionInput,
} from '../src/outbox';

/**
 * The outbox exists so a class can run with no signal and still be remembered.
 * These tests are about the two ways that goes wrong: losing an event, and
 * counting one twice.
 */

const opened = (): Outbox =>
  startSession(emptyOutbox(), {
    id: 'sess-1',
    eventId: 'ev-open-1',
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

  it('will not close the same sitting twice, because that doubles its minutes', () => {
    const once = endSession(answer(opened(), 1), {
      id: 'end-1',
      at: '2026-09-12T10:20:00.000Z',
      activeMs: 600_000,
      completed: false,
    });
    const twice = endSession(once, {
      id: 'end-2',
      at: '2026-09-12T10:30:00.000Z',
      activeMs: 1_200_000,
      completed: true,
    });

    // A second session-ended would put the sitting's minutes into the
    // denominator of every per-learning-minute figure twice, and overwrite the
    // activeMs of a sitting that has already been reported.
    expect(twice.pending.filter((e) => e.kind === 'session-ended')).toHaveLength(1);
    expect(twice.session?.activeMs).toBe(600_000);
    expect(twice.session?.endedAt).toBe('2026-09-12T10:20:00.000Z');
  });

  it('refuses an event that arrives after its sitting ended, rather than filing it past the end', () => {
    // The student speaks, the tab goes hidden while the judge round-trips, and
    // the backgrounding closes the sitting. `endSession` keeps the session
    // object so the finished sitting can still be described, which made the
    // close invisible to `record` — so the answer landed at a seq past its own
    // session's end marker, under an active_ms that can never include the
    // seconds that produced it. The caller's job is to open a new sitting;
    // this is what makes forgetting to do so loud rather than silent.
    const ended = endSession(answer(opened(), 1), {
      id: 'end-1',
      at: '2026-09-12T10:20:00.000Z',
      activeMs: 600_000,
      completed: false,
    });
    const after = answer(ended, 2);

    expect(after.pending.map((e) => e.id)).toEqual(['ev-open-1', 'a1', 'end-1']);
    expect(after.orphaned).toBe(1);
    // Not `dropped`: that means the device recorded more than it could hold,
    // which is a busy student. This is a bug in us, and one number covering
    // both would hide the second inside the first.
    expect(after.dropped).toBe(0);
  });

  it('counts a homeless event too, because losing one quietly is the thing to avoid', () => {
    const o = answer(emptyOutbox(), 1);
    expect(o.pending).toHaveLength(0);
    expect(o.orphaned).toBe(1);
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

/**
 * THE HALF OF THE EXCHANGE THAT WAS BEING THROWN AWAY.
 *
 * A right answer is not the exit: she cross-questions it, the student reasons
 * aloud, the close weighs that reasoning — and every word of it was spoken,
 * screened, sent to a model and discarded, because `reflected` was a kind with
 * a payload and no emitter. It is the only evidence this product gathers about
 * whether a student can JUSTIFY an answer rather than merely produce one.
 */
describe('a reflection', () => {
  const reflect = (o: Outbox, over: Partial<ReflectionInput> = {}): Outbox =>
    recordReflection(o, {
      id: 'r1',
      at: '2026-09-12T10:06:00.000Z',
      surface: 'voice',
      outcomeIds: ['sci10-lp-lactic-acid'],
      beatId: 'equation',
      prompt: 'Why does the muscle need to do that without oxygen?',
      ms: 9_400,
      attempt: 1,
      assistanceRung: 0,
      reasoningVerdict: 'held',
      reasoningNormalised: 'kyunki oxygen nahi pahunch rahi thi',
      ...over,
    });

  it('keeps the question she invented, which exists in no probe bank', () => {
    // It is composed at runtime about the student's OWN answer. Nothing else
    // holds it, so a reflection without it is an answer to a lost question.
    const e = reflect(opened()).pending[1];
    expect(e.kind).toBe('reflected');
    expect(e.payload).toMatchObject({
      prompt: 'Why does the muscle need to do that without oxygen?',
      reasoningNormalised: 'kyunki oxygen nahi pahunch rahi thi',
      reasoningVerdict: 'held',
      ms: 9_400,
    });
  });

  it('carries the rung the answer was given at, so justification after help is not read as mastery', () => {
    // The reflection is about an answer that was already right. Whether that
    // answer was unassisted is the whole question, and a reflection that did
    // not carry the rung would be read as proof of the one rung — 0 — that the
    // learner model treats as mastery.
    const e = reflect(opened(), { assistanceRung: 4, attempt: 3 }).pending[1];
    expect(e.payload).toMatchObject({ assistanceRung: 4, attempt: 3 });
  });

  it('records saying nothing as a verdict rather than as a missing one', () => {
    // The close is told to handle "if it wobbles, OR THEY SAID NOTHING". The
    // two are different students and the payload must be able to tell them
    // apart; silence with no words kept is still evidence.
    const e = reflect(opened(), {
      reasoningVerdict: 'silent',
      reasoningNormalised: undefined,
    }).pending[1];
    expect(e.payload).toMatchObject({ reasoningVerdict: 'silent' });
    expect((e.payload as { reasoningNormalised?: string }).reasoningNormalised).toBeUndefined();
  });

  it('is a second event about the question and never an amendment to the answer', () => {
    // The table is append-only and the answer has usually been drained by the
    // time the student finishes reasoning. Filing the reflection as another
    // `answered` would count one right answer twice in every counter.
    const o = reflect(answer(opened(), 1));
    expect(o.pending.map((e) => e.kind)).toEqual(['session-started', 'answered', 'reflected']);
    expect(o.pending.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('is dropped when no session is open, like every other event', () => {
    // An event with no session cannot be ordered, replayed or attributed to a
    // sitting — and a reflection is the easiest one to emit late, after the
    // class has closed the sitting on a spoken close that arrived seconds
    // after the student left.
    const o = reflect(emptyOutbox());
    expect(o.pending).toHaveLength(0);
    expect(o.session).toBeNull();
  });

  it('never mutates the outbox it was handed', () => {
    const before = opened();
    const snapshot = JSON.stringify(before);
    reflect(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

/**
 * THE SHAPE OF AN ID, WHICH NOTHING HERE USED TO LOOK AT.
 *
 * `ledger_event.id` and `session_id` are `uuid` columns. The outbox used to
 * derive the opening event's id as `${sessionId}:0`, which Postgres refuses
 * with 22P02 — and because that event opens every sitting and a batch is sent
 * as one statement, the refusal took every other event with it, on every
 * drain, forever. The drain's own suite was green throughout: it mocks the
 * write and asserts the ids it queued are the ids it sent, which is true of a
 * broken id too.
 */
describe('the ids the outbox puts on the wire', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('are whatever the caller minted, and nothing derived from them', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const eventId = '22222222-2222-4222-8222-222222222222';
    const o = startSession(emptyOutbox(), {
      id: sessionId,
      eventId,
      at: '2026-09-12T10:00:00.000Z',
      source: 'class',
    });
    expect(o.pending[0].id).toBe(eventId);
    expect(o.pending[0].sessionId).toBe(sessionId);
    // The specific thing that was shipped.
    expect(o.pending[0].id).not.toContain(':');
  });

  it('are all uuids through a whole sitting, when uuids go in', () => {
    const id = (): string => crypto.randomUUID();
    const sessionId = id();
    let o = startSession(emptyOutbox(), {
      id: sessionId,
      eventId: id(),
      at: '2026-09-12T10:00:00.000Z',
      source: 'class',
    });
    o = record(o, { id: id(), at: '2026-09-12T10:00:05.000Z', kind: 'asked', surface: 'tap', payload: {} });
    o = recordAnswer(o, {
      id: id(),
      at: '2026-09-12T10:00:09.000Z',
      surface: 'voice',
      outcomeIds: [],
      correct: true,
      ms: 4000,
      attempt: 1,
      assistanceRung: 0,
      hintsShown: 0,
    });
    o = recordReflection(o, {
      id: id(),
      at: '2026-09-12T10:00:21.000Z',
      surface: 'voice',
      outcomeIds: [],
      prompt: 'And why does that happen?',
      ms: 7000,
      attempt: 1,
      assistanceRung: 0,
      reasoningVerdict: 'held',
    });
    o = endSession(o, { id: id(), at: '2026-09-12T10:04:00.000Z', activeMs: 240_000, completed: true });

    expect(o.pending).toHaveLength(5);
    for (const e of o.pending) {
      expect(e.id, `${e.kind} carries ${e.id}`).toMatch(UUID);
      expect(e.sessionId, `${e.kind} names session ${e.sessionId}`).toMatch(UUID);
    }
  });
});

describe('quarantine', () => {
  it('drops only what the server refused, and says how many', () => {
    let o = answer(answer(opened(), 1), 2);
    expect(o.pending).toHaveLength(3);

    o = quarantine(o, ['a1']);
    expect(o.pending.map((e) => e.id)).toEqual(['ev-open-1', 'a2']);
    expect(o.rejected).toBe(1);
    // The other counter is a different failure and must not move.
    expect(o.dropped).toBe(0);
  });

  it('counts across drains rather than reporting the last one', () => {
    let o = quarantine(answer(answer(opened(), 1), 2), ['a1']);
    o = quarantine(o, ['a2']);
    expect(o.rejected).toBe(2);
    expect(o.pending.map((e) => e.id)).toEqual(['ev-open-1']);
  });

  it('ignores ids it does not hold, so a repeated drain cannot inflate the count', () => {
    const o = quarantine(answer(opened(), 1), ['a1']);
    expect(quarantine(o, ['a1']).rejected).toBe(1);
  });
});

/**
 * WHOSE ANSWERS THESE ARE.
 *
 * The drain stamps `user_id` when it SENDS, not when the event was recorded.
 * On a shared phone that is a hole rather than a detail: a queue left behind
 * by one student is uploaded as the next student's work, which corrupts two
 * learner models and puts one child's words in another child's record.
 */
describe('claim', () => {
  const student = '11111111-1111-4111-8111-111111111111';
  const somebodyElse = '22222222-2222-4222-8222-222222222222';

  it('takes an unclaimed queue without discarding anything', () => {
    const { outbox, handedOver } = claim(answer(opened(), 1), student);
    expect(handedOver).toBe(0);
    expect(outbox.ownerId).toBe(student);
    expect(outbox.pending).toHaveLength(2);
  });

  it('leaves a queue that is already theirs exactly as it is', () => {
    const mine = claim(answer(opened(), 1), student).outbox;
    const again = claim(mine, student);
    expect(again.handedOver).toBe(0);
    expect(again.outbox).toBe(mine);
  });

  /**
   * The upgrade path, which had to keep working: signing up with an email on
   * an anonymous account keeps the SAME user id, so the day of work already in
   * the queue is still theirs and must survive.
   */
  it('does not treat an anonymous student becoming a named one as a handover', () => {
    const before = claim(answer(opened(), 1), student).outbox;
    expect(claim(before, student).handedOver).toBe(0);
    expect(claim(before, student).outbox.pending).toHaveLength(2);
  });

  it('empties a queue belonging to whoever had the device before', () => {
    const theirs = claim(answer(answer(opened(), 1), 2), student).outbox;
    const { outbox, handedOver } = claim(theirs, somebodyElse);
    expect(handedOver).toBe(3);
    expect(outbox.pending).toEqual([]);
    expect(outbox.ownerId).toBe(somebodyElse);
    // Their half-open session goes with them.
    expect(outbox.session).toBeNull();
  });

  it('keeps the counters, because they describe the device and not the student', () => {
    const theirs = {
      ...claim(answer(opened(), 1), student).outbox,
      dropped: 7,
      rejected: 2,
      orphaned: 1,
    };
    const { outbox } = claim(theirs, somebodyElse);
    expect(outbox.dropped).toBe(7);
    expect(outbox.rejected).toBe(2);
    expect(outbox.orphaned).toBe(1);
  });
});
