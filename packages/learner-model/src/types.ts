import { PRIOR } from '@ai-tutor/knowledge-graph';

/**
 * WHAT WE BELIEVE ABOUT ONE OUTCOME, FOR ONE STUDENT.
 *
 * This replaces `Mastery = Record<string, number>` as the STORE. A bare float
 * cannot hold a date, which is why `decayMastery` has been correct and
 * uncallable for weeks, and it cannot say whether the student did it alone —
 * which is the only question that separates mastery from a hint well taken.
 *
 * Every field here is a fact the counters it replaces threw away at the moment
 * it happened.
 */
export interface ConceptState {
  outcomeId: string;

  /** All evidence, assisted or not. What the tutor's prose reads. */
  mastery: number;
  /** Rung 0 only. The number that means they can do it without us. */
  unassistedMastery: number;
  /** How they perform WITH help. High here and low above is the signal. */
  assistedPerformance: number;

  /**
   * EVIDENCE events folded into this outcome: answers and attendance.
   *
   * A raised hand is NOT one, and is counted in `doubtCount` instead. That is
   * applyDoubt's own stated principle (mastery.ts:250-252) — "a hand is a nudge
   * rather than a verdict, and a student who asks a lot must never be modelled
   * as a student who knows nothing". Counting it here would let one raised hand
   * put an otherwise-untouched outcome on the remedial plan at confidence 0.61,
   * because `evidenceSet` reads this field to decide what may become a gap.
   */
  observations: number;
  /** Raised hands. Moves belief; never entitles the outcome to become a gap. */
  doubtCount: number;
  /**
   * Rung-0 answers only, counted apart — because without it "unassisted
   * mastery 0.5" and "nobody has ever asked them cold" are the same number,
   * and they are not the same fact. Every read of `unassistedMastery` must
   * check this first.
   */
  unassistedObservations: number;
  /**
   * How many times this outcome has been TAUGHT. `applyTaught` saturates on
   * this count, so it has to be durable rather than per-session: the placement
   * screen applies attendance twice today (Diagnostic.tsx:102-105) precisely
   * because nothing held it across sittings, and attendance alone can carry a
   * node from the prior to nearly settled on zero answered questions.
   */
  taughtCount: number;

  lastPracticedAt: string | null;
  lastUnassistedSuccessAt: string | null;

  /**
   * WRITTEN FROM DAY ONE AND NOT DRIVEN UNTIL PHASE 6. Present so that turning
   * spaced retrieval on is wiring rather than a migration across a table
   * holding every student's beliefs.
   */
  memoryStrength: number;
  nextReviewAt: string | null;
  retrievalCount: number;
  retrievalAccuracy: number;
}

/** Bumped whenever `ConceptState` changes shape, so a stored model can migrate. */
export const MODEL_VERSION = 1;

/**
 * HOW FAR THE FOLD HAS CONSUMED A STUDENT'S HISTORY.
 *
 * `(learning_session.started_at, sessionId, seq)`, in that order. Three parts
 * and each earns its place:
 *
 *   * `at` is the SESSION'S started_at — a server clock — and NOT the event's
 *     own `at`, which is the phone's. The ledger says so itself
 *     (packages/ledger/src/types.ts:102-108): "Ordering must not depend on
 *     `at`, because `at` is a phone's clock and phones lie." An earlier draft
 *     of this used the event clock, and a single NTP correction mid-session
 *     then put the rest of that session permanently behind the cursor — lost
 *     for the student's whole life, and not recoverable by a rebuild, because
 *     the rebuild replays the same events and re-poisons the same cursor.
 *   * `sessionId` breaks a tie between two sittings that began in the same
 *     millisecond, which `seq` cannot: `seq` restarts at 0 per session.
 *   * `seq` orders within one session, which is the only thing it can do.
 */
export interface FoldCursor {
  at: string;
  sessionId: string;
  seq: number;
}

export interface LearnerModel {
  states: Record<string, ConceptState>;
  /**
   * Makes a fold both incremental AND idempotent: an event at or behind this is
   * skipped, so a retried request cannot count one quiz twice.
   */
  foldedThrough: FoldCursor | null;
  /**
   * THE HELP ALREADY HANDED OVER IN THE SESSION BEING FOLDED, per ask.
   *
   * This is the only piece of in-flight state the model carries, and it is here
   * rather than in a local because THE DEVICE FOLDS A SESSION IN MANY CALLS —
   * one per event as it happens. Held in a local, a `helped` folded in one call
   * was invisible to the answer folded in the next, and the answer was then
   * scored as unassisted. That failure manufactures mastery a child does not
   * have, which `deriveRung` names as the one error nothing downstream can
   * correct.
   *
   * Dropped when a different session starts: help is a fact about one sitting.
   */
  helpInFlight: { sessionId: string; byAsk: Record<string, number> } | null;
  version: number;
}

/**
 * `PRIOR` is imported rather than re-declared. Two priors that can drift is
 * exactly the defect class this repo keeps finding, and a state seeded from a
 * different prior than `initialMastery` uses would be invisible until a
 * student's beliefs disagreed with their own study plan.
 */
export const emptyConceptState = (outcomeId: string): ConceptState => ({
  outcomeId,
  mastery: PRIOR,
  unassistedMastery: PRIOR,
  assistedPerformance: PRIOR,
  observations: 0,
  doubtCount: 0,
  unassistedObservations: 0,
  taughtCount: 0,
  lastPracticedAt: null,
  lastUnassistedSuccessAt: null,
  memoryStrength: 0,
  nextReviewAt: null,
  retrievalCount: 0,
  retrievalAccuracy: 0,
});

export const emptyModel = (): LearnerModel => ({
  states: {},
  foldedThrough: null,
  helpInFlight: null,
  version: MODEL_VERSION,
});
