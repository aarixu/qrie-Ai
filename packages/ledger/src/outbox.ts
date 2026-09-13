/**
 * THE OUTBOX.
 *
 * A class has to run with no signal — that is most of how a class gets taken
 * here — so events are queued on the device and drained when there is a
 * network. Every function is pure and returns a new outbox; ids and timestamps
 * are handed in rather than generated, because an outbox that minted its own
 * could not be replayed and replay is the only real test of a ledger.
 *
 * The drain is deliberately NOT here. Sending is I/O and belongs in an adapter,
 * the same way every other external dependency in this repo sits behind one.
 */
import type {
  AssistanceRung,
  EventKind,
  EventPayload,
  EventSource,
  EventSurface,
  LearningSession,
  LedgerEvent,
  SessionEndedPayload,
} from './types.ts';

/**
 * About fifty offline classes' worth. High enough that a student on a long
 * stretch with no signal never reaches it; finite because this lives in
 * localStorage, which has a quota, and a store that silently fails to write is
 * a store that lies.
 */
export const MAX_PENDING = 5_000;

export interface Outbox {
  session: LearningSession | null;
  nextSeq: number;
  pending: LedgerEvent[];
  /**
   * How many events the cap has discarded, ever.
   *
   * Losing events is bad and losing them QUIETLY is worse — the whole point of
   * this table is that the record is trustworthy, so an outbox that overflowed
   * must be able to say so. Anything reading a learner model built from a
   * ledger with a non-zero count here knows it is reading an incomplete story.
   */
  dropped: number;
  /**
   * How many events the SERVER refused outright, ever.
   *
   * A different failure from `dropped` and a more alarming one: `dropped`
   * means this device recorded more than it could hold, `rejected` means it
   * recorded something malformed. One is a busy student, the other is a bug in
   * us, and a single number covering both would hide the second inside the
   * first.
   *
   * It exists because a malformed event used to be unsurvivable. The drain
   * sends a batch in one statement, so one row Postgres refuses fails all two
   * hundred, the outbox is left untouched, and the next drain sends the same
   * poisoned batch — forever. Quarantining costs one event; not quarantining
   * cost every event the device would ever record.
   */
  rejected: number;
  /**
   * WHOSE EVENTS THESE ARE.
   *
   * Null until the device has drained under an identity at least once, which
   * is ordinary: a class runs before anyone signs in, and those events belong
   * to whoever the account turns out to be.
   *
   * After that it is a fence. The drain stamps `user_id` at SEND time, not at
   * record time, so without this a queue left behind by one student is
   * uploaded as the next student's work — on a shared phone, on a school
   * tablet, and after 'Delete your account', which signs out and leaves the
   * queue standing. The upgrade from anonymous to email keeps the same id, so
   * that path is untouched, which is the one that had to keep working.
   */
  ownerId: string | null;
}

export const emptyOutbox = (): Outbox => ({
  session: null,
  nextSeq: 0,
  pending: [],
  dropped: 0,
  rejected: 0,
  ownerId: null,
});

export interface RecordInput {
  /** Minted by the caller, at the moment the event happened. */
  id: string;
  at: string;
  kind: EventKind;
  surface: EventSurface;
  outcomeIds?: string[];
  topicRef?: string;
  payload: EventPayload;
}

/** Queue one event against the open session. */
export function record(outbox: Outbox, input: RecordInput): Outbox {
  if (!outbox.session) {
    // An event with no session cannot be ordered, replayed or attributed to a
    // sitting. Dropping it loudly beats inventing a session to hold it.
    return outbox;
  }
  const event: LedgerEvent = {
    id: input.id,
    sessionId: outbox.session.id,
    seq: outbox.nextSeq,
    at: input.at,
    kind: input.kind,
    source: outbox.session.source,
    surface: input.surface,
    outcomeIds: input.outcomeIds ?? [],
    topicRef: input.topicRef ?? outbox.session.topicRef,
    payload: input.payload,
  };
  return push({ ...outbox, nextSeq: outbox.nextSeq + 1 }, event);
}

function push(outbox: Outbox, event: LedgerEvent): Outbox {
  const pending = [...outbox.pending, event];
  if (pending.length <= MAX_PENDING) return { ...outbox, pending };
  const overflow = pending.length - MAX_PENDING;
  // Oldest first. Recent evidence describes the student they are now, and a
  // partial recent picture is worth more than a partial ancient one.
  return { ...outbox, pending: pending.slice(overflow), dropped: outbox.dropped + overflow };
}

export interface StartSessionInput {
  /** The sitting's own id. Becomes `session_id` on every event in it. */
  id: string;
  /**
   * The session-started event's own id, minted by the caller like every other.
   *
   * This was DERIVED as `${id}:0` until it was measured against the real
   * database. `ledger_event.id` is a `uuid` column; `<uuid>:0` is not a uuid;
   * Postgres refuses the whole multi-row insert with 22P02. Since this event
   * opens every sitting and the outbox drains oldest-first, it sat at the head
   * of every batch forever — so not one event any student ever produced
   * reached the table, on any device, for the life of the install.
   *
   * Two suites were green over it: the drain's test mocks the write and
   * asserts the ids it queued are the ids it sent, and the live test against
   * the real database hand-mints its own row and never calls this function.
   * Neither ever looked at the SHAPE of an id. `idsAreUuids` in the tests
   * beside this file now does, and the live test drives this path.
   */
  eventId: string;
  at: string;
  source: EventSource;
  topicRef?: string;
  surface?: EventSurface;
  lessonId?: string;
}

