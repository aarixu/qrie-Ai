/**
 * THE INTERACTION LEDGER.
 *
 * One append-only record of everything a student actually did, because the
 * counters it replaces threw away almost all of it. `answeredRight[id] += 1`
 * cannot answer "did they need a hint", "how long did they think", "which wrong
 * idea did they hold", or "how many minutes of learning was that" — and those
 * four questions are what misconception diagnosis, the assisted/unassisted
 * split, spaced retrieval and the primary metric are made of.
 *
 * Nothing here does I/O or reads a clock. A ledger that generated its own ids
 * and timestamps could not be replayed, and replay is the test that says these
 * rows are a record rather than a log: the same events must rebuild the same
 * learner model, every time.
 */

/** What happened. */
export type EventKind =
  /** A sitting began — one class, one quiz, one placement test, one doubt. */
  | 'session-started'
  /** It ended, carrying time ON TASK rather than wall clock. */
  | 'session-ended'
  /** A question was put to the student. */
  | 'asked'
  /** They answered it. The event everything else is built from. */
  | 'answered'
  /** Assistance was given — a rung of the ladder, not merely "a hint". */
  | 'helped'
  /** A beat was taught and sat through. Real evidence, and weak. */
  | 'taught'
  /** A hand went up. The signal no question can produce. */
  | 'confused'
  /** The tutor acted without being asked. */
  | 'intervened'
  /** A metacognitive prompt and what came back. */
  | 'reflected';

/** Which part of the product produced it. */
export type EventSource = 'class' | 'quiz' | 'diagnostic' | 'doubt';

/** How the student was speaking to us when it happened. */
export type EventSurface = 'tap' | 'voice' | 'text';

/**
 * THE ASSISTANCE LADDER, from the product brief.
 *
 * Recorded on every answer as the rung IN FORCE at the moment it was given.
 * This single field is what the assisted-vs-unassisted split is made of, and
 * without it a four-hints-later correct answer and a cold one are the same
 * event — which is exactly how the current system reads them.
 *
 * The class does not yet withhold help at these rungs; it records which rung it
 * was standing on. Measuring first, withholding later, was a deliberate call.
 */
export type AssistanceRung =
  | 0 // left alone
  | 1 // asked to rethink
  | 2 // asked a conceptual question
  | 3 // a small hint
  | 4 // a stronger hint
  | 5 // a worked example of something similar
  | 6 // a partial solution
  | 7 // the full explanation
  | 8; // the answer itself

/** What the judge made of a spoken or written answer. */
export type Verdict = 'right' | 'wrong' | 'unclear';

export interface LedgerEvent {
  /**
   * Minted on the DEVICE when the event happens, not when it is sent. This is
   * the outbox's idempotency key: a drain that dies halfway, a retry over a
   * dead tunnel, an app killed mid-flush — all replay these same ids, and the
   * insert becomes a no-op instead of a second answer inflating mastery.
   */
  id: string;
  sessionId: string;
  /**
   * Monotonic within the session. Ordering must not depend on `at`, because
   * `at` is a phone's clock and phones lie.
   */
  seq: number;
  /** The device's clock. Explicitly untrusted; the server stamps its own. */
  at: string;
  kind: EventKind;
  source: EventSource;
  surface: EventSurface;
  /** LOM node ids this speaks about. Empty is legal — a hook teaches nothing. */
  outcomeIds: string[];
  topicRef?: string;
  payload: EventPayload;
}

export type EventPayload =
  | SessionStartedPayload
  | SessionEndedPayload
  | AskedPayload
  | AnsweredPayload
  | HelpedPayload
  | TaughtPayload
  | ConfusedPayload
  | IntervenedPayload
  | ReflectedPayload;

export interface SessionStartedPayload {
  lessonId?: string;
}

export interface SessionEndedPayload {
  /**
   * Time ON TASK. Not wall clock: a class left open while someone eats dinner
   * is not learning, and the primary metric is per learning MINUTE. If this is
   * wrong the headline number is wrong, and the usual consolation prize for a
   * product that cannot measure learning is that it measures engagement.
   */
  activeMs: number;
  completed: boolean;
}

export interface AskedPayload {
  probeId?: string;
  beatId?: string;
  /** The rung already in force when the question was put. */
  assistanceRung: AssistanceRung;
  /** Which try at THIS question this is. 1 is the first. */
  attempt: number;
  optionCount?: number;
}

export interface AnsweredPayload {
  probeId?: string;
  beatId?: string;
  /** null is a skip, which is weak evidence AGAINST rather than no evidence. */
  chosenIndex?: number | null;
  correct: boolean;
  /** Time from the question surfacing to the answer landing. */
  ms: number;
  attempt: number;
  /** The rung in force AT THE MOMENT OF ANSWERING. */
  assistanceRung: AssistanceRung;
  /** How many rungs had been handed over by then. */
  hintsShown: number;
  verdict?: Verdict;
  /** From the probe bank's named distractors, or the judge's classification. */
  misconceptionId?: string;
  /**
   * A trimmed, collapsed, capped form of what they said or typed. NEVER audio,
   * never free conversation, never a turn the safety screen flagged. Built only
   * by `normaliseAnswer`, which is where those limits are enforced.
   */
  answerNormalised?: string;
}

export interface HelpedPayload {
  beatId?: string;
  probeId?: string;
  rung: AssistanceRung;
  /** Whether the student asked, or the tutor offered. */
  requested: boolean;
}

export interface TaughtPayload {
  beatId?: string;
  lessonId?: string;
}

export interface ConfusedPayload {
  beatId?: string;
  lessonId?: string;
}

export interface IntervenedPayload {
  /** What the controller chose to do. */
  action: string;
  /** Why — logged, never spoken to the student. */
  because: string;
  rung?: AssistanceRung;
}

export interface ReflectedPayload {
  prompt: string;
  /** The student's own confidence, 0..1, when they were asked for it. */
  selfRating?: number;
  answerNormalised?: string;
}

export interface LearningSession {
  id: string;
  source: EventSource;
  topicRef?: string;
  startedAt: string;
  endedAt?: string;
  activeMs?: number;
}
