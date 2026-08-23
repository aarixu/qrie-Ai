import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildQuiz,
  gradeQuiz,
  type QuizAnswer,
  type QuizOutcome,
  type QuizQuestion,
} from '../lib/quiz';
import { recordAttempt } from '../stores/quizHistory';
import { EmptyState } from '../ui/Screen';
import { Icon } from '../ui/Icon';

/**
 * Practice after a lesson, built to docs/design/screens/practice-quiz.png.
 *
 * This is the retention mechanic: a lesson with nothing at the end is a video.
 *
 * IT SHOWS RIGHT OR WRONG AFTER CHECK — the opposite of the placement
 * diagnostic, on purpose. A quiz exists to TEACH, so the moment right after a
 * commitment is the moment the correction lands. A diagnostic exists to
 * MEASURE, and a student told the answer to question 7 carries it into question
 * 8, which corrupts the measurement. Same four cards, opposite rules; neither
 * screen may borrow the other's behaviour.
 *
 * A wrong answer names the misconception rather than just marking an X. That
 * name is why the probe bank carries one per wrong option, and it is the whole
 * difference between "6 of 8" and "you mixed up atria and ventricles".
 */

const LETTERS = ['A', 'B', 'C', 'D'];

/** Every card carries a 2px border, transparent when idle, so nothing shifts on select. */
const CARD_BASE =
  'w-full flex items-center p-4 rounded-[24px] border-2 text-left transition-all duration-200';

