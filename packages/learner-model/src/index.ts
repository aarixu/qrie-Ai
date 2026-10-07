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
  MODEL_VERSION,
  emptyConceptState,
  emptyModel,
  type ConceptState,
  type LearnerModel,
} from './types.ts';

// `unassistedView` and `unassistedEvidence` are what decisions read (B6);
// `masteryView` is the blended picture, for display only.
export { evidenceSet, masteryView, unassistedEvidence, unassistedView } from './project.ts';

export { deriveRung } from './rung.ts';

export { foldSession } from './fold.ts';

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

export { chooseAsk, type AskChoice } from './ask.ts';

export { gainPerLearningMinute, unassistedGain } from './metric.ts';

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
