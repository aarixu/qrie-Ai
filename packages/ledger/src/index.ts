/**
 * @ai-tutor/ledger — the append-only record of what a student actually did.
 *
 * Pure: no clock, no storage, no network. The device supplies ids and
 * timestamps, an adapter drains the outbox, and this package only decides what
 * a well-formed event is and what may be kept of a child's own words.
 */
export type {
  AssistanceRung,
  EventKind,
  EventPayload,
  EventSource,
  EventSurface,
  LearningSession,
  LedgerEvent,
  Verdict,
  SessionStartedPayload,
  SessionEndedPayload,
  AskedPayload,
  AnsweredPayload,
  HelpedPayload,
  TaughtPayload,
  ConfusedPayload,
  IntervenedPayload,
  ReflectedPayload,
} from './types.ts';

export { MAX_ANSWER_CHARS, normaliseAnswer, type NormaliseOptions } from './normalise.ts';

export { emptyCounters, replayCounters, type Counters } from './replay.ts';

export {
  MAX_PENDING,
  emptyOutbox,
  record,
  recordAnswer,
  startSession,
  endSession,
  batch,
  acknowledge,
  type Outbox,
  type RecordInput,
  type AnswerInput,
  type StartSessionInput,
  type EndSessionInput,
} from './outbox.ts';
