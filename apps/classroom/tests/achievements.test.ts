import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiagnosticResult } from '@ai-tutor/knowledge-graph';
import {
  achievements,
  chaptersOf,
  hasAnyProgress,
  nearestLocked,
  splitAchievements,
  type Achievement,
  type AchievementId,
  type StudentRecord,
} from '../src/lib/achievements';
import { SYLLABI, type CatalogEntry } from '../src/lib/content';
import type { DoubtEntry } from '../src/stores/doubtLog';
import type { StudentProfile } from '../src/stores/profile';
import type { Progress } from '../src/stores/progress';
import type { QuizAttempt } from '../src/stores/quizHistory';

/**
 * Every achievement is a claim about the student, so every test here is about
 * a boundary: the event that makes the claim true, and the one before it that
 * does not. The chapter fixture is the REAL catalogue joined to the REAL
 * syllabus rather than a hand-written one — if content changes shape, that has
 * to fail here and not in a student's face.
 *
 * The function is clock-free, so `TODAY` is a fixed date and every fixture is
 * written relative to it.
 */

const TODAY = new Date('2026-08-23T09:00:00.000Z');
const DAY_MS = 86_400_000;

const day = (ago: number): string =>
  new Date(TODAY.getTime() - ago * DAY_MS).toISOString().slice(0, 10);

const at = (ago: number): string => `${day(ago)}T10:00:00.000Z`;

const CATALOG = (
  JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'content/index.json'), 'utf8'),
  ) as { lessons: CatalogEntry[] }
).lessons;

const CHAPTERS = chaptersOf(SYLLABI, CATALOG);
const LIFE = CHAPTERS[0];

const NO_PROFILE: StudentProfile = {
  name: null,
  klass: null,
  subjects: [],
  diagnostic: null,
  diagnosedAt: null,
};

const PLACED: DiagnosticResult = { mastery: { 'a-node': 0.2 }, gaps: [], plan: [], answers: [] };

const NOTHING: Progress = { lessons: {}, lastLessonId: null };

/** Named lessons, each finished the given number of days ago. */
const progressOf = (lessons: Record<string, number>): Progress => ({
  lastLessonId: null,
  lessons: Object.fromEntries(
    Object.entries(lessons).map(([id, ago]) => [id, { beatIndex: 0, completedAt: at(ago) }]),
  ),
});

/** One anonymous lesson per day given. */
const finished = (...agos: number[]): Progress =>
  progressOf(Object.fromEntries(agos.map((ago, i) => [`lesson-${i}`, ago])));

const asked = (...agos: number[]): DoubtEntry[] =>
  agos.map((ago, i) => ({ lessonId: 'class10-science-life-processes-autotrophic-nutrition', beatId: `beat-${i}`, at: at(ago) }));

const attempt = (lessonRef: string, score: number, total: number, ago: number): QuizAttempt => ({
  lessonRef,
  score,
  total,
  at: at(ago),
});

const record = (over: Partial<StudentRecord> = {}): StudentRecord => ({
  progress: NOTHING,
  doubts: [],
  quizzes: [],
  profile: NO_PROFILE,
  chapters: CHAPTERS,
  ...over,
});

/** One achievement of a record, by id — it must exist, so a miss is a failure. */
const of = (over: Partial<StudentRecord>, id: AchievementId): Achievement => {
  const item = achievements(record(over), TODAY).find((a) => a.id === id);
  if (item === undefined) throw new Error(`no achievement "${id}" in the catalogue`);
  return item;
};

describe('chaptersOf', () => {
  it('joins the real catalogue to the real syllabus', () => {
    expect(LIFE.id).toBe('class10-science/life-processes');
    expect(LIFE.title).toBe('Life Processes');
    expect(LIFE.lessonIds).toContain('class10-science-life-processes-autotrophic-nutrition');
    expect(LIFE.lessonIds.length).toBeGreaterThan(1);
  });

  it('lists no chapter that has no lesson yet', () => {
    for (const chapter of CHAPTERS) expect(chapter.lessonIds.length).toBeGreaterThan(0);
  });
});

describe('a student with no history', () => {
  const list = achievements(record(), TODAY);

  it('still gets the whole catalogue, every entry distinct', () => {
    expect(list).toHaveLength(10);
    expect(new Set(list.map((a) => a.id)).size).toBe(list.length);
  });

  it('has earned none of them, and none carries a date', () => {
    for (const item of list) {
      expect(item.earned).toBe(false);
      expect(item.earnedOn).toBeUndefined();
    }
  });

  it('gets a real target and a line saying how far off it is, on every one', () => {
    for (const item of list) {
      expect(item.progress?.target ?? 0).toBeGreaterThan(0);
      expect(item.progress?.value).toBe(0);
      expect((item.progress?.label ?? '').trim()).not.toBe('');
    }
  });

  it('is reported as a blank record, with the nearest one named', () => {
    expect(hasAnyProgress(list)).toBe(false);
    expect(nearestLocked(list)?.id).toBe('first-lesson');
  });
});

