import { beforeEach, describe, expect, it } from 'vitest';
import type { Probe } from '@ai-tutor/knowledge-graph';
import { misconceptionFor } from '../src/lib/diagnosticLedger';
import { recordQuizInLedger } from '../src/lib/quizLedger';
import { ledgerOutbox, resetLedgerOutbox } from '../src/stores/ledger';
import type { QuizOutcome } from '../src/lib/quiz';

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

const outcome = (): QuizOutcome => ({
  lessonRef: 'class10-blood',
  score: 1,
  total: 2,
  elapsedMs: 92_000,
  bestStreak: 1,
  rows: [
    {
      questionId: 'probe-a',
      nodeId: 'sci10-lp-heart-is-pump',
      title: 'The heart is a pump',
      question: 'What does the heart do?',
      chosenIndex: 0,
      correctIndex: 0,
      correct: true,
      ms: 4100,
      misconception: null,
    },
    {
      questionId: 'probe-b',
      nodeId: 'sci10-lp-double-circulation',
      title: 'Double circulation',
      question: 'How many times does blood pass through the heart per circuit?',
      chosenIndex: 2,
      correctIndex: 1,
      correct: false,
      ms: 31_500,
      misconception: 'thinks blood passes through the heart once per circuit',
    },
  ],
});

describe('a graded quiz reaching the ledger', () => {
  it('keeps every row the score line threw away', () => {
    // Before this, gradeQuiz computed all of it and the app stored
    // { lessonRef, score, total, at }. The misconceptions, the timings and the
    // chosen options lived exactly as long as the result screen was mounted.
    recordQuizInLedger(outcome());
    const events = ledgerOutbox.get().pending;

    const answers = events.filter((e) => e.kind === 'answered');
    expect(answers).toHaveLength(2);
    expect(answers[1].payload).toMatchObject({
      probeId: 'probe-b',
      chosenIndex: 2,
      correct: false,
      ms: 31_500,
      misconceptionId: 'thinks blood passes through the heart once per circuit',
    });
    expect(answers[1].outcomeIds).toEqual(['sci10-lp-double-circulation']);
  });

  it('records every quiz answer at rung 0, because a quiz offers no help', () => {
    // This is why a quiz row is worth more than a classroom row: rung 0 is the
    // only rung that can ever confirm mastery, and the classroom rarely sits
    // on it.
    recordQuizInLedger(outcome());
    for (const e of ledgerOutbox.get().pending.filter((x) => x.kind === 'answered')) {
      expect(e.payload).toMatchObject({ assistanceRung: 0, hintsShown: 0, attempt: 1 });
    }
  });

  it('opens and closes one sitting, with elapsed as time on task', () => {
    // Unlike a class, a quiz cannot be paused — so here elapsed IS on task.
    recordQuizInLedger(outcome());
    const events = ledgerOutbox.get().pending;
    expect(events[0].kind).toBe('session-started');
    expect(events[0].source).toBe('quiz');
    const last = events[events.length - 1];
    expect(last.kind).toBe('session-ended');
    expect(last.payload).toMatchObject({ activeMs: 92_000, completed: true });
  });

  it('files every event under one session, in order', () => {
    recordQuizInLedger(outcome());
    const events = ledgerOutbox.get().pending;
    expect(new Set(events.map((e) => e.sessionId)).size).toBe(1);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
  });

  it('carries no misconception for a right answer', () => {
    recordQuizInLedger(outcome());
    const first = ledgerOutbox.get().pending.filter((e) => e.kind === 'answered')[0];
    expect((first.payload as { misconceptionId?: string }).misconceptionId).toBeUndefined();
  });
});
