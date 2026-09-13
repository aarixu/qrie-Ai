import { useEffect, useMemo, useRef } from 'react';
import { misconceptionFor } from './diagnosticLedger';
import type { QuizAnswer, QuizQuestion } from './quiz';
import { closeSession, logAnswer, openSession } from '../stores/ledger';

/**
 * A QUIZ, WRITTEN DOWN AS IT IS TAKEN.
 *
 * A quiz produces the richest evidence in the whole product: per question, the
 * node it probes, which option was chosen, how long it took, and — for a wrong
 * answer — THE NAMED MISCONCEPTION behind the distractor they picked. All
 * 3,242 authored probes carry those names.
 *
 * A QUIZ IS THE UNASSISTED CASE, which is why this is worth more per row than
 * anything the classroom produces. There are no hints in a quiz, no retries and
 * no tutor talking the student through it — so every answer here stands at rung
 * 0 of the assistance ladder, and rung 0 is the only rung that can ever confirm
 * mastery. The classroom generates far more events; this generates the ones
 * that actually settle the question.
 *
 * WHICH IS WHY IT IS NO LONGER WRITTEN AT THE END. This was one call from the
 * results screen, handed the graded outcome — so a student who answered eight
 * of ten and closed the tab left ZERO rows, and the most valuable evidence in
 * the product was thrown away by the most ordinary thing a fourteen-year-old
 * does. Eight unassisted answers are eight pieces of evidence whether or not a
 * ninth was ever given.
 *
 * RECORDED ONCE, AT THE MOMENT IT HAPPENS, AND NOT AGAIN AT THE END. That is a
 * structural guarantee, not a database one, and the difference matters: the
 * table is idempotent on the event id, but ids are minted fresh inside
 * `logAnswer` at the moment of recording, so the same answer recorded twice
 * arrives as two rows under two ids and counts as two answers. Idempotency
 * protects a drain that re-sends a batch whose response was lost; nothing
 * protects a screen that records the same answer twice. So `answered` is called
 * from exactly one place — the Check button — and `finish` writes no answers at
 * all, only the end of the sitting.
 */

export interface QuizLedger {
  /** One committed answer, as it is checked. */
  answered(question: QuizQuestion, answer: QuizAnswer): void;
  /** The last question was checked and the results are up. */
  finish(): void;
}

/**
 * `quiz` is null when the lesson has no practice behind it, and then no sitting
 * is opened: "No practice for this lesson yet" is a screen, not a quiz taken.
 *
 * The lesson id comes off the questions rather than from a second parameter,
 * the same way `gradeQuiz` derives it, so the sitting cannot be filed under a
 * lesson other than the one the questions came from.
 */
export function useQuizLedger(quiz: QuizQuestion[] | null, topicRef?: string): QuizLedger {
  /**
   * TIME ON TASK, SUMMED FROM THE QUESTIONS ACTUALLY WORKED.
   *
   * Not wall clock since the quiz opened. A quiz cannot be paused, so a
   * question's own elapsed time IS time on task — but an abandoned quiz is
   * abandoned by leaving the tab open, and wall clock would file an afternoon
   * against eight questions. This adds up to exactly what the results screen
   * reports when the quiz is finished, because that is the same sum.
   */
  const onTaskMs = useRef(0);
  const closed = useRef(false);

  useEffect(() => {
    if (!quiz) return;
    onTaskMs.current = 0;
    closed.current = false;
    // OPENED WHEN THE QUIZ STARTS. This used to run from the results screen, so
    // `started_at` was the moment of grading and every answer's `at` was that
    // same instant — a sitting that appeared to have taken no time, at the
    // wrong end of the day.
    openSession({ source: 'quiz', topicRef, lessonId: quiz[0].lessonRef });
    return () => {
      // A quiz closed halfway is still evidence about the questions that were
      // answered. Closing it as incomplete keeps those answers attributable to
      // a sitting instead of leaving a session that never ends — and marks the
      // sitting as what it was, so nothing later mistakes eight answers for a
      // ten-question result.
      if (!closed.current) {
        closed.current = true;
        closeSession({ activeMs: onTaskMs.current, completed: false });
      }
    };
  }, [quiz, topicRef]);

  return useMemo<QuizLedger>(
    () => ({
      answered(question, answer) {
        onTaskMs.current += answer.ms;
        logAnswer({
          surface: 'tap',
          outcomeIds: [question.nodeId],
          // Without this every quiz row landed with topic_ref NULL, and any
          // per-topic reading of the one unassisted surface was impossible.
          topicRef,
          probeId: question.id,
          chosenIndex: answer.chosenIndex,
          correct: answer.chosenIndex === question.correctIndex,
          ms: answer.ms,
          // One shot each. A retake re-asks the same probes as a fresh sitting,
          // which is what makes a retake a real retest rather than a second
          // guess at the same question.
          attempt: 1,
          assistanceRung: 0,
          hintsShown: 0,
          verdict: answer.chosenIndex === question.correctIndex ? 'right' : 'wrong',
          // The same lookup the placement test does, off the same aligned
          // arrays: null on a right answer, on a skip, and where the bank
          // names none.
          misconceptionId: misconceptionFor(question, answer.chosenIndex),
        });
      },
      finish() {
        if (closed.current) return;
        closed.current = true;
        closeSession({ activeMs: onTaskMs.current, completed: true });
      },
    }),
    [topicRef],
  );
}
