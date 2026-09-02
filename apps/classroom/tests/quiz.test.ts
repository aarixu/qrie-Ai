import { beforeEach, describe, expect, it } from 'vitest';
import type { LearningNode } from '@ai-tutor/knowledge-graph';
import {
  DEFAULT_LENGTH,
  MIN_QUESTIONS,
  buildQuiz,
  formatDuration,
  gradeQuiz,
  type QuizAnswer,
  type QuizQuestion,
} from '../src/lib/quiz';
import {
  bestScore,
  quizHistoryStore,
  recordAttempt,
  type QuizAttempt,
} from '../src/stores/quizHistory';
import graphJson from '../../../packages/knowledge-graph/data/class10-science.json';

/**
 * Everything here runs against the COMMITTED Class 10 map and probe bank, not a
 * fixture: the point of buildQuiz is that it reads real content correctly, and a
 * fixture would only prove the fixture parses.
 */

const NODES = new Map<string, LearningNode>(
  (graphJson.nodes as unknown as LearningNode[]).map((node) => [node.id, node]),
);

/** A lesson the committed map actually teaches, with more probes than a quiz asks. */
const LESSON = 'class10-science-life-processes-autotrophic-nutrition';
/** The shortest lesson in the map — five probes, so `minimum` can be tested for real. */
const SHORT_LESSON = 'class10-excretion';

const quizFor = (lessonRef: string): QuizQuestion[] => {
  const quiz = buildQuiz(lessonRef);
  if (!quiz) throw new Error(`no quiz built for "${lessonRef}" from the committed data`);
  return quiz;
};

/** Answers that get exactly the listed question indices right. */
const answersWithCorrect = (quiz: QuizQuestion[], correctAt: number[]): QuizAnswer[] =>
  quiz.map((question, i) => ({
    chosenIndex: correctAt.includes(i)
      ? question.correctIndex
      : (question.correctIndex + 1) % question.options.length,
    ms: 1000,
  }));

