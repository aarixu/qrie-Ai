import { learnFromQuiz } from '@ai-tutor/diagnostic';
import type { Answer, GraphIndex } from '@ai-tutor/knowledge-graph';
import { modelStore } from '../stores/model';
import { profileStore } from '../stores/profile';
import { loadDiagnosticDataFor } from './diagnosticData';
import { klassOf, settingsStore } from '../stores/settings';
import type { QuizOutcome } from './quiz';

/**
 * THE APP'S SIDE OF THE ADAPTIVE LOOP.
 *
 * `learnFromQuiz` is pure and lives with the rest of the diagnostic. This is
 * where its answer becomes something that happened: the student's stored
 * result is replaced, and their plan grows or shrinks.
 *
 * Before this, a topic test ended in a number. The score went into a history
 * nothing reads, the map never heard about it, and a student who got every
 * question about the heart wrong was sent straight on to the next chapter —
 * a playlist with a quiz attached rather than a tutor.
 */

/**
 * What changed, in words a screen can print.
 *
 * A PlanStep carries a node id and no title — titles live in the map, and
 * StudyPlan already looks each one up the same way. Resolved HERE, where the
 * index is already in hand, so the result screen stays a pure function of
 * simple data and never has to load a map to render a sentence.
 */
export interface PlanChange {
  added: { nodeId: string; title: string }[];
  dropped: { nodeId: string; title: string }[];
}

/** A graded quiz, in the shape the map takes evidence in. */
export function answersFrom(outcome: QuizOutcome): Answer[] {
  return outcome.rows.map((row) => ({
    probeId: row.questionId,
    nodeId: row.nodeId,
    chosenIndex: row.chosenIndex,
    correct: row.correct,
    // How long it took. applyEvidence discounts a correct answer that was
    // laboured, and without this every quiz answer looked instant to it.
    ms: row.ms,
  }));
}

/**
 * Fold a finished test into the student's plan.
 *
 * Returns what changed, so the completion screen can say it in words — a plan
 * that silently grew is a student wondering where a class came from.
 *
 * Null when there is nothing to fold into: no placement test taken, or no map
 * for this class. Both are ordinary states, not failures — a student can use
 * this app without ever sitting the diagnostic, and their quiz is then just a
 * score, exactly as it was.
 */
export function adaptToQuiz(outcome: QuizOutcome): PlanChange | null {
  const profile = profileStore.get();
  const before = profile.diagnostic;
  if (!before) return null;

  const klass = klassOf(settingsStore.get(), profile);
  if (klass === null) return null;

  const data = loadDiagnosticDataFor(klass, profile.subjects);
  if (!data) return null;

  const index = data.index as GraphIndex;
  // The same trained slip/guess and edge trust the placement test uses. A
  // topic test is the more frequent evidence source of the two; ignoring the
  // calibration here meant ignoring it almost everywhere.
  const adapted = learnFromQuiz(before, answersFrom(outcome), index, {
    params: modelStore.get(),
  });

  /**
   * A step the map no longer has still gets a readable line, the same way the
   * study plan does: a stored plan outlives the map it was built from, and
   * "undefined" on a celebration screen is worse than a title-cased id.
   */
  const named = (step: { nodeId: string }) => ({
    nodeId: step.nodeId,
    title:
      index.node(step.nodeId)?.title ??
      step.nodeId
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
  });
  const change: PlanChange = {
    added: adapted.added.map(named),
    dropped: adapted.dropped.map(named),
  };

  // Nothing moved. Writing anyway would rewrite the profile — and with it the
  // sync stamp — on every quiz a student passes.
  if (adapted.after !== before) {
    profileStore.update((p) => ({ ...p, diagnostic: adapted.after }));
  }
  return change;
}
