import { GAP_THRESHOLD } from '@ai-tutor/knowledge-graph';
import type { LearnerModel } from './types.ts';

export interface AskChoice {
  outcomeId: string;
  /**
   * Always 0, and typed so. Every ask opens cold (E10); help is what
   * tutor-control decides AFTER an answer, never something an ask opens with.
   */
  rung: 0;
  /** The controller's reason. Logged on the ledger, never spoken aloud. */
  because: string;
}

/**
 * WHICH OF THIS BEAT'S OUTCOMES TO ASK ABOUT, AND HOW MUCH HELP TO OPEN WITH.
 *
 * The candidates are the beat's own `checks` list and never anything outside
 * it: a class that wanders off what it said it would teach is a worse class,
 * whatever the model wants to know.
 *
 * THIS IS THE WHOLE OF THE PERSONAL LAYER IN PHASE 3. The topic's SPINE — the
 * board, the diagrams, the words that explain the thing — is shared and cached
 * and should be, because it is a fact about the topic rather than about the
 * student. What this changes is which outcome id goes into a prompt that was
 * being sent anyway, which is why it costs nothing to run.
 *
 * IT OPENS AT RUNG 0, ALWAYS (E10, 2026-09-29). It used to open at rung 1 on an
 * outcome already failed cold — the rule the settled spec (2026-09-14, "at what
 * rung") retired. Opening with help on an outcome means it never produces
 * another rung-0 observation, so `unassistedMastery`, the one number that can
 * show the student improving, could never move there. What happens after a
 * wrong answer is `@ai-tutor/tutor-control`'s decision, not this one's.
 *
 * STILL NO CALLER in any app. It ranks on `unassistedMastery` and
 * `observations` only; it is kept because choosing WHICH of a beat's outcomes
 * to ask about is a real decision the asks layer will need, and it now makes
 * it without the retired rule.
 */
export function chooseAsk(model: LearnerModel, candidates: readonly string[]): AskChoice {
  const first = candidates[0];
  if (first === undefined) throw new Error('chooseAsk needs at least one candidate outcome');

  // 1. Somewhere we have asked them cold and they could not do it. Doubt beats
  //    curiosity: a question we can predict the answer to teaches us nothing,
  //    and a question about a known weakness is also the teaching.
  let doubted: { id: string; score: number } | null = null;
  for (const id of candidates) {
    const state = model.states[id];
    // NO UNASSISTED OBSERVATIONS MEANS THIS NUMBER IS A PRIOR, NOT A FINDING.
    // Reading it as a weakness is the 0.46 defect wearing new clothes: a
    // difficulty prior taken for a measurement, which once produced a
    // twelve-step remedial plan for a student who answered everything right.
    if (!state || state.unassistedObservations === 0) continue;
    if (!doubted || state.unassistedMastery < doubted.score) {
      doubted = { id, score: state.unassistedMastery };
    }
  }
  if (doubted) {
    const belowTheLine = doubted.score < GAP_THRESHOLD;
    return {
      outcomeId: doubted.id,
      // Cold, even below the line: this ask is the next chance to see them do
      // it alone, and opening with help would spend that chance.
      rung: 0,
      because: belowTheLine
        ? `unassisted mastery ${doubted.score.toFixed(2)} is below the gap line`
        : `lowest unassisted mastery on this beat (${doubted.score.toFixed(2)})`,
    };
  }

  // 2. Nothing here has been asked cold, so ask where we know least. An outcome
  //    with no state at all knows nothing, which makes it the most informative
  //    of all — this is `informationValue`'s argument, applied to one beat.
  let leastKnown = first;
  let fewest = model.states[first]?.observations ?? 0;
  for (const id of candidates) {
    const seen = model.states[id]?.observations ?? 0;
    if (seen < fewest) {
      leastKnown = id;
      fewest = seen;
    }
  }
  return {
    outcomeId: leastKnown,
    // No unassisted evidence means no reason to open with help. Rung 0 here is
    // the default rather than a judgement about the student.
    rung: 0,
    because: `no unassisted evidence on this beat; fewest observations (${fewest})`,
  };
}
