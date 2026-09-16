import type { GraphIndex } from './graph.ts';
import type { Answer, Mastery } from './types.ts';
import { PRIOR } from './types.ts';
import {
  DEFAULT_GUESS,
  DEFAULT_SLIP,
  GUESS_CEILING,
  PARAM_FLOOR,
  SLIP_CEILING,
  edgeKey,
  emptyParams,
  type EdgeParams,
  type ItemParams,
  type ModelParams,
} from './params.ts';

/**
 * SELF-TRAINING — the part of the model that gets better without anyone
 * touching it.
 *
 * Everything the map claims was written before a single student existed: an
 * LLM proposed the nodes, proposed the edges between them, and guessed each
 * question's difficulty. That is a reasonable place to start and a terrible
 * place to stay. This module is how the map stops being a set of assertions
 * and starts being a measurement.
 *
 * It runs on whatever evidence has arrived. No students, no change — the
 * priors stand. A hundred answers and the worst items begin to show. A
 * thousand and the fictional edges are visible. Nothing here needs a training
 * job, a model, or a server: it is counting, and counting is enough, because
 * the quantities we need are frequencies.
 *
 * WHAT IT LEARNS
 *
 *   items  how often each question is answered correctly by students the rest
 *          of the map says should know it, and by students it says should not.
 *          Those two rates ARE slip and guess.
 *
 *   edges  how often "A needs B" survives. A student holding A while missing B
 *          is a violation. Steady violations mean the claim is fiction, and
 *          support falls until inference stops travelling that way.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It never rewrites a node's text, never deletes an edge, and never touches
 * content. It adjusts how much the engine TRUSTS what it was given. A system
 * that silently edits its own curriculum is one nobody can review; a system
 * that reports "this edge has failed 40% of the time" is one an author can act
 * on. Learning what to distrust is the safe half of self-improvement, and it
 * is the half that carries almost all the value.
 */

/**
 * One answer, kept for calibration. This is the raw material — deliberately
 * small, and carrying no identity: what is needed is the item, the node, and
 * what happened, never who it happened to.
 */
export interface Observation {
  probeId: string;
  nodeId: string;
  correct: boolean;
  /**
   * What the rest of the map believed about this node at the moment of the
   * answer, BEFORE the answer was folded in. This is what makes slip and guess
   * separable: an answer alone cannot tell you whether a student was lucky,
   * but an answer from someone the map already expected to know it can.
   */
  priorBelief: number;
  ms?: number;
}

/**
 * How confident the map has to be about a student for their answer to count as
 * evidence about the ITEM rather than about them.
 *
 * Slip is measured on students who should have got it right; guess on students
 * who should have got it wrong. Answers from the uncertain middle say plenty
 * about the student and nothing clean about the question, so they are counted
 * for difficulty and excluded from these two.
 */
const CONFIDENT_HOLD = 0.75;
const CONFIDENT_MISS = 0.25;

/**
 * Empirical-Bayes shrinkage. A parameter estimated from four answers is noise
 * wearing a decimal point, so every estimate is pulled toward its prior by a
 * weight that fades as evidence accumulates: at PSEUDO_COUNT observations the
 * estimate carries half the weight, and the prior the other half.
 *
 * Without this the first student to slip on a question would push that item's
 * slip rate to 1.0, and the item would stop being able to say anything.
 */
const PSEUDO_COUNT = 20;

const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const shrink = (observed: number, n: number, prior: number): number =>
  (observed * n + prior * PSEUDO_COUNT) / (n + PSEUDO_COUNT);

interface ItemTally {
  attempts: number;
  correct: number;
  /** Answers from students the map was confident DID hold the node. */
  holdAttempts: number;
  holdWrong: number;
  /** Answers from students the map was confident did NOT. */
  missAttempts: number;
  missCorrect: number;
}

/** Fold observations into item parameters, starting from what is already known. */
function calibrateItems(
  params: ModelParams,
  observations: readonly Observation[],
): Record<string, ItemParams> {
  const tallies = new Map<string, ItemTally>();
  const tally = (id: string): ItemTally => {
    const found = tallies.get(id);
    if (found) return found;
    const fresh: ItemTally = {
      attempts: 0,
      correct: 0,
      holdAttempts: 0,
      holdWrong: 0,
      missAttempts: 0,
      missCorrect: 0,
    };
    tallies.set(id, fresh);
    return fresh;
  };

  for (const o of observations) {
    const t = tally(o.probeId);
    t.attempts += 1;
    if (o.correct) t.correct += 1;
    if (o.priorBelief >= CONFIDENT_HOLD) {
      t.holdAttempts += 1;
      if (!o.correct) t.holdWrong += 1;
    } else if (o.priorBelief <= CONFIDENT_MISS) {
      t.missAttempts += 1;
      if (o.correct) t.missCorrect += 1;
    }
  }

  const items: Record<string, ItemParams> = { ...params.items };
  for (const [probeId, t] of tallies) {
    const before = params.items[probeId];
    // Counts accumulate across runs; the rates are re-derived each time from
    // this batch's confident answers, shrunk toward the running estimate.
    const attempts = (before?.attempts ?? 0) + t.attempts;
    const correct = (before?.correct ?? 0) + t.correct;

    const slipPrior = before?.slip ?? DEFAULT_SLIP;
    const guessPrior = before?.guess ?? DEFAULT_GUESS;

    items[probeId] = {
      attempts,
      correct,
      slip:
        t.holdAttempts > 0
          ? clampTo(
              shrink(t.holdWrong / t.holdAttempts, t.holdAttempts, slipPrior),
              PARAM_FLOOR,
              SLIP_CEILING,
            )
          : slipPrior,
      guess:
        t.missAttempts > 0
          ? clampTo(
              shrink(t.missCorrect / t.missAttempts, t.missAttempts, guessPrior),
              PARAM_FLOOR,
              GUESS_CEILING,
            )
          : guessPrior,
    };
  }
  return items;
}

