import type { QuizOutcome } from './quiz';
import { closeSession, logAnswer, openSession } from '../stores/ledger';

/**
 * A GRADED QUIZ, WRITTEN DOWN.
 *
 * `gradeQuiz` already produces the richest evidence in the whole product: per
 * question, the node it probes, which option was chosen, whether it was right,
 * how long it took, and — for a wrong answer — THE NAMED MISCONCEPTION behind
 * the distractor they picked. All 3,242 authored probes carry those names.
 *
 * Until now the screen computed every one of those rows and stored
 * `{ lessonRef, score, total, at }`. The misconception, the timings and the
 * chosen options existed for exactly as long as the result screen was mounted.
 *
 * A QUIZ IS THE UNASSISTED CASE, which is why this is worth more per row than
 * anything the classroom produces. There are no hints in a quiz, no retries and
 * no tutor talking the student through it — so every answer here stands at rung
 * 0 of the assistance ladder, and rung 0 is the only rung that can ever confirm
 * mastery. The classroom generates far more events; this generates the ones
 * that actually settle the question.
 */
export function recordQuizInLedger(outcome: QuizOutcome, topicRef?: string): void {
  openSession({ source: 'quiz', topicRef, lessonId: outcome.lessonRef });

  for (const row of outcome.rows) {
    logAnswer({
      surface: 'tap',
      outcomeIds: [row.nodeId],
      topicRef,
      probeId: row.questionId,
      chosenIndex: row.chosenIndex,
      correct: row.correct,
      ms: row.ms,
      // One shot each. A retake re-asks the same probes as a fresh sitting,
      // which is what makes a retake a real retest rather than a second guess
      // at the same question.
      attempt: 1,
      assistanceRung: 0,
      hintsShown: 0,
      verdict: row.correct ? 'right' : 'wrong',
      // Null on a right answer, on a skip, and where the bank names none.
      misconceptionId: row.misconception ?? undefined,
    });
  }

  // The quiz measures its own elapsed time and the student cannot pause it, so
  // here — unlike a class — elapsed IS time on task.
  closeSession({ activeMs: outcome.elapsedMs, completed: true });
}
