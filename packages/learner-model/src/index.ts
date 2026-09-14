/**
 * THE LEARNER MODEL — what we believe about a student, per outcome.
 *
 * Pure by construction: no I/O, no clock, no randomness. Every event carries
 * its own `at`, so the same events always rebuild the same model and a session
 * can be replayed to prove it. That is the difference between a record and a
 * log, and every phase after this one reads it as ground truth.
 */

export {
  MODEL_VERSION,
  emptyConceptState,
  emptyModel,
  type ConceptState,
  type LearnerModel,
} from './types.ts';

export { evidenceSet, masteryView } from './project.ts';
