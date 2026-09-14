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
 * WIDER than the `evidenceFrom(index, answers)` it replaces, in exactly one
 * way: a node the student SAT THROUGH BEING TAUGHT counts. Today a gap can only
 * come from a node an answer spoke about, so a lesson the student attended and
 * still looks weak on cannot become one. That is the intended change — the
 * point of a learner model is that it remembers across sittings what one
 * session's answers cannot.
 *
 * A RAISED HAND IS NOT IN IT. `confused` moves belief and is counted in
 * `doubtCount`, deliberately not here. Measured: one raised hand on an
 * otherwise-untouched outcome puts it at 0.39, and `gapsFrom` would then return
 * it as a gap at confidence 0.61 — a remedial plan step earned by asking a
 * question. That contradicts applyDoubt's own rule (mastery.ts:250-252), "a
 * hand is a nudge rather than a verdict, and a student who asks a lot must
 * never be modelled as a student who knows nothing".
 */
export function evidenceSet(model: LearnerModel): Set<string> {
  const out = new Set<string>();
  for (const state of Object.values(model.states)) {
    if (state.observations > 0) out.add(state.outcomeId);
  }
  return out;
}
