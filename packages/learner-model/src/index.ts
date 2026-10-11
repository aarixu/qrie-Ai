/**
 * THE LEARNER MODEL — what we believe about a student, per outcome.
 *
 * Pure by construction: no I/O, no clock, no randomness. Every event carries
 * its own `at`, so the same events always rebuild the same model and a session
 * can be replayed to prove it. That is the difference between a record and a
 * log, and every phase after this one reads it as ground truth.
 */

export {
  MASTERY_LINE,
  MASTERY_SPACING_MS,
  MAX_CURSOR_GAPS,
  MODEL_VERSION,
  emptyConceptState,
  emptyModel,
  type ConceptState,
  type FoldCursor,
  type LearnerModel,
} from './types.ts';

// `unassistedView` and `unassistedEvidence` are what decisions read (B6);
// `masteryView` is the blended picture, for display only.
export { evidenceSet, masteryView, unassistedEvidence, unassistedView } from './project.ts';

export { deriveRung } from './rung.ts';

// Task 8: a fold says what it could not fold in order, the phone places a
// sitting where it arrived, and a whole history folds again in order.
export {
  foldHistory,
  foldSession,
  foldSessionReport,
  placeOnArrival,
  type FoldReport,
  type FoldSession,
  type History,
} from './fold.ts';

// v4: the wrong ideas an outcome's answers showed, and which of them are
// confirmed (2+ distinct items or 2+ sittings, not cleared since).
export {
  CLEARING_RIGHTS,
  MISCONCEPTION_LIMITS,
  SIMILAR_LABELS,
  confirmedMisconceptions,
  isConfirmed,
  normaliseMisconception,
  similarMisconceptions,
  type Misconception,
} from './misconception.ts';

export { migrateModel } from './migrate.ts';

export { MAX_REVIEWS, nextActivity, type NextActivity, type NextInput } from './next.ts';

export {
  EXPOSURE_RUNG,
  RETRIEVAL_GAP_MS,
  REVIEW_LADDER_DAYS,
  TOP_BOX,
  isRetrieval,
  reviewAt,
} from './memory.ts';

export { gainPerLearningMinute, unassistedGain } from './metric.ts';

// A basic understanding of one learner, read off the model: secure, needs
// work, only with help, wrong ideas, due for review, and one plain sentence.
export {
  NEEDS_WORK_BELOW,
  WITH_HELP_FROM,
  learnerProfile,
  type LearnerProfile,
  type ProfileOptions,
  type ProfileOutcome,
  type ProfileWrongIdea,
} from './profile.ts';

// The 3.7 projections: pure functions over ledger events, shown only in the
// inspector. Assistance-blended score (ASSISTments), hint abuse, and
// wheel-spinning — the last computable only on the surfaces that ask cold.
export { assistanceScore, defaultCredit } from './assistance.ts';
export { hintAbuse, type HintAbuseOptions } from './hintAbuse.ts';
export {
  wheelSpinning,
  type WheelSpinOptions,
  type WheelSpinReading,
} from './wheelSpin.ts';
