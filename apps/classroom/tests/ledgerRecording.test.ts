import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Probe } from '@ai-tutor/knowledge-graph';
import { misconceptionFor } from '../src/lib/diagnosticLedger';
import { buildQuiz, type QuizQuestion } from '../src/lib/quiz';
import { PracticeQuiz } from '../src/screens/PracticeQuiz';
import { ledgerOutbox, resetLedgerOutbox } from '../src/stores/ledger';

/**
 * The two UNASSISTED surfaces — a quiz and the placement test — and the one
 * lookup this product has always known how to do and never stored.
 */

beforeEach(() => {
  localStorage.clear();
  resetLedgerOutbox();
});

const probe = (extra: Partial<Probe> = {}): Probe => ({
  id: 'probe-1',
  nodeId: 'sci10-lp-cell-is-unit',
  question: 'Why does a resting animal still need oxygen everywhere?',
  options: ['Every cell is alive', 'Only the brain', 'Only active tissue', 'Organs but not cells'],
  correctIndex: 0,
  misconceptions: [
    '',
    'thinks only major vital organs require life support',
    'believes only active tissues need nutrients',
    'fails to recognize cells as the individual living units of organs',
  ],
  ...extra,
});

describe('the misconception behind a wrong answer', () => {
  it('names the wrong idea attached to the option they actually chose', () => {
    // persona's StudentContext has carried a `namedMisconception` field the
    // whole time, documented as coming from exactly this lookup — and nothing
    // performed it. The map recorded THAT an answer was wrong, never why.
    expect(misconceptionFor(probe(), 2)).toBe('believes only active tissues need nutrients');
  });

  it('names nothing for a right answer', () => {
    expect(misconceptionFor(probe(), 0)).toBeUndefined();
  });

  it('names nothing for a skip', () => {
    // A skip is weak evidence AGAINST, which the belief math already handles.
    // It is not evidence of a particular wrong idea.
    expect(misconceptionFor(probe(), null)).toBeUndefined();
  });

  it('treats the empty string at the correct index as absent', () => {
    // The banks align misconceptions to options by index and put '' at the
    // correct one, so a bare array lookup would store an empty misconception.
    expect(misconceptionFor(probe({ correctIndex: 1 }), 0)).toBeUndefined();
  });

  it('survives a bank that predates the field', () => {
    expect(misconceptionFor(probe({ misconceptions: undefined }), 2)).toBeUndefined();
  });
});

/**
 * THE QUIZ IS DRIVEN, NOT DESCRIBED.
 *
 * Every assertion below comes from clicking the real screen through a quiz
 * built off the committed Class 10 probe bank — never from calling the
 * recorder by hand with a fixture. The defect these cover was not in the
 * recorder at all: it wrote perfect rows, from one call site that a student
 * who closed the tab never reached. A test that called the recorder directly
 * would have been green through every day of that.
 */

const LESSON = 'class10-science-life-processes-autotrophic-nutrition';
const TOPIC = 'class10-science/life-processes/autotrophic-nutrition';

const quiz = buildQuiz(LESSON, { topicRef: TOPIC });
if (!quiz) throw new Error(`the committed data built no quiz for "${LESSON}"`);

const noop = (): void => {};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  // The hook listens on the DOCUMENT, so a screen left standing would answer
  // the next test's visibilitychange and write to its outbox.
  visibility = 'visible';
  vi.useRealTimers();
});

/** Opens the screen the way the route does. */
const open = (props: { lessonRef?: string; topicRef?: string } = {}): void => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(PracticeQuiz, {
        lessonRef: LESSON,
        topicRef: TOPIC,
        onComplete: noop,
        onExit: noop,
        ...props,
      }),
    ),
  );
};

/**
 * Leaving the QUIZ — the close button, the back button, a route change. React
 * runs a cleanup for all of those.
 *
 * NOT what closing the tab does, which this used to be called. A swiped-away
 * app, a killed process and a reload unmount nothing; `swipedAway` and `hidden`
 * below are those, and they are separate for the reason the naming hid.
 */
const leave = (): void => {
  act(() => root!.unmount());
  root = null;
};

/**
 * The tab goes away, or comes back.
 *
 * jsdom's visibilityState is a getter with no setter, and one event covers both
 * directions — the hook has to ask the document which way it went, so a test
 * that only dispatched the event would be testing nothing.
 */
let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