export function startSession(outbox: Outbox, input: StartSessionInput): Outbox {
  const session: LearningSession = {
    id: input.id,
    source: input.source,
    topicRef: input.topicRef,
    startedAt: input.at,
  };
  const opened: Outbox = { ...outbox, session, nextSeq: 0 };
  return record(opened, {
    id: input.eventId,
    at: input.at,
    kind: 'session-started',
    surface: input.surface ?? 'tap',
    topicRef: input.topicRef,
    payload: { lessonId: input.lessonId },
  });
}

export interface EndSessionInput {
  id: string;
  at: string;
  activeMs: number;
  completed: boolean;
  surface?: EventSurface;
}

export function endSession(outbox: Outbox, input: EndSessionInput): Outbox {
  if (!outbox.session) return outbox;
  const payload: SessionEndedPayload = { activeMs: input.activeMs, completed: input.completed };
  const closed = record(outbox, {
    id: input.id,
    at: input.at,
    kind: 'session-ended',
    surface: input.surface ?? 'tap',
    payload,
  });
  return {
    ...closed,
    session: { ...outbox.session, endedAt: input.at, activeMs: input.activeMs },
  };
}

/**
 * The next slice to send. Ordered, because a drain that shuffled a session
 * would defeat `seq`.
 */
export function batch(outbox: Outbox, max = 200): LedgerEvent[] {
  return outbox.pending.slice(0, max);
}

/**
 * Forget what the server has confirmed.
 *
 * Called only after a successful write. Because the ids are client-minted and
 * the table's primary key is that id, a batch that was actually received but
 * whose response was lost is safe to send again — the second insert is a no-op.
 * Acknowledging optimistically is the one mistake here that loses data for good.
 */
export function acknowledge(outbox: Outbox, ids: readonly string[]): Outbox {
  if (ids.length === 0) return outbox;
  const done = new Set(ids);
  return { ...outbox, pending: outbox.pending.filter((e) => !done.has(e.id)) };
}

/**
 * Hand the device to whoever is signed in now.
 *
 * Three outcomes, and only the third does anything: an unclaimed outbox is
 * claimed, an outbox already theirs is left exactly as it is, and an outbox
 * belonging to somebody else is EMPTIED rather than uploaded under the new
 * name. The counters survive, because they describe the device.
 *
 * Losing those events is a real loss and it is the lesser one. They are a
 * student's answers, and the alternative is filing them as a different
 * student's answers — which corrupts two learner models instead of one, and
 * puts one child's words in another child's record.
 */
export function claim(outbox: Outbox, ownerId: string): { outbox: Outbox; handedOver: number } {
  if (outbox.ownerId === ownerId) return { outbox, handedOver: 0 };
  if (outbox.ownerId === null) return { outbox: { ...outbox, ownerId }, handedOver: 0 };
  return {
    outbox: { ...emptyOutbox(), ownerId, dropped: outbox.dropped, rejected: outbox.rejected },
    handedOver: outbox.pending.length,
  };
}

/**
 * Give up on events the server will never accept.
 *
 * The counterpart to `acknowledge`, and the harder call: these events are
 * dropped WITHOUT having been stored. It is the right call all the same,
 * because the alternative is what this repo actually shipped — a row Postgres
 * refuses stays at the head of a batch that is sent as one statement, so the
 * refusal takes all two hundred rows with it and every drain after it, on that
 * device, for good.
 *
 * The caller must have established that the refusal is about the ROW and not
 * about the moment: an expired token, an RLS decision or a dead network are
 * all reasons to keep the event and try later. Only a malformed row belongs
 * here, and the count is kept so a learner model built on this ledger can know
 * it is reading an incomplete story.
 */
export function quarantine(outbox: Outbox, ids: readonly string[]): Outbox {
  if (ids.length === 0) return outbox;
  const bad = new Set(ids);
  const pending = outbox.pending.filter((e) => !bad.has(e.id));
  return {
    ...outbox,
    pending,
    rejected: outbox.rejected + (outbox.pending.length - pending.length),
  };
}

/** Convenience for the common case: an answer, with its rung recorded. */
export interface AnswerInput {
  id: string;
  at: string;
  surface: EventSurface;
  outcomeIds: string[];
  correct: boolean;
  ms: number;
  attempt: number;
  assistanceRung: AssistanceRung;
  hintsShown: number;
  probeId?: string;
  beatId?: string;
  chosenIndex?: number | null;
  verdict?: 'right' | 'wrong' | 'unclear';
  misconceptionId?: string;
  answerNormalised?: string;
  topicRef?: string;
}

export function recordAnswer(outbox: Outbox, input: AnswerInput): Outbox {
  return record(outbox, {
    id: input.id,
    at: input.at,
    kind: 'answered',
    surface: input.surface,
    outcomeIds: input.outcomeIds,
    topicRef: input.topicRef,
    payload: {
      probeId: input.probeId,
      beatId: input.beatId,
      chosenIndex: input.chosenIndex,
      correct: input.correct,
      ms: input.ms,
      attempt: input.attempt,
      assistanceRung: input.assistanceRung,
      hintsShown: input.hintsShown,
      verdict: input.verdict,
      misconceptionId: input.misconceptionId,
      answerNormalised: input.answerNormalised,
    },
  });
}
