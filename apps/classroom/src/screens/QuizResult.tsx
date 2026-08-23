import { formatDuration, type QuizOutcome, type QuizResultRow } from '../lib/quiz';
import { Icon } from '../ui/Icon';

/**
 * The end of a practice quiz, built to docs/design/screens/quiz-result.png.
 *
 * The score ring is the reward; "Worth another look" is the value. Each wrong
 * answer is listed by the NAMED MISCONCEPTION behind it, not by the question
 * text, because "mixed up atria and ventricles" is something a student can go
 * and fix, where "question 4" is not.
 */

/** The design's ring: r=54 in a 120 viewBox, 12px stroke. */
const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Verdicts, worst first, chosen by the fraction correct. Copy stays honest at
 * every band: telling a student who scored 2/8 that they are mastering the
 * chapter teaches them the app's praise means nothing.
 */
const VERDICTS: { atLeast: number; title: string; body: string }[] = [
  { atLeast: 0, title: 'Worth another go', body: 'The list below is exactly what to look at.' },
  { atLeast: 0.5, title: 'Good effort', body: 'A couple of ideas to clear up, then try again.' },
  { atLeast: 0.75, title: 'Nicely done!', body: "You're mastering this chapter." },
];

const verdictFor = (score: number, total: number) => {
  const fraction = total > 0 ? score / total : 0;
  // Last match wins, so a new band only needs adding in order above.
  return VERDICTS.reduce((best, v) => (fraction >= v.atLeast ? v : best), VERDICTS[0]);
};

