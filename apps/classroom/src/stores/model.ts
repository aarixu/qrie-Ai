import {
  emptyParams,
  observationsFrom,
  train,
  type Answer,
  type GraphIndex,
  type Mastery,
  type ModelParams,
} from '@ai-tutor/knowledge-graph';
import { createLocalStore } from './localStore';

/**
 * THE MODEL'S OWN MEMORY — what this install has learned from this student.
 *
 * The Learning Outcome Map ships as a set of assertions: an LLM proposed every
 * node, every prerequisite edge and every question's difficulty, and not one of
 * them has met a student. This store is where that starts to change. Every
 * finished placement test and practice quiz is folded in, and the engine's
 * trust in individual questions and edges moves accordingly.
 *
 * ONE STUDENT'S WORTH, and that is the honest limit of it. Slip and guess want
 * hundreds of answers across many students before they mean much; here they
 * will mostly still be the priors, shrinkage will hold them there, and that is
 * correct behaviour rather than a failure. What this buys today is the shape:
 * the moment there is a backend, the same `train` runs over everyone's answers
 * and the numbers become real without a line of this changing.
 *
 * It carries no identity — item ids, node ids, and what happened. There is
 * nothing in here that says who, which is what makes it safe to send onward.
 */

export const modelStore = createLocalStore<ModelParams>('ai-tutor:model', emptyParams());

export interface TrainInput {
  index: GraphIndex;
  answers: readonly Answer[];
  /**
   * Beliefs as they stood at the START of the session. Using the end state
   * would let every answer calibrate its own question with knowledge derived
   * from that answer, and every item would look perfectly behaved.
   */
  beliefsBefore: Mastery;
  /** Beliefs at the end — what the edge check reads. */
  beliefsAfter: Mastery;
}

/**
 * One training step, run when a session ends.
 *
 * Deliberately synchronous and tiny: it is counting, not fitting, so it costs
 * a few milliseconds on a mid-range phone and needs no job, queue or server.
 */
export function trainOnSession({ index, answers, beliefsBefore, beliefsAfter }: TrainInput): void {
  const observations = observationsFrom(answers, beliefsBefore);
  if (observations.length === 0) return;
  modelStore.update((params) =>
    train(params, index, observations, beliefsAfter, { now: new Date().toISOString() }),
  );
}
