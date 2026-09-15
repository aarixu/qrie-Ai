import type { Mastery } from '@ai-tutor/knowledge-graph';
import type { LearnerModel } from './types.ts';

/**
 * THE BARE FLOAT, DERIVED RATHER THAN STORED.
 *
 * `gapsFrom`, `informationValue`, `confidenceCoverage` and `calibrateEdges` all
 * take a `Mastery`. They keep taking one. What changes is that nobody STORES it
 * any more — which is the honest way to retire a type that thirty call sites
 * depend on. Deleting it would have meant rewriting the whole diagnostic engine
 * for no gain.
 */
export function masteryView(model: LearnerModel): Mastery {
  const out: Mastery = {};
  for (const state of Object.values(model.states)) out[state.outcomeId] = state.mastery;
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
