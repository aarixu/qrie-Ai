import { useCallback, useEffect, useMemo, useRef } from 'react';
import { misconceptionFor } from './diagnosticLedger';
import type { QuizAnswer, QuizQuestion } from './quiz';
import { createRevealMemory } from './quizReveal';
import { closeSession, logAnswer, openSession } from '../stores/ledger';

/** One per page: a retake remounts the quiz screen, and must still see it. */
const reveals = createRevealMemory();

/**
 * A QUIZ, WRITTEN DOWN AS IT IS TAKEN.
 *
 * A quiz produces the richest evidence in the whole product: per question, the
 * node it probes, which option was chosen, how long it took, and — for a wrong
 * answer — THE NAMED MISCONCEPTION behind the distractor they picked. All
 * 3,242 authored probes carry those names.
 *
 * A QUIZ IS THE UNASSISTED CASE, which is why this is worth more per row than
 * anything the classroom produces. There are no hints in a quiz and no tutor
 * talking the student through it — so a first sitting's answers stand at rung
 * 0 of the assistance ladder, and rung 0 is the only rung that can ever confirm
 * mastery. The classroom generates far more events; this generates the ones
 * that actually settle the question.
 *
 * EXCEPT A RETAKE RIGHT AFTER THE REVEAL (B5). Checking a question shows its
 * answer, and "Try again" re-asks the same probes, so a probe answered again
 * within a day of being shown is filed at rung 8 as the next attempt — see
 * `quizReveal.ts`.
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
  /**
   * Whether the quiz reached its results, which is not the same fact as
   * `closed`. A backgrounding closes the sitting on an UNFINISHED quiz and the
   * student is expected back; a finished one must not be reopened by the glance
   * that follows "See results".
   */
  const done = useRef(false);
  /**
   * Whether this QUIZ has ever had an answer recorded against it. Reset per
   * quiz beside `done`, and deliberately NOT in `openSitting` — a backgrounding
   * starts a new sitting but it does not un-answer the questions already
   * answered.
   */
  const answeredAny = useRef(false);

  const lessonRef = quiz?.[0]?.lessonRef;

  const openSitting = useCallback((): void => {
    if (lessonRef === undefined) return;
    onTaskMs.current = 0;
    closed.current = false;
    // OPENED WHEN THE QUIZ STARTS. This used to run from the results screen, so
    // `started_at` was the moment of grading and every answer's `at` was that
    // same instant — a sitting that appeared to have taken no time, at the
    // wrong end of the day.
    openSession({ source: 'quiz', topicRef, lessonId: lessonRef });
  }, [lessonRef, topicRef]);

  const closeSitting = useCallback((completed: boolean): void => {
    // A quiz closed halfway is still evidence about the questions that were
    // answered. Closing it as incomplete keeps those answers attributable to a
    // sitting instead of leaving a session that never ends — and marks the
    // sitting as what it was, so nothing later mistakes eight answers for a
    // ten-question result.
    if (closed.current) return;
    closed.current = true;
    /**
     * A QUIZ NOBODY ANSWERED WAS NOT COMPLETED, WHOEVER SAYS SO.
     *
     * `completed` is a fact about the QUIZ and `activeMs` is a fact about this
     * SITTING, and the first version of this guard coupled them — it refused
     * `completed` whenever `onTaskMs` was zero. That is wrong on the ordinary
     * path: a student who answers every question, backgrounds the app before
     * tapping "See results" and comes back is on a SECOND sitting whose
     * `onTaskMs` is legitimately zero, and it filed the one finished quiz in
     * the product as abandoned. So the question asked here is whether any
     * answer reached THIS QUIZ, which `answeredAny` survives a reopening to
     * say, rather than whether any reached this sitting.
     *
     * The claim still worth refusing is a quiz that was never answered at all
     * being filed as completed with nothing under it. `active_ms` is the
     * denominator of unassisted mastery gain per learning MINUTE and of
     * `cost_per_student_hour`, and a completed-but-empty sitting drags those
     * averages toward a number nobody earned — silently, because a zero reads
     * as arithmetic rather than as a missing measurement.
     *
     * Contradicting the caller rather than trusting it, because the caller is
     * a screen that knows the results page was reached and cannot know whether
     * anything was recorded on the way. NO CALLER CAN TRIP THIS TODAY —
     * PracticeQuiz.tsx:340 only shows "See results" once the last answer is
     * checked, so `finish` is unreachable with nothing answered. It is written
     * against the next caller: an auto-submitting timed quiz, or a skip, both
     * of which reach the results screen without an answer behind them.
     */
    closeSession({ activeMs: onTaskMs.current, completed: completed && answeredAny.current });
  }, []);

  /**
   * A DESTINATION FOR THE NEXT ANSWER, whatever the browser did in between.
   *
   * The package refuses an event whose sitting has ended, so an answer checked
   * after a backgrounding would be counted in `orphaned` and thrown away. This
   * is the same guard `useClassLedger` carries, and it belongs here more: a
   * quiz answer is the only rung-0 evidence the product ever produces.
   */
  const ensureOpen = useCallback((): void => {
    if (closed.current) openSitting();
  }, [openSitting]);

  useEffect(() => {
    if (!quiz) return;
    done.current = false;
    answeredAny.current = false;
    openSitting();

    /**
     * THE EXITS A REACT CLEANUP NEVER SEES — and this hook shipped without
     * them while the classroom's got them the same day.
     *
     * A tab closed, an app swiped away, a phone that kills the backgrounded
     * process: not one of them unmounts anything, so no `session-ended` was
     * ever queued. The eight answers a student gave before swiping away still
     * drain and still count, but `learning_session.active_ms` stays NULL for
     * that sitting for good — and `cost_per_student_hour` and every
     * per-learning-minute figure are built on exactly that column, so those
     * answers land in the numerator with nothing under them. Abandoning a quiz
     * by closing the app is the ordinary way a fourteen-year-old abandons one.
     *
     * `pagehide` is what a real navigation away fires; `visibilitychange` to
     * hidden is the only one mobile Safari reliably fires before the process is
     * frozen; `pageshow` is the only one a bfcache restore is guaranteed to
     * fire. All three are idempotent against each other, because closing checks
     * `closed` and reopening checks it too.
     */
    const onPageHide = (): void => closeSitting(false);
    const reopen = (): void => {
      if (closed.current && !done.current) openSitting();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') closeSitting(false);
      else reopen();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', reopen);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', reopen);
      document.removeEventListener('visibilitychange', onVisibility);
      closeSitting(false);
    };
  }, [quiz, openSitting, closeSitting]);

  return useMemo<QuizLedger>(
    () => ({
      answered(question, answer) {
        // The sitting a backgrounding closed cannot hold this; a new one can.
        ensureOpen();
        answeredAny.current = true;
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
          /**
           * One shot each — but NOT always cold (B5). Checking a question
           * shows its answer, and "Try again" re-asks the same probes. A
           * retake inside the reveal window is read-back, filed at rung 8 as
           * the next attempt; after it, a retake is a real retest again. See
           * `quizReveal.ts` for the window and why it is a day.
           */
          ...reveals.helpFor(question.id, Date.now()),
          verdict: answer.chosenIndex === question.correctIndex ? 'right' : 'wrong',
          // The same lookup the placement test does, off the same aligned
          // arrays: null on a right answer, on a skip, and where the bank
          // names none.
          misconceptionId: misconceptionFor(question, answer.chosenIndex),
        });
        // Checked is shown: the screen marks the right option from this moment.
        reveals.markRevealed(question.id, Date.now());
      },
      finish() {
        /**
         * FINISHED IS A FACT ABOUT THE QUIZ, not about whichever sitting
         * happens to be open — the same distinction `taught` makes in
         * useClassLedger. A student who backgrounded the app between the last
         * two questions is sitting on a closed sitting by the time they tap
         * "See results", and bailing out here would file the one completed
         * quiz in the product as abandoned.
         *
         * `done` is set first so the reopen handlers do not start a third
         * sitting when the tab comes back to the results screen.
         */
        done.current = true;
        ensureOpen();
        closeSitting(true);
      },
    }),
    [topicRef, ensureOpen, closeSitting],
  );
}
