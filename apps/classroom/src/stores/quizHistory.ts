import { createLocalStore } from './localStore';

/**
 * Every practice attempt, kept the way doubtLog keeps every raised hand.
 *
 * Score alone is what makes retention visible: a student who scores 4/8 on
 * Monday and 7/8 on Thursday has a story the app can tell back to them, and the
 * factory learns which lessons leave people at 4. Collection starts on day one
 * even though nothing reads the history yet beyond `bestScore`.
 */
export interface QuizAttempt {
  lessonRef: string;
  score: number;
  total: number;
  at: string; // ISO
}

const CAP = 500;

export const quizHistoryStore = createLocalStore<QuizAttempt[]>('ai-tutor:quiz-history', []);

export function recordAttempt(lessonRef: string, score: number, total: number): void {
  quizHistoryStore.update((history) =>
    [...history, { lessonRef, score, total, at: new Date().toISOString() }].slice(-CAP),
  );
}

/**
 * The best attempt at one lesson, or null if it has never been practised.
 *
 * The whole attempt rather than a bare number, because a score without its
 * total is meaningless: the probe bank grows, so last month's best may have
 * been out of 5 where today's quiz is out of 8. Compared as a ratio by
 * cross-multiplication (integers only, no float ties), with the longer quiz
 * winning an exact tie — 8/8 is stronger evidence than 3/3.
 */
export function bestScore(history: QuizAttempt[], lessonRef: string): QuizAttempt | null {
  let best: QuizAttempt | null = null;
  for (const attempt of history) {
    if (attempt.lessonRef !== lessonRef || attempt.total <= 0) continue;
    if (
      best === null ||
      attempt.score * best.total - best.score * attempt.total > 0 ||
      (attempt.score * best.total === best.score * attempt.total && attempt.total > best.total)
    ) {
      best = attempt;
    }
  }
  return best;
}