const seen = (state: DocumentVisibilityState): void => {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

/** What a real tab close or an app swiped away fires. */
const swipedAway = (): void => {
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
};

/** The one event a back/forward-cache restore is guaranteed to fire. */
const restored = (): void => {
  act(() => {
    window.dispatchEvent(new Event('pageshow'));
  });
};

const press = (matches: (button: HTMLButtonElement) => boolean): void => {
  const button = [...host!.querySelectorAll('button')].find(matches);
  if (!button) throw new Error('no such button on the quiz');
  act(() => button.click());
};

/** Pick an option and commit it, exactly as a student does. */
const answer = (question: QuizQuestion, chosenIndex: number): void => {
  press((b) => (b.textContent ?? '').endsWith(question.options[chosenIndex]));
  press((b) => b.textContent?.trim() === 'Check');
};

const nextQuestion = (): void =>
  press((b) => ['Next question', 'See results'].includes(b.textContent?.trim() ?? ''));

/** The chosen index that is wrong, so a wrong answer names a misconception. */
const wrongFor = (question: QuizQuestion): number =>
  (question.correctIndex + 1) % question.options.length;

const events = () => ledgerOutbox.get().pending;
const answered = () => events().filter((e) => e.kind === 'answered');
const payloads = () => answered().map((e) => e.payload as Record<string, unknown>);
const ofKind = (kind: string): Record<string, unknown>[] =>
  events()
    .filter((e) => e.kind === kind)
    .map((e) => e.payload as Record<string, unknown>);

describe('a quiz reaching the ledger as it is taken', () => {
  it('keeps the answers of a student who left before the results screen', () => {
    // THE DEFECT. Recording ran once, from the results screen, so eight
    // answers and a closed tab left ZERO rows — on the only surface that
    // produces rung-0 unassisted evidence, which is the only rung that can
    // ever confirm mastery.
    open();
    answer(quiz[0], quiz[0].correctIndex);
    nextQuestion();
    answer(quiz[1], wrongFor(quiz[1]));
    nextQuestion();
    answer(quiz[2], quiz[2].correctIndex);
    leave();

    expect(payloads()).toHaveLength(3);
    expect(payloads()[1]).toMatchObject({
      probeId: quiz[1].id,
      chosenIndex: wrongFor(quiz[1]),
      correct: false,
      verdict: 'wrong',
      misconceptionId: quiz[1].misconceptions[wrongFor(quiz[1])],
    });
    expect(answered()[1].outcomeIds).toEqual([quiz[1].nodeId]);

    const last = events()[events().length - 1];
    expect(last.kind).toBe('session-ended');
    // Abandoned, and recorded as abandoned — three answers must never be read
    // back as an eight-question result.
    expect(last.payload).toMatchObject({ completed: false });
  });

  it('writes an answer when it is checked, not when the quiz is graded', () => {
    open();
    answer(quiz[0], quiz[0].correctIndex);

    // Still on question 1 of 8, nothing graded, and the row is already down.
    expect(payloads()).toHaveLength(1);
    expect(events().some((e) => e.kind === 'session-ended')).toBe(false);
  });

  it('records each answer exactly once when the quiz is played to the end', () => {
    // The end of the quiz must not re-write what was already recorded: event
    // ids are minted at record time, so a second recording of the same answer
    // is a second row under a second id — the table's idempotency cannot
    // collapse it, and the student would appear to have answered twice.
    open();
    for (const [i, question] of quiz.entries()) {
      answer(question, question.correctIndex);
      nextQuestion();
      expect(payloads()).toHaveLength(i + 1);
    }

    expect(payloads()).toHaveLength(quiz.length);
    expect(new Set(events().map((e) => e.sessionId)).size).toBe(1);
    expect(events().map((e) => e.seq)).toEqual([...events().keys()]);

    const ended = events().filter((e) => e.kind === 'session-ended');
    expect(ended).toHaveLength(1);
    expect(ended[0].payload).toMatchObject({ completed: true });

    // And leaving the finished screen does not close the sitting a second time.
    leave();
    expect(events().filter((e) => e.kind === 'session-ended')).toHaveLength(1);
  });

  it('names the topic on the sitting and on every answer', () => {
    // Without it every quiz session and every quiz row landed with topic_ref
    // NULL, and the richest evidence in the product could not be read per
    // topic — which is the only way it is ever read.
    open();
    answer(quiz[0], quiz[0].correctIndex);
    nextQuestion();
    answer(quiz[1], wrongFor(quiz[1]));
    leave();

    for (const event of events()) expect(event.topicRef).toBe(TOPIC);
    expect(events()[0].kind).toBe('session-started');
    expect(events()[0].payload).toMatchObject({ lessonId: LESSON });
  });

  it('starts the sitting when the student starts, not at the moment of grading', () => {
    // Only Date is faked: React's scheduler still needs its real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    const opened = new Date('2026-09-13T09:00:00.000Z');
    vi.setSystemTime(opened);

    open();
    vi.setSystemTime(new Date(opened.getTime() + 90_000));
    answer(quiz[0], quiz[0].correctIndex);

    // The session used to be opened by the results screen, so started_at and
    // every answer's `at` were one instant — the moment of grading — and a
    // sitting looked as though it took no time at the wrong end of the day.
    expect(events()[0].at).toBe('2026-09-13T09:00:00.000Z');
    expect(answered()[0].at).toBe('2026-09-13T09:01:30.000Z');
    expect(payloads()[0]).toMatchObject({ ms: 90_000 });
  });

  it('closes with the time spent on the questions actually answered', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const opened = new Date('2026-09-13T09:00:00.000Z');
    vi.setSystemTime(opened);

    open();
    vi.setSystemTime(new Date(opened.getTime() + 20_000));
    answer(quiz[0], quiz[0].correctIndex);
    nextQuestion();
    vi.setSystemTime(new Date(opened.getTime() + 45_000));
    answer(quiz[1], quiz[1].correctIndex);
    // Then the tab sits open for an hour with nobody in front of it.
    vi.setSystemTime(new Date(opened.getTime() + 3_600_000));
    leave();

    const ended = events()[events().length - 1];
    // 20s on the first question, 25s on the second. Time on task is the sum of
    // the questions worked, never the wall clock of an abandoned tab.
    expect(ended.payload).toMatchObject({ activeMs: 45_000, completed: false });
  });

  /**
   * THE EXIT A REACT CLEANUP NEVER SEES — and the quiz shipped without it on
   * the same day the classroom got it.
   *
   * Every test above leaves by unmounting, which is the close button and the
   * back button. A fourteen-year-old abandons a quiz by swiping the app away,
   * and that unmounts nothing: no `session-ended` was queued, so the sitting's
   * `active_ms` stayed NULL for good while its answers drained and counted.
   * `cost_per_student_hour` and every per-learning-minute figure divide by that
   * column, so those answers landed in the numerator with nothing underneath.
   */
  describe('a quiz the browser takes away without telling React', () => {
    it('closes the sitting when the tab is hidden, carrying the questions worked', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const opened = new Date('2026-09-13T09:00:00.000Z');
      vi.setSystemTime(opened);

      open();
      vi.setSystemTime(new Date(opened.getTime() + 20_000));
      answer(quiz[0], quiz[0].correctIndex);
      seen('hidden');

      expect(ofKind('session-ended')).toEqual([{ activeMs: 20_000, completed: false }]);
    });

    it('closes it on pagehide too, for the browsers that fire that and nothing else', () => {
      open();
      answer(quiz[0], quiz[0].correctIndex);
      swipedAway();

      expect(ofKind('session-ended')).toHaveLength(1);
      expect(ofKind('session-ended')[0]).toMatchObject({ completed: false });
    });

    it('closes it exactly once, however many of those exits the browser announces', () => {
      open();
      answer(quiz[0], quiz[0].correctIndex);
      // What one real tab close looks like from in here.
      seen('hidden');
      swipedAway();
      leave();

      // Two session-ended rows for one sitting would count its minutes twice in
      // the denominator of every per-learning-minute figure.
      expect(ofKind('session-ended')).toHaveLength(1);
    });

    it('gives an answer checked after the student comes back a sitting that can hold it', () => {
      open();
      answer(quiz[0], quiz[0].correctIndex);
      nextQuestion();
      seen('hidden'); // a glance at a notification
      seen('visible');
      answer(quiz[1], quiz[1].correctIndex);
      leave();

      const opened = events().filter((e) => e.kind === 'session-started');
      expect(opened).toHaveLength(2);
      // The package refuses an event whose sitting has ended, so an answer that
      // found no open sitting would be counted here and thrown away — on the
      // only surface that produces rung-0 evidence.
      expect(ledgerOutbox.get().orphaned).toBe(0);
      expect(answered()[1].sessionId).toBe(opened[1].sessionId);
    });

    it('reopens on pageshow, which is the one event a bfcache restore always fires', () => {
      open();
      answer(quiz[0], quiz[0].correctIndex);
      nextQuestion();
      swipedAway();
      restored();
      answer(quiz[1], quiz[1].correctIndex);
      leave();

      expect(ledgerOutbox.get().orphaned).toBe(0);
      expect(events().filter((e) => e.kind === 'session-started')).toHaveLength(2);
    });

    it('still files a finished quiz as finished when the last gap was a backgrounding', () => {
      open();
      for (const [i, question] of quiz.entries()) {
        answer(question, question.correctIndex);
        if (i < quiz.length - 1) nextQuestion();
      }
      // They background the app between the last Check and "See results".
      seen('hidden');
      seen('visible');
      nextQuestion(); // See results

      const ended = ofKind('session-ended');
      expect(ended[ended.length - 1]).toMatchObject({ completed: true });
      // And coming back to the results screen does not open a third sitting.
      seen('hidden');
      seen('visible');
      expect(events().filter((e) => e.kind === 'session-started')).toHaveLength(2);
    });
  });

  it('opens no sitting for a lesson that has no quiz behind it', () => {
    // "No practice for this lesson yet" is a screen, not a quiz taken. A
    // session opened here would be a sitting with no answers in it, and every
    // average built over sittings would be diluted by lessons nobody sat.
    open({ lessonRef: 'class10-nothing-here' });
    leave();

    expect(events()).toHaveLength(0);
  });
});
