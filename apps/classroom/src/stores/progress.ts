import { createLocalStore } from './localStore';

export interface LessonProgress {
  /** Last beat the student reached (for resume). */
  beatIndex: number;
  /** ISO date-time of first completion; absent until completed. */
  completedAt?: string;
}

export interface Progress {
  lessons: Record<string, LessonProgress>;
  /** For the Home screen's "Continue" card. */
  lastLessonId: string | null;
}

export const progressStore = createLocalStore<Progress>('ai-tutor:progress', {
  lessons: {},
  lastLessonId: null,
});

export function saveBeat(lessonId: string, beatIndex: number): void {
  progressStore.update((p) => ({
    lastLessonId: lessonId,
    lessons: {
      ...p.lessons,
      [lessonId]: { ...p.lessons[lessonId], beatIndex },
    },
  }));
}

export function markCompleted(lessonId: string): void {
  progressStore.update((p) => ({
    ...p,
    lastLessonId: lessonId,
    lessons: {
      ...p.lessons,
      [lessonId]: {
        beatIndex: 0, // a finished lesson restarts from the top next time
        // First completion wins — the streak counts real days, not rewatches.
        completedAt: p.lessons[lessonId]?.completedAt ?? new Date().toISOString(),
      },
    },
  }));
}

export const isCompleted = (p: Progress, lessonId: string): boolean =>
  p.lessons[lessonId]?.completedAt !== undefined;

/**
 * Streak = consecutive calendar days with at least one completion, counting
 * back from today — and still alive if the run ends yesterday (today isn't
 * over). Pure so it can be tested without a clock: `today` is injected.
 */
export function computeStreak(p: Progress, today: Date = new Date()): number {
  const days = new Set(
    Object.values(p.lessons)
      .map((l) => l.completedAt)
      .filter((iso): iso is string => iso !== undefined)
      .map((iso) => iso.slice(0, 10)),
  );
  if (days.size === 0) return 0;

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const cursor = new Date(today);
  // A streak that hasn't added today yet is still alive — start from yesterday
  // in that case rather than resetting to zero.
  if (!days.has(dayKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
