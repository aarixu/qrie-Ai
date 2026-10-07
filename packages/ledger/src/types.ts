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
// The last four are the school's (0021): homework, tests, practice, and a
// partner's API. The database check lists the same eight.
export type EventSource = 'class' | 'quiz' | 'diagnostic' | 'doubt' | 'homework' | 'test' | 'practice' | 'api';

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

/**
 * What the close made of the REASONING behind an answer that was already right.
 *
 * Three states and not a boolean, because saying nothing is not the same as
 * reasoning that wobbled: one is a student who tried to justify and could not,
 * the other is a student who did not try. Collapsing them would hide the
 * commonest outcome of a cross-question inside the rarest.
 */
export type ReasoningVerdict =
  /** They justified it. The only evidence of mastery-over-recall we ever get. */
  | 'held'
  /** They tried and it did not stand up. */
  | 'wobbled'
  /**
   * No words came back.
   *
   * NOT evidence against them, which this used to claim by analogy to a
   * skipped question. A skip is a deliberate tap; this is a grace window
   * expiring, and at this layer a child still thinking, a noisy room and a mic
   * the OS took away are the same signal. Replay gives it its own counter and
   * moves no belief with it — see `silentOnProbe` in replay.ts.
   */
  | 'silent';

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
  /**
   * HOW she helped (H5): the ladder step — 'rethink', 'followUp', 'hint',
   * 'workedExample', 'reveal', 'nudge' — or, for another explanation, its
   * mode ('analogy', 'everyday', 'visual', 'steps'); 'doubt' for a hand raised
   * on a held question, and 'judge-hint' / 'judge-question' for help the
   * spoken-answer judge gave. A tag for measuring which ways of helping work
   * across ALL students, never a per-student judgement. Absent on events
   * written before 2026-09-29.
   */
  strategy?: string;
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
  /**
   * What kind of error the controller believed it was answering, if any.
   * Written by `@ai-tutor/tutor-control`, which today knows only 'none' and
   * 'unclassified': TD2's five classes wait for the diagnosis (D5), and a cause
   * nobody observed must not be written into a child's record as if it were.
   */
  errorClass?: string;
}

/**
 * A CROSS-QUESTION, AND WHAT CAME BACK.
 *
 * A right answer is not the exit: she asks one why/how/when about the
 * student's OWN answer, they reason out loud, and `resolveCrossQuestion`
 * weighs it. That reasoning is the only evidence this system ever gathers
 * about whether a student can JUSTIFY what they know rather than merely
 * produce it — the difference between mastery and recall, and what the brief's
 * metacognition section is built on. It is spoken, screened, sent to a model,
 * and then dropped on the floor, because this payload had no emitter and no
 * shape worth emitting.
 *
 * What it used to carry says why: `prompt`, a `selfRating` nothing in the
 * product ever asks a student for, and `answerNormalised` — which names the
 * answer being reflected ON rather than the reasoning, so the one call site
 * this will ever have would have filed the answer a second time and the
 * reasoning not at all. A reflection also carried no timing, no attempt and no
 * rung, so a justification earned after four hints and a cold one were the
 * same row.
 */
export interface ReflectedPayload {
  /** Which question was cross-questioned. */
  beatId?: string;
  probeId?: string;
  /**
   * Her cross-question, verbatim.
   *
   * Composed at runtime about THEIR words, so unlike a probe it exists nowhere
   * else — not in the bank, not in the lesson. Without it the stored reasoning
   * is an answer to a question nobody kept, and unreadable by anyone checking
   * whether the close weighed it fairly.
   */
  prompt: string;
  /** Which try at the underlying question produced the answer she asked about. */
  attempt: number;
  /**
   * The rung in force on that answer.
   *
   * Reasoning that holds after a hint is not proof of unassisted mastery, and
   * a reflection that did not carry this would be read as if it were — the
   * same hole the assistance ladder exists to close on `answered`.
   */
  assistanceRung: AssistanceRung;
  /**
   * WHETHER IT HELD, which the model already decides and is never asked to say.
   *
   * `CLOSE_SYSTEM` branches on it in so many words — "if their reasoning
   * holds, name what it proves" against "if it wobbles, or they said nothing,
   * give the why yourself" — and then returns only the sentence she speaks.
   * That is exactly how `gave` was lost until a hinted answer turned out to be
   * filing itself as unassisted.
   *
   * Optional because absent means NOBODY WEIGHED IT, and replay moves no
   * belief on an unweighed reflection. It is not a synonym for 'wobbled'.
   */
  reasoningVerdict?: ReasoningVerdict;
  /**
   * Their reasoning, trimmed and capped. Built only by `normaliseAnswer`, from
   * the SCREENED words and never the raw transcript — the close screens before
   * it sends, and a caller reaching for the variable it screened is how a
   * phone number a child should not have said ends up in a column.
   */
  reasoningNormalised?: string;
  /**
   * From her cross-question landing to their reasoning landing.
   *
   * Timed the same way an answer is, and worth as much: how long a student
   * takes to justify something they already got right is the metacognitive
   * signal, and a reflection with no clock on it is an anecdote.
   */
  ms: number;
}

export interface LearningSession {
  id: string;
  source: EventSource;
  topicRef?: string;
  startedAt: string;
  endedAt?: string;
  activeMs?: number;
}
