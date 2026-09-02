import {
  GAP_THRESHOLD,
  GraphIndex,
  applyEvidence,
  gapsFrom,
  type Answer,
  type DiagnosticResult,
  type ModelParams,
  type PlanStep,
} from '@ai-tutor/knowledge-graph';
import { stepsFrom } from './plan';

/**
 * WHAT A TOPIC TEST CHANGES.
 *
 * A class ends, the student answers a few questions about it, and until now
 * the app stored a score — "6 of 8", in a history nothing reads. The map never
 * heard about it. So a student could get every question about the heart wrong
 * and be sent straight on to the next chapter, which is a playlist with a quiz
 * attached rather than a tutor.
 *
 * This is the loop that closes it, and it is the map doing exactly what it was
 * built for: a wrong answer is evidence, evidence moves belief, belief travels
 * along the prerequisite edges, and a belief that falls below the line becomes
 * a class in this student's own plan. Often NOT the class they just failed —
 * a student who cannot divide fractions has usually not lost division, they
 * have lost what a fraction is, and re-teaching division to somebody in that
 * position is the failure this whole product exists to stop.
 *
 * Pure. Same result in, same result out, no clock and no storage.
 */

/**
 * How much a bad test may add at once.
 *
 * A student who has just failed a whole test is already discouraged. Handing
 * them twelve classes is a punishment dressed as a plan; the next one or two
 * is a way back. The full plan cap stays where it was — this is only about how
 * fast it may grow in one go.
 */
export const MAX_NEW_STEPS = 3;

/**
 * How long a plan may get, however many tests are taken.
 *
 * The same number buildPlan uses, and it has to be enforced HERE too: the
 * placement test caps the plan once and then never runs again, so before this
 * the cap survived exactly until the student's first quiz. Six quizzes took a
 * two-step plan to eighteen steps and it kept growing with the map — a wall,
 * which is the thing the cap exists to prevent.
 *
 * The oldest steps win when it is full. A student is halfway down a list they
 * can see; pushing step three off the bottom to make room for something found
 * today is how a plan stops feeling like a plan.
 */
export const MAX_PLAN_STEPS = 12;

export interface AdaptOptions {
  /** Below this belief a node counts as a gap. */
  threshold?: number;
  /** Most steps to add from one test. */
  maxNewSteps?: number;
  /** Most steps the plan may hold in total. */
  maxPlanSteps?: number;
  /**
   * What the model has learned about these items and edges.
   *
   * The placement test has always passed this and the quiz never did, which
   * had it backwards: a topic test is the far more frequent evidence source,
   * so the calibration that knows an edge is untrustworthy was being ignored
   * by almost every piece of evidence the app collects.
   */
  params?: ModelParams;
}

export interface Adapted {
  /** The result to store: new beliefs, new gaps, and the merged plan. */
  after: DiagnosticResult;
  /** Just the steps this test added, so a screen can say what happened. */
  added: PlanStep[];
  /** Steps dropped because the student has now shown they hold them. */
  dropped: PlanStep[];
}

/**
 * Fold a finished test into the student's picture of themselves.
 *
 * The plan is MERGED, never rebuilt. A student is halfway down a list they can
 * see; regenerating it would reshuffle the thing they are working through, and
 * the fact that step three is still step three is most of what makes a plan
 * feel like a plan.
 */