describe('buildQuiz', () => {
  it('asks only about nodes the lesson teaches', () => {
    // LESSON is one the map names on its nodes, so this exercises the precise
    // join. The topic fallback is covered separately below.
    const quiz = quizFor(LESSON);

    expect(quiz.length).toBeGreaterThanOrEqual(MIN_QUESTIONS);
    for (const question of quiz) {
      expect(NODES.get(question.nodeId)?.lessonRef).toBe(LESSON);
      expect(question.lessonRef).toBe(LESSON);
    }
  });

  it('carries the node title and four options with a valid correct index', () => {
    for (const question of quizFor(LESSON)) {
      expect(question.title).toBe(NODES.get(question.nodeId)?.title);
      expect(question.options).toHaveLength(4);
      expect(question.correctIndex).toBeGreaterThanOrEqual(0);
      expect(question.correctIndex).toBeLessThan(question.options.length);
    }
  });

  it('is deterministic — two calls give the same questions in the same order', () => {
    // A quiz that reshuffles cannot be debugged, and a retry would not be a retest.
    expect(buildQuiz(LESSON)?.map((q) => q.id)).toEqual(buildQuiz(LESSON)?.map((q) => q.id));
  });

  it('orders by node difficulty, then by probe id', () => {
    const quiz = quizFor(LESSON);
    const keys = quiz.map((q) => [NODES.get(q.nodeId)?.difficulty ?? 0, q.id] as const);

    for (let i = 1; i < keys.length; i += 1) {
      const [prevDifficulty, prevId] = keys[i - 1];
      const [difficulty, id] = keys[i];
      expect(prevDifficulty).toBeLessThanOrEqual(difficulty);
      if (prevDifficulty === difficulty) expect(prevId < id).toBe(true);
    }
  });

  it('never asks more than the default length', () => {
    expect(quizFor(LESSON).length).toBeLessThanOrEqual(DEFAULT_LENGTH);
  });

  it('caps at the limit it is given, keeping the easiest questions', () => {
    const full = quizFor(LESSON);
    const capped = buildQuiz(LESSON, { limit: 3 });

    expect(full.length).toBeGreaterThan(3);
    expect(capped?.map((q) => q.id)).toEqual(full.slice(0, 3).map((q) => q.id));
  });

  it('falls back to the lesson topic when the map names no lesson on a node', () => {
    // Nutrition in Human Beings is taught by no recorded lesson, so none of its
    // five nodes carries a lessonRef. A class prepared live for that topic must
    // still end with practice — the map has never heard of it by name.
    const topicRef = 'class10-science/life-processes/nutrition-in-human-beings';
    const byTopic = [...NODES.values()].filter((n) => n.topicRef === topicRef);

    expect(byTopic.length).toBeGreaterThanOrEqual(MIN_QUESTIONS);
    expect(byTopic.every((n) => n.lessonRef === undefined)).toBe(true);

    const quiz = buildQuiz('a-class-made-just-now', { topicRef });

    expect(quiz).not.toBeNull();
    for (const question of quiz!) expect(NODES.get(question.nodeId)?.topicRef).toBe(topicRef);
  });

  it('never borrows questions another lesson under the same topic has claimed', () => {
    // NCERT's single "Transportation in Human Beings" is taught here as two
    // lessons, the heart and the blood, and every node under it is claimed by
    // one of them. A third lesson arriving on that topic inherits none of it.
    const topicRef = 'class10-science/life-processes/transportation-in-human-beings';
    const claimed = [...NODES.values()].filter((n) => n.topicRef === topicRef);

    expect(claimed.length).toBeGreaterThan(0);
    expect(claimed.every((n) => n.lessonRef !== undefined)).toBe(true);
    expect(buildQuiz('some-third-lesson', { topicRef })).toBeNull();
  });

  it('keeps two lessons under one topic apart', () => {
    const topicRef = 'class10-science/life-processes/transportation-in-human-beings';
    const blood = buildQuiz('class10-blood', { topicRef })!;
    const heart = buildQuiz('class10-science-life-processes-transportation-in-human-beings', {
      topicRef,
    })!;

    expect(blood.length).toBeGreaterThan(0);
    expect(heart.length).toBeGreaterThan(0);
    const shared = blood.filter((q) => heart.some((h) => h.id === q.id));
    expect(shared).toEqual([]);
  });

  it('returns null for a lesson with no probes at all', () => {
    expect(buildQuiz('class10-nothing-here')).toBeNull();
  });

  it('returns null rather than padding when fewer than the minimum are available', () => {
    const available = quizFor(SHORT_LESSON).length;

    expect(available).toBeGreaterThanOrEqual(MIN_QUESTIONS);
    expect(buildQuiz(SHORT_LESSON, { minimum: available + 1 })).toBeNull();
  });
});