export function PracticeQuiz({
  lessonRef,
  onComplete,
  onExit,
  onAskTutor,
}: {
  /** The lesson just finished; its nodes decide the questions. */
  lessonRef: string;
  /** Called once, with the graded attempt, when the last question is checked. */
  onComplete: (outcome: QuizOutcome) => void;
  /** Called when the student closes the quiz, or when this lesson has no quiz. */
  onExit: () => void;
  /** Hands the current question to the live doubt tutor. */
  onAskTutor?: (question: QuizQuestion) => void;
}) {
  const quiz = useMemo(() => buildQuiz(lessonRef), [lessonRef]);

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  // Answers are committed on Check, so their length IS the "already checked" flag for
  // the current question — one source of truth instead of a parallel boolean.
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);

  // Per-question, not per-quiz: the result screen reports time on task, and a
  // student who paused between questions did not spend that time thinking.
  const askedAt = useRef(Date.now());
  useEffect(() => {
    askedAt.current = Date.now();
  }, [index]);

  // A double-tap on "See results" would otherwise grade and log the attempt twice.
  const finished = useRef(false);

  if (!quiz) {
    return (
      <div className="bg-background text-on-background min-h-screen font-body-md">
        <div className="w-full max-w-md mx-auto px-margin-mobile py-8">
          <EmptyState
            icon="quiz"
            title="No practice for this lesson yet"
            body="This lesson does not have enough questions behind it to make a fair quiz. Rather than pad it with questions about other lessons, we skip it."
            action={
              <button
                onClick={onExit}
                className="mt-2 bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl shadow-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
              >
                Continue
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const question = quiz[index];
  const answer = answers[index] ?? null;
  const checked = answer !== null;
  const isCorrect = checked && answer.chosenIndex === question.correctIndex;
  const isLast = index === quiz.length - 1;

  // The current run, derived rather than stored: a second copy of "how many in a
  // row" is a second thing to keep in step with the answers.
  const streak = answers.reduce(
    (run, a, i) => (a.chosenIndex === quiz[i].correctIndex ? run + 1 : 0),
    0,
  );

  // The bar names the question on screen, not the ones behind it, so it moves
  // as a question appears rather than after it is answered.
  const percent = Math.round(((index + 1) / quiz.length) * 100);

  const check = () => {
    if (selected === null) return;
    setAnswers([...answers, { chosenIndex: selected, ms: Date.now() - askedAt.current }]);
  };

  const advance = () => {
    if (!isLast) {
      setIndex(index + 1);
      setSelected(null);
      return;
    }
    if (finished.current) return;
    finished.current = true;
    const outcome = gradeQuiz(quiz, answers);
    // Recorded here rather than left to the caller: history is the retention
    // signal, and it must not depend on every future integrator remembering.
    recordAttempt(outcome.lessonRef, outcome.score, outcome.total);
    onComplete(outcome);
  };

  const cardClass = (i: number): string => {
    if (!checked) {
      return selected === i
        ? `${CARD_BASE} bg-primary-fixed border-primary shadow-soft-indigo-lg`
        : `${CARD_BASE} bg-surface-container-lowest border-transparent shadow-soft-indigo hover:-translate-y-0.5 active:scale-[0.98]`;
    }
    if (i === question.correctIndex) {
      // The right answer is always marked, whether or not it was the one picked
      // — being told only "wrong" teaches nothing.
      return `${CARD_BASE} bg-primary-fixed border-primary`;
    }
    if (i === answer.chosenIndex) return `${CARD_BASE} bg-error-container border-error`;
    return `${CARD_BASE} bg-surface-container-lowest border-transparent opacity-60`;
  };

  const badgeClass = (i: number): string => {
    const base =
      'w-10 h-10 flex-shrink-0 grid place-items-center rounded-full font-headline-md text-headline-md transition-colors';
    if (checked && i === question.correctIndex) return `${base} bg-primary text-on-primary`;
    if (checked && i === answer.chosenIndex) return `${base} bg-error text-on-error`;
    if (!checked && selected === i) return `${base} bg-primary text-on-primary`;
    return `${base} bg-surface-container text-on-surface`;
  };

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md flex flex-col">
      <div className="w-full max-w-md mx-auto flex flex-col flex-grow">
        <header className="flex items-center gap-2 px-margin-mobile py-4 sticky top-0 bg-background z-10">
          <button
            onClick={onExit}
            aria-label="Close quiz"
            className="w-10 h-10 -ml-2 grid place-items-center rounded-full flex-shrink-0 text-on-surface-variant hover:bg-surface-container-high transition-colors active:scale-95"
          >
            <Icon name="close" />
          </button>

          <div
            role="progressbar"
            aria-label="Quiz progress"
            aria-valuemin={0}
            aria-valuemax={quiz.length}
            aria-valuenow={index + 1}
            className="flex-grow h-3 bg-surface-container-high rounded-full overflow-hidden"
          >
            <div
              className="h-full bg-primary rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>

          {/* Fixed slot: the counter appears at the first correct answer, and a
              header that resizes underneath the student is a jolt, not a reward. */}
          <div className="w-[68px] flex justify-end flex-shrink-0">
            {streak > 0 && (
              <div className="flex items-center gap-1 bg-secondary-fixed text-on-secondary-container px-3 py-1 rounded-full">
                <span className="font-headline-md text-[18px] leading-6">{streak}</span>
                <Icon name="local_fire_department" filled className="text-secondary-container text-lg" />
                <span className="sr-only">correct in a row</span>
              </div>
            )}
          </div>
        </header>

        <main className="flex-grow flex flex-col px-margin-mobile py-stack-md gap-stack-md pb-32">
          <div className="flex flex-col gap-stack-sm">
            <div className="inline-flex items-center self-start px-3 py-1 bg-surface-container text-on-surface-variant rounded-full font-label-sm text-label-sm uppercase tracking-wider">
              {`Question ${index + 1} of ${quiz.length}`}
            </div>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
              {question.question}
            </h1>
            {onAskTutor && (
              <button
                onClick={() => onAskTutor(question)}
                className="inline-flex items-center gap-2 self-start text-primary hover:text-primary-container font-label-md text-label-md transition-colors mt-2"
              >
                <Icon name="front_hand" className="text-lg" />
                Ask the tutor
              </button>
            )}
          </div>

          <div className="flex flex-col gap-stack-sm">
            {question.options.map((option, i) => (
              <button
                key={`${question.id}-${i}`}
                onClick={() => !checked && setSelected(i)}
                disabled={checked}
                className={cardClass(i)}
              >
                <span className={badgeClass(i)}>{LETTERS[i]}</span>
                <span className="ml-4 flex-1 font-body-lg text-body-lg text-on-surface">
                  {option}
                </span>
                {checked && i === question.correctIndex && (
                  <Icon name="check_circle" filled className="text-primary ml-2" />
                )}
                {checked && !isCorrect && i === answer.chosenIndex && (
                  <Icon name="cancel" filled className="text-error ml-2" />
                )}
              </button>
            ))}
          </div>

          {checked && !isCorrect && (
            <div className="bg-error-container text-on-error-container rounded-[24px] p-card-padding flex items-start gap-3">
              <Icon name="lightbulb" filled className="flex-shrink-0" />
              <div>
                <p className="font-label-md text-label-md uppercase tracking-wider opacity-80">
                  {question.title}
                </p>
                <p className="font-body-md text-body-md mt-1">
                  {/* The named misconception, not a generic "try again" — the bank
                      carries one per wrong option precisely so this line exists. */}
                  {answer.chosenIndex !== null && question.misconceptions[answer.chosenIndex]
                    ? question.misconceptions[answer.chosenIndex]
                    : `The answer is ${LETTERS[question.correctIndex]}.`}
                </p>
              </div>
            </div>
          )}

          {checked && isCorrect && (
            <div className="flex items-center gap-3 text-primary font-label-md text-label-md">
              <Icon name="check_circle" filled />
              Correct — {question.title}
            </div>
          )}
        </main>

        <div className="fixed bottom-0 left-0 w-full bg-surface/90 backdrop-blur-md p-margin-mobile border-t border-outline-variant/30">
          <div className="w-full max-w-md mx-auto">
            <button
              onClick={checked ? advance : check}
              disabled={!checked && selected === null}
              className="w-full py-4 bg-primary text-on-primary rounded-xl font-headline-md text-headline-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              {!checked ? 'Check' : isLast ? 'See results' : 'Next question'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