export function learnFromQuiz(
  before: DiagnosticResult,
  answers: readonly Answer[],
  index: GraphIndex,
  options: AdaptOptions = {},
): Adapted {
  const threshold = options.threshold ?? GAP_THRESHOLD;
  const maxNewSteps = options.maxNewSteps ?? MAX_NEW_STEPS;

  // A question about a node the map no longer has is a stored quiz outliving a
  // regenerated map. It is dropped rather than allowed to move belief about
  // something that does not exist.
  const known = answers.filter((a) => index.node(a.nodeId) !== null);

  /**
   * THE SAME ANSWER TO THE SAME QUESTION TWICE IS ONE FACT, NOT TWO.
   *
   * A retry re-asks the identical probes — the quiz is deterministic on
   * purpose, so that a retake is a real retest. Folding an unchanged answer in
   * again compounds belief toward the ceiling: three retries could push a node
   * over the line and have it announced as "you have got this" on the strength
   * of nothing new. It also grew the stored answer list by the whole quiz
   * every time, in a profile that lives in localStorage and has a quota.
   *
   * A CHANGED answer is real news and still counts. Getting it right this time
   * is the thing the retry was for.
   */
  const answeredBefore = new Map(before.answers.map((a) => [a.probeId, a.correct]));
  const usable = known.filter(
    (a) => !answeredBefore.has(a.probeId) || answeredBefore.get(a.probeId) !== a.correct,
  );
  if (usable.length === 0) return { after: before, added: [], dropped: [] };

  /**
   * Directly probed, and therefore outranking anything inferred.
   *
   * The set is built up as the answers are folded in, exactly as a diagnostic
   * session does it: what a student actually answered must not be overwritten
   * by belief propagating from a later question.
   */
  const probed = new Set<string>();
  let mastery = { ...before.mastery };
  for (const answer of usable) {
    mastery = applyEvidence(mastery, index, answer, { probed, params: options.params });
    probed.add(answer.nodeId);
  }

  const gaps = gapsFrom(mastery, index, { threshold });

  /**
   * DROPPED: steps the student has now SHOWN they hold.
   *
   * The other half of adapting. A plan that only ever grows is a list of
   * failures, and taking something off it is the app noticing they fixed it.
   *
   * Only what the test actually asked about, though. Belief travels along the
   * edges, so answering one question well lifts its prerequisites too — but
   * inferred confidence is not the same as having shown it, and a step is not
   * worth removing on an inference.
   */
  const fixed = new Set(
    [...probed].filter((id) => (mastery[id] ?? 0) >= threshold),
  );
  const dropped = before.plan.filter((step) => fixed.has(step.nodeId));
  const kept = before.plan.filter((step) => !fixed.has(step.nodeId));

  /**
   * ADDED: gaps THIS TEST FOUND, and not a single one more.
   *
   * The subtlety that cost a working feature. `gaps` is recomputed over the
   * whole map, and the whole map is mostly gaps — a diagnostic leaves dozens
   * of them outside the twelve steps it had room to schedule. Adding the worst
   * three of those meant a student who answered every question correctly was
   * told "I have added 3 classes to your plan", about topics the test never
   * mentioned. Measured: 100% on a two-step plan added three unrelated nodes.
   *
   * A gap counts as this test's news if it was not a gap before — the wrong
   * answer pushed belief below the line, usually on a prerequisite rather than
   * on the question itself — or if the student was asked about it directly and
   * got it wrong. Everything else is a pre-existing gap the placement test
   * already saw and already decided it had no room for, and an unrelated quiz
   * is not a reason to revisit that.
   */
  const wasAlreadyAGap = new Set(before.gaps.map((gap) => gap.nodeId));
  const gotItWrong = new Set(usable.filter((a) => !a.correct).map((a) => a.nodeId));
  const alreadyThere = new Set(kept.map((step) => step.nodeId));
  const fresh = gaps.filter(
    (gap) =>
      !alreadyThere.has(gap.nodeId) &&
      (!wasAlreadyAGap.has(gap.nodeId) || gotItWrong.has(gap.nodeId)),
  );

  /**
   * `stepsFrom` is the same ordering the placement test's plan gets —
   * prerequisites first, then interleaved — so a foundation is never taught
   * after the thing that rests on it, however the gap was found.
   */
  const proposed = stepsFrom(fresh, index, maxNewSteps);

  /**
   * The plan, capped — and `added` is what SURVIVED the cap.
   *
   * Reporting the proposal instead would put "I have added 3 classes to your
   * plan" on a celebration screen above a plan that grew by none of them,
   * which is the one sentence a student would go looking for and not find.
   */
  const plan = [...kept, ...proposed].slice(0, options.maxPlanSteps ?? MAX_PLAN_STEPS);
  const landed = new Set(plan.map((step) => step.nodeId));
  const added = proposed.filter((step) => landed.has(step.nodeId));

  return {
    after: {
      ...before,
      mastery,
      gaps,
      plan,
      // The answers are kept for the same reason the diagnostic keeps its own:
      // a belief nobody can trace back to a question is a belief nobody can
      // argue with.
      answers: [...before.answers, ...usable],
    },
    added,
    dropped,
  };
}
