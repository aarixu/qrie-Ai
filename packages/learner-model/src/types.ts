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

  /** Every event folded into this outcome, of any kind. */
  observations: number;
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

export interface LearnerModel {
  states: Record<string, ConceptState>;
  /**
   * How far the fold has consumed this student's history, as
   * `(learning_session.started_at, ledger_event.seq)`. Makes a fold both
   * incremental AND idempotent: an event at or behind the cursor is skipped, so
   * a retried request cannot count one quiz twice.
   */
  foldedThrough: { at: string; seq: number } | null;
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
  version: MODEL_VERSION,
});