describe('lessons finished', () => {
  it('fires on the first finished lesson and not before', () => {
    expect(of({}, 'first-lesson').earned).toBe(false);
    expect(of({ progress: finished(2) }, 'first-lesson')).toMatchObject({
      earned: true,
      earnedOn: day(2),
    });
  });

  it('counts four of five, then fires on the fifth', () => {
    const four = of({ progress: finished(9, 8, 7, 6) }, 'five-lessons');
    expect(four.earned).toBe(false);
    expect(four.progress).toEqual({ value: 4, target: 5, label: '4 of 5 lessons finished' });

    const five = of({ progress: finished(9, 8, 7, 6, 5) }, 'five-lessons');
    expect(five).toMatchObject({ earned: true, earnedOn: day(5) });
    expect(five.progress).toBeUndefined();
  });

  it('counts nothing for a lesson that was started and left', () => {
    // A resume point with no completion time is a lesson still in progress.
    const started: Progress = {
      lastLessonId: 'class10-blood',
      lessons: { 'class10-blood': { beatIndex: 4 } },
    };

    expect(of({ progress: started }, 'first-lesson').earned).toBe(false);
    expect(of({ progress: started }, 'five-lessons').progress?.label).toBe(
      '0 of 5 lessons finished',
    );
  });
});

describe('a whole chapter', () => {
  const partial = Object.fromEntries(LIFE.lessonIds.slice(0, 4).map((id, i) => [id, 4 - i]));
  const whole = Object.fromEntries(
    LIFE.lessonIds.map((id, i) => [id, LIFE.lessonIds.length - i]),
  );

  it('names the chapter and counts the lessons left in it', () => {
    const item = of({ progress: progressOf(partial) }, 'chapter-complete');

    expect(item.earned).toBe(false);
    expect(item.progress).toEqual({
      value: 4,
      target: LIFE.lessonIds.length,
      label: `4 of ${LIFE.lessonIds.length} lessons in Life Processes`,
    });
  });

  it('fires on the last lesson of the chapter, dated to the day it was finished', () => {
    expect(of({ progress: progressOf(whole) }, 'chapter-complete')).toMatchObject({
      earned: true,
      earnedOn: day(1),
    });
  });

  it('is left out entirely until the catalogue has loaded', () => {
    // "0 of 0 lessons" is not a locked achievement, it is a false statement.
    const list = achievements(record({ chapters: [] }), TODAY);

    expect(list.map((a) => a.id)).not.toContain('chapter-complete');
    expect(list).toHaveLength(9);
  });
});

describe('questions asked', () => {
  it('fires on the first raised hand and not before', () => {
    expect(of({}, 'first-question').progress?.label).toBe('No questions asked yet');
    expect(of({ doubts: asked(3) }, 'first-question')).toMatchObject({
      earned: true,
      earnedOn: day(3),
    });
  });

  it('counts nine as nine, then fires on the tenth', () => {
    const nine = of({ doubts: asked(9, 8, 7, 6, 5, 4, 3, 2, 1) }, 'ten-questions');
    expect(nine.earned).toBe(false);
    expect(nine.progress).toEqual({ value: 9, target: 10, label: '9 of 10 questions asked' });

    expect(of({ doubts: asked(9, 8, 7, 6, 5, 4, 3, 2, 1, 0) }, 'ten-questions')).toMatchObject({
      earned: true,
      earnedOn: day(0),
    });
  });
});

describe('streaks', () => {
  it('does not fire at two days in a row', () => {
    const item = of({ progress: finished(2, 1) }, 'streak-3');

    expect(item.earned).toBe(false);
    expect(item.progress).toEqual({ value: 2, target: 3, label: '2 of 3 days in a row' });
  });

  it('fires on the third consecutive day, dated to that day', () => {
    expect(of({ progress: finished(2, 1, 0) }, 'streak-3')).toMatchObject({
      earned: true,
      earnedOn: day(0),
    });
  });

  it('does not count two runs of two as a run of three', () => {
    expect(of({ progress: finished(6, 5, 2, 1) }, 'streak-3').earned).toBe(false);
  });

  it('keeps a streak earned long after the run ended', () => {
    const item = of({ progress: finished(40, 39, 38) }, 'streak-3');

    expect(item).toMatchObject({ earned: true, earnedOn: day(38) });
    expect(item.progress).toBeUndefined();
  });

  it('measures the distance to a week by the run going on now', () => {
    const item = of({ progress: finished(40, 39, 38, 2, 1, 0) }, 'streak-7');

    // The record is three days and the current run is three; neither is seven.
    expect(item.earned).toBe(false);
    expect(item.progress?.label).toBe('3 of 7 days in a row');
  });

  it('fires on the seventh consecutive day', () => {
    expect(of({ progress: finished(6, 5, 4, 3, 2, 1, 0) }, 'streak-7')).toMatchObject({
      earned: true,
      earnedOn: day(0),
    });
  });
});