/**
 * Test every edge the observed nodes take part in.
 *
 * A violation is a student who demonstrably holds the dependent node while
 * demonstrably missing its prerequisite — which the claim says is impossible.
 * Both ends must be confident: an edge cannot be judged by a student the map
 * has no opinion about.
 */
function calibrateEdges(
  params: ModelParams,
  index: GraphIndex,
  mastery: Mastery,
): Record<string, EdgeParams> {
  const edges: Record<string, EdgeParams> = { ...params.edges };

  for (const nodeId of index.ids()) {
    const holdsNode = mastery[nodeId] ?? PRIOR;
    if (holdsNode < CONFIDENT_HOLD) continue; // only a held node tests its foundations

    for (const prerequisiteId of index.prerequisitesOf(nodeId)) {
      const holdsPrerequisite = mastery[prerequisiteId] ?? PRIOR;
      // The uncertain middle is not evidence either way.
      if (holdsPrerequisite > CONFIDENT_MISS && holdsPrerequisite < CONFIDENT_HOLD) continue;

      const key = edgeKey(nodeId, prerequisiteId);
      const before = edges[key] ?? { support: 1, violations: 0, observations: 0 };
      const violated = holdsPrerequisite <= CONFIDENT_MISS;
      const violations = before.violations + (violated ? 1 : 0);
      const observations = before.observations + 1;

      edges[key] = {
        violations,
        observations,
        // Support is the share that held up, shrunk toward full trust so a
        // handful of odd students cannot condemn an edge.
        support: clampTo(
          shrink(1 - violations / observations, observations, 1),
          PARAM_FLOOR,
          1,
        ),
      };
    }
  }
  return edges;
}

export interface TrainOptions {
  /** ISO timestamp to stamp the run with. Passed in so the result is testable. */
  now?: string;
}

/**
 * ONE TRAINING STEP.
 *
 * Called whenever a student finishes something that produced evidence — a
 * placement test, a practice quiz. Pure and incremental: it takes what the
 * model knew, adds what just happened, and returns what it knows now. There is
 * no batch job to schedule and nothing to retrain from scratch, which is what
 * makes it safe to run on a phone at the end of a quiz.
 */
export function train(
  params: ModelParams,
  index: GraphIndex,
  observations: readonly Observation[],
  mastery: Mastery,
  opts: TrainOptions = {},
): ModelParams {
  if (observations.length === 0) return params;
  return {
    version: 1,
    items: calibrateItems(params, observations),
    edges: calibrateEdges(params, index, mastery),
    updatedAt: opts.now ?? null,
    observations: params.observations + observations.length,
  };
}

/**
 * Turn a finished session's answers into observations.
 *
 * `beliefsBefore` is the belief map as it stood at the START of the session:
 * using the end state would let each answer calibrate the item with knowledge
 * derived from that same answer, and every item would look perfectly behaved.
 */
export function observationsFrom(
  answers: readonly Answer[],
  beliefsBefore: Mastery,
): Observation[] {
  return answers
    .filter((a) => a.chosenIndex !== null) // a skip is not an attempt at the item
    .map((a) => ({
      probeId: a.probeId,
      nodeId: a.nodeId,
      correct: a.correct,
      priorBelief: beliefsBefore[a.nodeId] ?? PRIOR,
      ms: a.ms,
    }));
}

/**
 * The edges students keep contradicting, worst first — the report an author
 * acts on. Nothing is deleted automatically; a human decides whether the edge
 * is wrong or the two nodes are.
 */
export interface SuspectEdge {
  nodeId: string;
  prerequisiteId: string;
  support: number;
  violations: number;
  observations: number;
}

export function suspectEdges(params: ModelParams, minObservations = 10): SuspectEdge[] {
  return Object.entries(params.edges)
    .filter(([, e]) => e.observations >= minObservations && e.support < 0.8)
    .map(([key, e]) => {
      const [nodeId, prerequisiteId] = key.split('<-');
      return { nodeId, prerequisiteId, ...e };
    })
    .sort((a, b) => a.support - b.support);
}

/**
 * The items that are not working, worst first. A question everyone gets right
 * measures nothing; one that confident students keep failing is broken, not
 * hard.
 */
export interface SuspectItem {
  probeId: string;
  reason: 'too-easy' | 'too-hard' | 'high-slip' | 'high-guess';
  passRate: number;
  attempts: number;
}

export function suspectItems(params: ModelParams, minAttempts = 20): SuspectItem[] {
  const out: SuspectItem[] = [];
  for (const [probeId, item] of Object.entries(params.items)) {
    if (item.attempts < minAttempts) continue;
    const passRate = item.correct / item.attempts;
    const reason: SuspectItem['reason'] | null =
      item.slip >= SLIP_CEILING * 0.9
        ? 'high-slip'
        : item.guess >= GUESS_CEILING * 0.9
          ? 'high-guess'
          : passRate > 0.95
            ? 'too-easy'
            : passRate < 0.15
              ? 'too-hard'
              : null;
    if (reason) out.push({ probeId, reason, passRate, attempts: item.attempts });
  }
  return out.sort((a, b) => b.attempts - a.attempts);
}

export { emptyParams };
