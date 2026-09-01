import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildQuiz, formatDuration, gradeQuiz, type QuizAnswer } from '../src/lib/quiz';
import { PracticeQuiz } from '../src/screens/PracticeQuiz';
import { QuizResult } from '../src/screens/QuizResult';

/**
 * Both screens are wiring over lib/quiz, so both are rendered from a REAL quiz
 * built off the committed Class 10 probe bank — never a hand-written fixture.
 * If the bank changes shape, these fail here rather than in a student's face.
 */

const LESSON = 'class10-science-life-processes-autotrophic-nutrition';

const quiz = buildQuiz(LESSON);
if (!quiz) throw new Error(`the committed data built no quiz for "${LESSON}"`);

const noop = () => {};

/**
 * React escapes text on the way out and separates adjacent text nodes with an
 * empty comment; both are rendering artefacts, so strip them and assert against
 * the copy as it was written.
 */
const decode = (html: string): string =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const renderQuiz = (props: Partial<Parameters<typeof PracticeQuiz>[0]> = {}): string =>
  decode(
    renderToString(
      <PracticeQuiz lessonRef={LESSON} onComplete={noop} onExit={noop} {...props} />,
    ),
  );

/** Answers that get exactly the listed question indices right. */
const answersWithCorrect = (correctAt: number[]): QuizAnswer[] =>
  quiz.map((question, i) => ({
    chosenIndex: correctAt.includes(i)
      ? question.correctIndex
      : (question.correctIndex + 1) % question.options.length,
    ms: 32_500,
  }));

describe('PracticeQuiz', () => {
  it('opens on the first question of the real quiz, with all four options', () => {
    const html = renderQuiz();

    expect(html).toContain(quiz[0].question);
    for (const option of quiz[0].options) expect(html).toContain(option);
    for (const letter of ['A', 'B', 'C', 'D']) expect(html).toContain(`>${letter}</span>`);
  });

  it('shows the question counter and a progress bar', () => {
    const html = renderQuiz();

    expect(html).toContain(`Question 1 of ${quiz.length}`);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="1"');
  });

  it('pins the Check button and offers a way out', () => {
    const html = renderQuiz();

    expect(html).toContain('Check');
    expect(html).toContain('aria-label="Close quiz"');
  });

  it('reveals nothing before the answer is checked', () => {
    const html = renderQuiz();

    // Right/wrong feedback is the point of a quiz, but only AFTER Check — the
    // opening state must not leak the answer through a marker or a misconception.
    expect(html).not.toContain('check_circle');
    expect(html).not.toContain('cancel');
    for (const misconception of quiz[0].misconceptions.filter(Boolean)) {
      expect(html).not.toContain(misconception);
    }
  });

  it('hides the correct-streak counter until there is a streak to show', () => {
    expect(renderQuiz()).not.toContain('correct in a row');
  });

  it('offers "Ask the tutor" only when the caller can route it somewhere', () => {
    expect(renderQuiz()).not.toContain('Ask the tutor');
    expect(renderQuiz({ onAskTutor: noop })).toContain('Ask the tutor');
  });

  it('renders an honest empty state when the lesson has no quiz behind it', () => {
    const html = decode(
      renderToString(
        <PracticeQuiz lessonRef="class10-nothing-here" onComplete={noop} onExit={noop} />,
      ),
    );

    expect(html).toContain('No practice for this lesson yet');
    expect(html).toContain('Continue');
    expect(html).not.toContain(quiz[0].question);
  });
});

describe('QuizResult', () => {
  const outcome = gradeQuiz(quiz, answersWithCorrect([0, 2, 3, 4, 6]));

  const renderResult = (over: Partial<Parameters<typeof QuizResult>[0]> = {}): string =>
    decode(
      renderToString(
        <QuizResult outcome={outcome} onContinue={noop} onRetry={noop} {...over} />,
      ),
    );

  it('draws the score ring with a dash offset proportional to the score', () => {
    const html = renderResult();
    const circumference = 2 * Math.PI * 54;

    expect(html).toContain(`stroke-dasharray="${circumference.toFixed(2)}"`);
    expect(html).toContain(
      `stroke-dashoffset="${(circumference * (1 - outcome.score / outcome.total)).toFixed(2)}"`,
    );
    expect(html).toContain(`${outcome.score} out of ${outcome.total} correct`);
  });

  it('shows the time taken and the best correct streak', () => {
    const html = renderResult();

    expect(html).toContain(`Time ${formatDuration(outcome.elapsedMs)}`);
    expect(html).toContain(`Streak ${outcome.bestStreak} correct`);
  });

  it('lists every wrong answer by its named misconception', () => {
    const html = renderResult();
    const wrong = outcome.rows.filter((row) => !row.correct);

    expect(wrong.length).toBeGreaterThan(0);
    expect(html).toContain('Worth another look');
    for (const row of wrong) {
      expect(html).toContain(row.title);
      // The misconception, not the question text — that is the actionable part.
      expect(html).toContain(row.misconception);
    }
  });

  it('leaves correct answers off the review list', () => {
    const html = renderResult();
    const right = outcome.rows.filter((row) => row.correct);

    for (const row of right) expect(html).not.toContain(row.question);
  });

  it('offers Review only when the caller supplied somewhere to go', () => {
    expect(renderResult()).not.toContain('>Review<');
    expect(renderResult({ onReview: noop })).toContain('>Review<');
  });

  it('always offers Continue and Retry', () => {
    const html = renderResult();

    expect(html).toContain('Continue');
    expect(html).toContain('Retry quiz');
  });

  it('celebrates a clean sweep instead of heading an empty list', () => {
    const perfect = gradeQuiz(
      quiz,
      quiz.map((question) => ({ chosenIndex: question.correctIndex, ms: 1_000 })),
    );
    const html = decode(
      renderToString(<QuizResult outcome={perfect} onContinue={noop} onRetry={noop} />),
    );

    expect(html).toContain('Perfect score!');
    expect(html).toContain('Nothing to review');
    expect(html).not.toContain('Worth another look');
    expect(html).toContain(`Streak ${quiz.length} correct`);
  });
});
