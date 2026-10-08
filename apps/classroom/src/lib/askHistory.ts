import {
  normaliseMisconception,
  similarMisconceptions,
  type ConceptState,
  type LearnerModel,
} from '@ai-tutor/learner-model';
import { matchedOption, type AskInput, type DecideHistory, type DecideInput } from '@ai-tutor/tutor-control';

/**
 * WHAT THE CLASSROOM TELLS `decide()` ABOUT THIS CHILD'S PAST (lam-one-brain
 * Task 6, D11).
 *
 * Pure: the caller hands in the device's learner model (`loadModel()`), the
 * outcomes the held question is evidence about, and what it knows of the
 * sitting. `decide()` reads the result; see `DecideHistory` for what each
 * field changes.
 */

/**
 * Asks earlier in this sitting where they asked for help before giving any
 * answer, from which a further request before trying is met with "try first".
 * One reflexive pull is not a habit (learner-model `hintAbuse` is a rate for
 * the same reason). The learner model does not hold this, so it is the
 * sitting's count, kept by the caller.
 */
export const HINT_ABUSE_ASKS = 2;

/** Cold answers on an outcome, with not one of them right, that read as wheel-spinning (learner-model `wheelSpinning`'s default). */
export const WHEEL_SPIN_MISSES = 3;

/** The text of the wrong option a `matchedOption` index names, as `decide()` reads it; nothing for a right option or none. */
export function wrongOptionText(ask: AskInput, index: number | undefined): string | undefined {
  const option = matchedOption(ask, index);
  if (!option || option.correct === true) return undefined;
  const text = option.text.trim();
  return text === '' ? undefined : text;
}

const sameIdea = (label: string, option: string): boolean => {
  const id = normaliseMisconception(label);
  return (id !== '' && id === normaliseMisconception(option)) || similarMisconceptions(label, option);
};

export function askHistory(input: {
  model: LearnerModel;
  /** What an answer to the held question is evidence about (`answeredOutcomesAtBeat`). */
  outcomeIds: readonly string[];
  /** The wrong option their answer matched (`wrongOptionText`), on a wrong answer. */
  wrongOption?: string;
  /** This sitting's ledger session; a wrong idea shown only in it is not "before". */
  sessionId: string | null;
  /** Other asks this sitting where help was asked for before any answer. Omit where hint-abuse must not apply (silence). */
  pulledBeforeTrying?: number;
}): DecideHistory {
  const states = input.outcomeIds
    .map((id) => input.model.states[id])
    .filter((s): s is ConceptState => s !== undefined);
  const history: DecideHistory = {};

  /**
   * The idea their wrong option names, shown on this outcome in another
   * sitting: so "this tripped you up last time too" is true whether or not
   * this answer has been folded yet. Cleared since or not — shown again, it
   * is the same idea back.
   */
  const option = input.wrongOption?.trim();
  if (option) {
    for (const s of states) {
      const found = Object.values(s.misconceptions ?? {}).find(
        (m) => m.label !== null && sameIdea(m.label, option) && m.sittings.some((id) => id !== input.sessionId),
      );
      if (found?.label) {
        history.repeatedMisconception = found.label;
        break;
      }
    }
  }

  if (states.some((s) => s.unassistedObservations >= WHEEL_SPIN_MISSES && s.lastUnassistedSuccessAt === null)) {
    history.wheelSpin = true;
  }

  if ((input.pulledBeforeTrying ?? 0) >= HINT_ABUSE_ASKS) history.hintAbuse = true;

  return history;
}

/**
 * What the model believes about the held question's outcomes, as `decide()`
 * reads it: the weakest cold belief among those asked cold, or undefined when
 * none was (unknown, B6 — never 0.5).
 */
export function askMastery(model: LearnerModel, outcomeIds: readonly string[]): DecideInput['mastery'] {
  const cold = outcomeIds
    .map((id) => model.states[id])
    .filter((s): s is ConceptState => s !== undefined && s.unassistedObservations > 0)
    .map((s) => s.unassistedMastery);
  return cold.length === 0 ? undefined : { unassisted: Math.min(...cold) };
}
