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
}

export const emptyOutbox = (): Outbox => ({ session: null, nextSeq: 0, pending: [], dropped: 0 });

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
  id: string;
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
    id: `${input.id}:0`,
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