export function QuizResult({
  outcome,
  onContinue,
  onRetry,
  onReview,
}: {
  outcome: QuizOutcome;
  /** The single forward action; the header's close does the same thing. */
  onContinue: () => void;
  /** Rebuilds the same quiz — it is deterministic, so a retry is a real retest. */
  onRetry: () => void;
  /** Takes the student back to what the missed question was about. */
  onReview?: (row: QuizResultRow) => void;
}) {
  const { score, total, elapsedMs, bestStreak, rows } = outcome;
  const wrong = rows.filter((row) => !row.correct);
  const perfect = wrong.length === 0 && total > 0;
  const verdict = verdictFor(score, total);
  const offset = CIRCUMFERENCE * (1 - (total > 0 ? score / total : 0));

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md flex flex-col">
      <div className="w-full max-w-md mx-auto flex flex-col flex-grow">
        <header className="w-full top-0 sticky bg-background z-10">
          <div className="flex justify-between items-center px-margin-mobile py-base-unit">
            <button
              onClick={onContinue}
              aria-label="Close results"
              className="w-10 h-10 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors active:scale-95"
            >
              <Icon name="close" />
            </button>
            <div className="font-headline-md text-headline-md text-primary">Results</div>
            {/* Balances the close button so the title sits centred. */}
            <div className="w-10 h-10" />
          </div>
        </header>

        <main className="flex-grow flex flex-col px-margin-mobile pt-stack-lg pb-40">
          <section className="flex flex-col items-center justify-center mb-stack-lg">
            <div className="relative w-40 h-40 grid place-items-center mb-stack-md">
              <svg
                className="w-full h-full absolute inset-0 -rotate-90"
                viewBox="0 0 120 120"
                role="img"
                aria-label={`${score} out of ${total} correct`}
              >
                <circle
                  className="text-surface-variant"
                  cx="60"
                  cy="60"
                  r={RADIUS}
                  fill="transparent"
                  stroke="currentColor"
                  strokeWidth="12"
                />
                <circle
                  className="text-primary"
                  cx="60"
                  cy="60"
                  r={RADIUS}
                  fill="transparent"
                  stroke="currentColor"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE.toFixed(2)}
                  strokeDashoffset={offset.toFixed(2)}
                />
              </svg>
              <div aria-hidden className="flex flex-col items-center justify-center z-10">
                <span className="font-headline-xl text-headline-xl text-primary">
                  {score}
                  <span className="font-body-lg text-body-lg text-on-surface-variant">/{total}</span>
                </span>
              </div>
            </div>

            <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-2 text-center">
              {perfect ? 'Perfect score!' : verdict.title}
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant text-center mb-stack-md">
              {perfect ? 'Every question right. This chapter is yours.' : verdict.body}
            </p>

            <div className="flex gap-4">
              <div className="bg-surface-container-lowest px-4 py-2 rounded-full shadow-soft-indigo border border-outline-variant/20 flex items-center gap-2">
                <Icon name="schedule" filled className="text-primary" />
                <span className="font-label-md text-label-md text-on-surface">
                  Time {formatDuration(elapsedMs)}
                </span>
              </div>
              <div className="bg-secondary-fixed px-4 py-2 rounded-full shadow-soft-indigo border border-outline-variant/20 flex items-center gap-2">
                <Icon name="local_fire_department" filled className="text-secondary-container" />
                <span className="font-label-md text-label-md text-on-secondary-container">
                  Streak {bestStreak} correct
                </span>
              </div>
            </div>
          </section>

          {perfect ? (
            /* A heading over an empty list reads as a bug and steals the win, so
               a clean sweep gets its own state rather than the review section. */
            <section className="flex flex-col items-center text-center gap-3 bg-surface-container-lowest rounded-[24px] p-card-padding shadow-soft-indigo">
              <div className="w-16 h-16 rounded-full bg-primary text-on-primary grid place-items-center">
                <Icon name="workspace_premium" filled className="text-3xl" />
              </div>
              <h2 className="font-headline-md text-headline-md text-on-surface">
                Nothing to review
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                You answered all {total} without a slip. Come back in a few days and see if it
                sticks.
              </p>
            </section>
          ) : (
            <section className="flex flex-col gap-stack-sm">
              <h2 className="font-headline-md text-headline-md text-on-surface mb-2">
                Worth another look
              </h2>
              {wrong.map((row) => (
                <div
                  key={row.questionId}
                  className="bg-surface-container-lowest p-card-padding rounded-[24px] shadow-soft-indigo flex items-start gap-4"
                >
                  <div className="w-12 h-12 rounded-full bg-error-container grid place-items-center flex-shrink-0">
                    <Icon name="close" className="text-error" />
                  </div>
                  <div className="flex-grow min-w-0">
                    <h3 className="font-headline-md text-[18px] leading-6 text-on-surface mb-1">
                      {row.title}
                    </h3>
                    <p className="font-body-md text-[14px] leading-5 text-on-surface-variant mb-3">
                      {/* An unanswered question has no misconception to name — the
                          bank names what a wrong CHOICE reveals, and skipping is
                          not a choice. Saying so beats inventing a diagnosis. */}
                      {row.misconception ??
                        (row.chosenIndex === null
                          ? 'Left unanswered'
                          : 'Worth reading through once more')}
                    </p>
                    {onReview && (
                      // Rendered only when the caller can actually go somewhere;
                      // a Review button that does nothing is worse than none.
                      <button
                        onClick={() => onReview(row)}
                        className="bg-primary-container text-on-primary-container font-label-md text-label-md px-4 py-1.5 rounded-full hover:opacity-90 transition-opacity active:scale-95"
                      >
                        Review
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}
        </main>

        <div className="fixed bottom-0 left-0 w-full bg-surface-container-lowest/90 backdrop-blur-md border-t border-outline-variant/20 p-margin-mobile pb-8 z-20">
          <div className="w-full max-w-md mx-auto flex flex-col gap-3">
            <button
              onClick={onContinue}
              className="w-full bg-primary text-on-primary font-label-md text-label-md py-4 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
            >
              Continue
            </button>
            <button
              onClick={onRetry}
              className="w-full bg-transparent text-primary font-label-md text-label-md py-4 rounded-xl hover:bg-primary/5 transition-colors"
            >
              Retry quiz
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
