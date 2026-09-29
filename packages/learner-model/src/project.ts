import type { Mastery } from '@ai-tutor/knowledge-graph';
import type { LearnerModel } from './types.ts';

/**
 * THE BLENDED FLOAT, FOR DISPLAY ONLY (B6).
 *
 * Every outcome the model has touched, at `mastery` — cold and hinted answers
 * together, hinted ones discounted by rung. A picture of the whole record, for
 * an inspector or a progress screen. NO DECISION READS IT: a blend cannot say
 * whether the student can do the thing alone, and every decision this product
 * makes (what to plan, what to call secure, what to tell the planner) is about
 * exactly that. Decisions read `unassistedView`.
 */
export function masteryView(model: LearnerModel): Mastery {
  const out: Mastery = {};
  for (const state of Object.values(model.states)) out[state.outcomeId] = state.mastery;
  return out;
}

/**
 * THE BELIEF A DECISION MAY READ (B6): unassisted mastery, and only where a
 * cold answer produced it.
 *
 * `gapsFrom`, `informationValue`, `confidenceCoverage` and `calibrateEdges` all
 * take a `Mastery`, and this is the one to hand them when the result decides
 * anything. An outcome with `unassistedObservations = 0` is ABSENT, never 0.5:
 * nobody has asked it cold, so what the student can do alone there is unknown,
 * and every existing reader of a sparse `Mastery` already treats absent as
 * "no belief" (outcomeLookup's `secure: undefined`, `studentLinesForPlanner`
 * naming nothing). An outcome answered right only with help is therefore never
 * secure, never held, and never skipped on the strength of that help.
 *
 * What an unknown outcome should lead to — a diagnostic item, cold — is the
 * next-activity planner's job (E6), which does not exist yet.
 */
export function unassistedView(model: LearnerModel): Mastery {
  const out: Mastery = {};
  for (const state of Object.values(model.states)) {
    if (state.unassistedObservations > 0) out[state.outcomeId] = state.unassistedMastery;
  }
  return out;
}

/**
 * THE OUTCOMES A DECISION IS ENTITLED TO AN OPINION ABOUT (B6): those with at
 * least one cold answer. The evidence gate to pair with `unassistedView` —
 * `evidenceSet` also admits hinted answers and raised hands, which move blended
 * belief but say nothing about what the student can do alone.
 */
export function unassistedEvidence(model: LearnerModel): Set<string> {
  const out = new Set<string>();
  for (const state of Object.values(model.states)) {
    if (state.unassistedObservations > 0) out.add(state.outcomeId);
  }
  return out;
}

/**
 * THE OUTCOMES THE MODEL IS ENTITLED TO AN OPINION ABOUT.
 *
 * `gapsFrom` takes this as its `evidence` option and refuses to call anything
 * outside it a gap — the fix for the 0.46 defect, where a difficulty prior was
 * read as a measurement and a flawless student was handed a twelve-step
 * remedial plan.
 *
 * ONLY EVIDENCE THAT COULD HAVE LOWERED BELIEF COUNTS. That means answers, and
 * it does not mean attendance. `packages/diagnostic/src/session.ts` states the
 * rule this file has to obey, in the repo, before any of this was written:
 *
 *   "Attendance (applyTaught) raises belief and so can never create a gap on
 *    its own; adding it would let the difficulty prior back in through the side
 *    door, which is the defect this whole gate exists to close."
 *
 * An earlier version of this function counted every `observations` and so
 * admitted attendance. Measured on the real class10-science map: one `taught`
 * event on a difficulty-4 node put it into the gate, and `buildPlan` then
 * returned it as a remedial step — scored at 0.46, the seeded prior, which
 * nothing had measured. The side door, exactly as named.
 *
 * WIDER than `evidenceFrom(index, answers)` in one way that is still safe: a
 * raised hand counts, because `applyDoubt` LOWERS belief. It is deliberately
 * not counted in `observations` for other reasons — see `ConceptState` — but a
 * student who stopped the class on an outcome has given us the kind of evidence
 * that may legitimately make it a gap.
 */
export function evidenceSet(model: LearnerModel): Set<string> {
  const out = new Set<string>();
  for (const state of Object.values(model.states)) {
    if (state.answerObservations > 0 || state.doubtCount > 0) out.add(state.outcomeId);
  }
  return out;
}
