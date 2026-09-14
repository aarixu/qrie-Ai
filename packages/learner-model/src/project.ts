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
 * DELIBERATELY WIDER than the `evidenceFrom(index, answers)` it replaces. A
 * node the student sat through being taught and still looks weak on is a real
 * gap; today it cannot become one until somebody asks about it. That is a
 * behaviour change and it is the intended one — the point of a learner model is
 * that it remembers across sittings what a single session's answers cannot.
 */
export function evidenceSet(model: LearnerModel): Set<string> {
  const out = new Set<string>();
  for (const state of Object.values(model.states)) {
    if (state.observations > 0) out.add(state.outcomeId);
  }
  return out;
}