describe('the placement test', () => {
  it('fires only once it has actually been taken', () => {
    expect(of({}, 'placement-test').progress?.label).toBe('Placement test not taken yet');
    expect(
      of({ profile: { ...NO_PROFILE, diagnostic: PLACED, diagnosedAt: at(6) } }, 'placement-test'),
    ).toMatchObject({ earned: true, earnedOn: day(6) });
  });
});

describe('practice quizzes', () => {
  it('does not call seven of eight perfect, and says how close it was', () => {
    const item = of({ quizzes: [attempt('class10-blood', 7, 8, 3)] }, 'perfect-quiz');

    expect(item.earned).toBe(false);
    expect(item.progress).toEqual({
      value: 7,
      target: 8,
      label: 'Best so far 7 of 8 in one quiz',
    });
  });

  it('fires on the quiz where every answer was right', () => {
    expect(
      of({ quizzes: [attempt('a', 7, 8, 3), attempt('a', 8, 8, 2)] }, 'perfect-quiz'),
    ).toMatchObject({ earned: true, earnedOn: day(2) });
  });

  it('needs a second attempt at the SAME lesson to count as improvement', () => {
    const item = of({ quizzes: [attempt('a', 4, 8, 5), attempt('b', 7, 8, 4)] }, 'quiz-improved');

    expect(item.earned).toBe(false);
    expect(item.progress).toEqual({
      value: 1,
      target: 2,
      label: 'Best so far 7 of 8 — practise that lesson again and beat it',
    });
  });

  it('does not fire when the second attempt is no better', () => {
    expect(
      of({ quizzes: [attempt('a', 6, 8, 5), attempt('a', 5, 8, 3)] }, 'quiz-improved').earned,
    ).toBe(false);
  });

  it('is not fooled by the same result on a shorter quiz', () => {
    // 3 of 5 and 6 of 10 are the same result; neither beats the other.
    expect(
      of({ quizzes: [attempt('a', 3, 5, 5), attempt('a', 6, 10, 2)] }, 'quiz-improved').earned,
    ).toBe(false);
  });

  it('fires on the attempt that beat the earlier one, dated to it', () => {
    expect(
      of({ quizzes: [attempt('a', 5, 8, 5), attempt('a', 7, 8, 2)] }, 'quiz-improved'),
    ).toMatchObject({ earned: true, earnedOn: day(2) });
  });

  it('ignores an attempt with no questions in it', () => {
    const empty = { quizzes: [attempt('a', 0, 0, 5)] };

    expect(of(empty, 'perfect-quiz').progress?.label).toBe('No practice quiz taken yet');
    expect(of(empty, 'quiz-improved').progress?.label).toBe('No practice quiz taken yet');
  });
});

describe('the order the screen draws them in', () => {
  const list = achievements(
    record({
      progress: finished(2, 1, 0),
      doubts: asked(1),
      quizzes: [attempt('class10-blood', 8, 8, 0)],
    }),
    TODAY,
  );
  const { earned, locked } = splitAchievements(list);

  it('lists every achievement exactly once, in one list or the other', () => {
    expect(earned.length + locked.length).toBe(list.length);
    expect(earned.length).toBeGreaterThan(0);
    expect(locked.length).toBeGreaterThan(0);
  });

  it('puts the most recently earned first', () => {
    const days = earned.map((item) => item.earnedOn ?? '');

    expect(days[0]).toBe(day(0));
    expect([...days].sort().reverse()).toEqual(days);
  });

  it('puts the nearest locked one first', () => {
    const fractions = locked.map((item) =>
      item.progress ? item.progress.value / item.progress.target : 1,
    );

    expect([...fractions].sort((a, b) => b - a)).toEqual(fractions);
    expect(nearestLocked(list)?.id).toBe(locked[0].id);
  });

  it('reports that something has happened', () => {
    expect(hasAnyProgress(list)).toBe(true);
  });
});

describe('what this product does not have', () => {
  /**
   * There are no points, levels or leagues in this app. A card implying one
   * would be a promise it cannot keep, so the words are barred outright — the
   * same line StreakDetail holds.
   */
  const FORBIDDEN = [
    'point',
    'xp',
    'coin',
    'gem',
    'level',
    'league',
    'rank',
    'leaderboard',
    'freeze',
    'badge',
    'trophy',
    'reward',
  ];

  const everything = achievements(
    record({
      progress: finished(3, 2, 1, 0),
      doubts: asked(4, 3, 2, 1),
      quizzes: [attempt('a', 5, 8, 3), attempt('a', 7, 8, 1)],
      profile: { ...NO_PROFILE, diagnostic: PLACED, diagnosedAt: at(5) },
    }),
    TODAY,
  );

  it('never says any of them, earned or locked', () => {
    const words = [...everything, ...achievements(record(), TODAY)]
      .flatMap((item) => [item.title, item.body, item.progress?.label ?? '', item.icon])
      .join(' ')
      .toLowerCase();

    for (const word of FORBIDDEN) {
      expect(words).not.toMatch(new RegExp(`\\b${word}s?\\b`));
    }
  });
});