describe('gradeQuiz', () => {
  it('counts the score and reports per-question correctness', () => {
    const quiz = quizFor(LESSON);
    const outcome = gradeQuiz(quiz, answersWithCorrect(quiz, [0, 2, 3]));

    expect(outcome.total).toBe(quiz.length);
    expect(outcome.score).toBe(3);
    expect(outcome.rows.map((r) => r.correct).filter(Boolean)).toHaveLength(3);
    expect(outcome.rows[0].correct).toBe(true);
    expect(outcome.rows[1].correct).toBe(false);
    expect(outcome.lessonRef).toBe(LESSON);
  });

  it('sums the time spent across the questions', () => {
    const quiz = quizFor(LESSON);
    const answers = quiz.map((q, i) => ({ chosenIndex: q.correctIndex, ms: (i + 1) * 100 }));

    const expected = (quiz.length * (quiz.length + 1)) / 2;
    expect(gradeQuiz(quiz, answers).elapsedMs).toBe(expected * 100);
  });

  it('finds the longest run of correct answers', () => {
    const quiz = quizFor(LESSON);

    // 8 questions: right at 0, then a run of three at 2-4, then one at 6.
    expect(gradeQuiz(quiz, answersWithCorrect(quiz, [0, 2, 3, 4, 6])).bestStreak).toBe(3);
  });

  it('counts a run that ends at the last question', () => {
    const quiz = quizFor(LESSON);
    const last = quiz.length - 1;
    const tail = [last - 2, last - 1, last];

    // The classic off-by-one: a run only closed on a wrong answer loses this one.
    expect(gradeQuiz(quiz, answersWithCorrect(quiz, [0, ...tail])).bestStreak).toBe(3);
  });

  it('is 0 with nothing correct and the full length when everything is', () => {
    const quiz = quizFor(LESSON);

    expect(gradeQuiz(quiz, answersWithCorrect(quiz, [])).bestStreak).toBe(0);
    expect(gradeQuiz(quiz, quiz.map((q) => ({ chosenIndex: q.correctIndex, ms: 0 }))).bestStreak)
      .toBe(quiz.length);
  });

  it('names the misconception behind a wrong answer, and none behind a right one', () => {
    const quiz = quizFor(LESSON);
    const wrongIndex = (quiz[0].correctIndex + 1) % quiz[0].options.length;
    const outcome = gradeQuiz(quiz, [
      { chosenIndex: wrongIndex, ms: 0 },
      { chosenIndex: quiz[1].correctIndex, ms: 0 },
    ]);

    // The named misconception is the entire reason the bank carries them: it is
    // what turns a score into something a student can act on.
    expect(outcome.rows[0].misconception).toBe(quiz[0].misconceptions[wrongIndex]);
    expect(outcome.rows[0].misconception).toBeTruthy();
    expect(outcome.rows[1].misconception).toBeNull();
  });

  it('treats a missing answer as unanswered, with no invented misconception', () => {
    const quiz = quizFor(LESSON);
    const outcome = gradeQuiz(quiz, [{ chosenIndex: quiz[0].correctIndex, ms: 50 }]);

    expect(outcome.score).toBe(1);
    expect(outcome.rows).toHaveLength(quiz.length);
    expect(outcome.rows[1].chosenIndex).toBeNull();
    expect(outcome.rows[1].correct).toBe(false);
    expect(outcome.rows[1].misconception).toBeNull();
  });
});

describe('formatDuration', () => {
  it('reads as a student would say it', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(260_000)).toBe('4m 20s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
  });
});

describe('quizHistory', () => {
  beforeEach(() => {
    localStorage.clear();
    quizHistoryStore.set([]);
  });

  it('round-trips an attempt through storage', () => {
    recordAttempt(LESSON, 6, 8);

    const [attempt] = quizHistoryStore.get();
    expect(attempt.lessonRef).toBe(LESSON);
    expect(attempt.score).toBe(6);
    expect(attempt.total).toBe(8);
    expect(Number.isNaN(Date.parse(attempt.at))).toBe(false);
    expect(JSON.parse(localStorage.getItem('ai-tutor:quiz-history') ?? '[]')).toHaveLength(1);
  });

  it('keeps every attempt, in the order they happened', () => {
    recordAttempt(LESSON, 3, 8);
    recordAttempt(LESSON, 7, 8);

    expect(quizHistoryStore.get().map((a) => a.score)).toEqual([3, 7]);
  });

  describe('bestScore', () => {
    const at = (lessonRef: string, score: number, total: number): QuizAttempt => ({
      lessonRef,
      score,
      total,
      at: '2026-08-23T10:00:00.000Z',
    });

    it('picks the highest for that lesson and ignores other lessons', () => {
      const history = [
        at(LESSON, 3, 8),
        at('class10-blood', 7, 7),
        at(LESSON, 7, 8),
        at(LESSON, 5, 8),
      ];

      expect(bestScore(history, LESSON)?.score).toBe(7);
      expect(bestScore(history, 'class10-blood')?.score).toBe(7);
    });

    it('compares as a ratio, because quiz length grows with the probe bank', () => {
      // 4/5 beats 6/8 even though six is the bigger number.
      expect(bestScore([at(LESSON, 6, 8), at(LESSON, 4, 5)], LESSON)?.total).toBe(5);
    });

    it('prefers the longer quiz on an exact tie', () => {
      expect(bestScore([at(LESSON, 3, 3), at(LESSON, 8, 8)], LESSON)?.total).toBe(8);
    });

    it('is null for a lesson never practised', () => {
      expect(bestScore([at(LESSON, 8, 8)], 'class10-respiration')).toBeNull();
      expect(bestScore([], LESSON)).toBeNull();
    });
  });
});
