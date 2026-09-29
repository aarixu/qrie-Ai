import { learnFromQuiz } from '@ai-tutor/diagnostic';
import type { Answer, GraphIndex } from '@ai-tutor/knowledge-graph';
import { unassistedEvidence } from '@ai-tutor/learner-model';
import { loadModel, masteryFromModel } from './learnerModel';
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
  /**
   * BELIEF COMES FROM THE MODEL. `before.mastery` is the PLACEMENT's record —
   * one day's snapshot — and it used to be both the seed here and the thing
   * this function overwrote, so it drifted into a hybrid that was neither the
   * placement's finding nor the model's belief, while two surfaces still read
   * it as live. The model has folded every class, quiz and placement answer
   * since; a stale 0.99 from test day must not veto a gap the student just
   * demonstrated, and a stale 0.30 must not resurrect one they have closed.
   *
   * UNASSISTED belief (B6): `masteryFromModel()` holds only outcomes answered
   * cold. A gap is a decision, and a hinted answer — right or wrong — says
   * nothing about what the student can do alone, so an outcome with no cold
   * answer is unknown here and never becomes a step on the strength of help.
   */
  const belief = { ...before, mastery: masteryFromModel() };
  // The same trained slip/guess and edge trust the placement test uses. A
  // topic test is the more frequent evidence source of the two; ignoring the
  // calibration here meant ignoring it almost everywhere.
  const adapted = learnFromQuiz(belief, answersFrom(outcome), index, {
    params: modelStore.get(),
    // What the model has seen of this student COLD beyond this quiz, so a
    // break found in a class is eligible to become a step here. The gate that
    // belongs with the view above: an outcome outside it is absent from that
    // view, sits at the prior, and so cannot be a gap either way today — the
    // pairing keeps it so if the view ever stops defaulting to the prior.
    knownEvidence: unassistedEvidence(loadModel()),
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

  /**
   * ONLY THE PLAN IS PERSISTED. The stored mastery stays the placement's own
   * record byte for byte — the model is the belief store now, and writing the
   * quiz-evolved numbers back here is exactly the "writes belief directly"
   * that task 3.4 exists to end. Gaps ride along because they explain the
   * plan; mastery does not, because two surfaces read it as the student.
   *
   * And only when the plan actually moved: writing on every passed quiz would
   * churn the profile's sync stamp for a no-op.
   */
  if (adapted.added.length > 0 || adapted.dropped.length > 0) {
    profileStore.update((p) => ({
      ...p,
      diagnostic: { ...adapted.after, mastery: before.mastery },
    }));
  }
  return change;
}
