import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import type { CatalogEntry } from '../src/lib/content';
import {
  CALENDAR_DAYS,
  activityCalendar,
  dayLabel,
  formatDay,
  groupDoubtsByDay,
  groupDoubtsByLesson,
  labelBook,
  mostAskedBeat,
  streakBounds,
  timeLabel,
} from '../src/lib/history';
import type { DoubtEntry } from '../src/stores/doubtLog';
import { computeStreak, type Progress } from '../src/stores/progress';

/**
 * The committed Class 10 lesson, loaded and validated the way the app loads it.
 * Beat ids and topics come from real content, so a rename in the lesson format
 * fails here rather than showing a student a raw id.
 */
const ROOT = process.cwd();
const loadLesson = (id: string): Lesson => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'content', id, 'lesson.json'), 'utf8'),
  ) as unknown;
  const result = validateLesson(raw);
  if (!result.ok) throw new Error(`${id} is not a valid lesson: ${result.errors.join('; ')}`);
  return result.lesson;
};

const NUTRITION = loadLesson('class10-science-life-processes-autotrophic-nutrition');
const CATALOG = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'content/index.json'), 'utf8'),
) as { lessons: CatalogEntry[] };

const TODAY = new Date('2026-08-22T15:00:00.000Z');

const doubt = (at: string, lessonId: string, beatId: string): DoubtEntry => ({
  lessonId,
  beatId,
  at,
});

const progressWith = (...days: string[]): Progress => ({
  lastLessonId: null,
  lessons: Object.fromEntries(
    days.map((day, i) => [`l${i}`, { beatIndex: 0, completedAt: `${day}T10:00:00.000Z` }]),
  ),
});

/**
 * Two questions four minutes apart, either side of midnight UTC. Whatever else
 * changes, these two must never land in the same bucket.
 */
const LOG: DoubtEntry[] = [
  doubt('2026-08-20T09:15:00.000Z', 'class10-science-life-processes-autotrophic-nutrition', 'leaf_factory'),
  doubt('2026-08-21T23:58:00.000Z', 'class10-science-life-processes-autotrophic-nutrition', 'photosynthesis'),
  doubt('2026-08-22T00:02:00.000Z', 'class10-respiration', 'hook'),
  doubt('2026-08-22T18:40:00.000Z', 'class10-science-life-processes-autotrophic-nutrition', 'photosynthesis'),
];

describe('groupDoubtsByDay', () => {
  it('puts the newest day first', () => {
    expect(groupDoubtsByDay(LOG).map((d) => d.day)).toEqual([
      '2026-08-22',
      '2026-08-21',
      '2026-08-20',
    ]);
  });

  it('splits two questions minutes apart across the day boundary', () => {
    const [newest, yesterday] = groupDoubtsByDay(LOG);

    expect(newest.doubts.map((d) => d.at)).toContain('2026-08-22T00:02:00.000Z');
    expect(yesterday.doubts.map((d) => d.at)).toContain('2026-08-21T23:58:00.000Z');
  });

  it('orders the questions inside a day newest first', () => {
    expect(groupDoubtsByDay(LOG)[0].doubts.map((d) => d.at)).toEqual([
      '2026-08-22T18:40:00.000Z',
      '2026-08-22T00:02:00.000Z',
    ]);
  });

  it('loses nothing: every logged question lands in exactly one day', () => {
    const grouped = groupDoubtsByDay(LOG).flatMap((d) => d.doubts);

    expect(grouped).toHaveLength(LOG.length);
    expect(new Set(grouped.map((d) => d.at)).size).toBe(LOG.length);
  });

  it('groups an empty log into no days at all', () => {
    expect(groupDoubtsByDay([])).toEqual([]);
  });

  it('does not mutate the log it was handed', () => {
    const original = [...LOG];
    groupDoubtsByDay(LOG);

    expect(LOG).toEqual(original);
  });
});

describe('groupDoubtsByLesson', () => {
  it('puts the most-asked lesson first, with its total', () => {
    const [first, second] = groupDoubtsByLesson(LOG);

    expect(first).toMatchObject({ lessonId: 'class10-science-life-processes-autotrophic-nutrition', count: 3 });
    expect(second).toMatchObject({ lessonId: 'class10-respiration', count: 1 });
  });

  it('counts each beat inside the lesson, most-asked first', () => {
    expect(groupDoubtsByLesson(LOG)[0].beats).toEqual([
      { beatId: 'photosynthesis', count: 2 },
      { beatId: 'leaf_factory', count: 1 },
    ]);
  });

  it('has each lesson total equal the sum of its beats', () => {
    for (const lesson of groupDoubtsByLesson(LOG)) {
      expect(lesson.beats.reduce((n, b) => n + b.count, 0)).toBe(lesson.count);
    }
  });
});

describe('mostAskedBeat', () => {
  it('names the single beat that drew the most questions', () => {
    expect(mostAskedBeat(LOG)).toEqual({
      lessonId: 'class10-science-life-processes-autotrophic-nutrition',
      beatId: 'photosynthesis',
      count: 2,
    });
  });

  it('picks the top beat across lessons, not the top beat of the top lesson', () => {
    // Nutrition is asked about more overall, but one respiration beat beats
    // any single nutrition beat.
    const log = [
      ...LOG,
      doubt('2026-08-22T19:00:00.000Z', 'class10-respiration', 'hook'),
      doubt('2026-08-22T19:05:00.000Z', 'class10-respiration', 'hook'),
    ];

    expect(groupDoubtsByLesson(log)[0].lessonId).toBe('class10-science-life-processes-autotrophic-nutrition');
    expect(mostAskedBeat(log)).toEqual({
      lessonId: 'class10-respiration',
      beatId: 'hook',
      count: 3,
    });
  });

  it('is null when nothing has been asked', () => {
    expect(mostAskedBeat([])).toBeNull();
  });
});

describe('activityCalendar', () => {
  it('returns exactly the number of days requested', () => {
    for (const days of [1, 7, 30, 84]) {
      expect(activityCalendar(progressWith(), [], { today: TODAY, days })).toHaveLength(days);
    }
  });

  it('defaults to the twelve-week window the screen draws', () => {
    expect(activityCalendar(progressWith(), [], { today: TODAY })).toHaveLength(CALENDAR_DAYS);
    expect(CALENDAR_DAYS).toBe(84);
  });

  it('ends on the day it was given and runs oldest first', () => {
    const grid = activityCalendar(progressWith(), [], { today: TODAY, days: 30 });

    expect(grid[grid.length - 1].day).toBe('2026-08-22');
    expect(grid[0].day).toBe('2026-07-24');
    expect(grid.map((d) => d.day)).toEqual([...grid.map((d) => d.day)].sort());
  });

  it('zero-fills, so the grid never has a hole', () => {
    const grid = activityCalendar(progressWith('2026-08-22'), [], { today: TODAY, days: 84 });
    const quiet = grid.filter((d) => d.day !== '2026-08-22');

    expect(quiet).toHaveLength(83);
    for (const day of quiet) {
      expect(day).toMatchObject({ lessons: 0, doubts: 0, activity: 'none' });
    }
  });

  it('has one entry per calendar day, with no gaps and no repeats', () => {
    const grid = activityCalendar(progressWith(), [], { today: TODAY, days: 40 });
    const days = grid.map((d) => d.day);

    expect(new Set(days).size).toBe(days.length);
    for (let i = 1; i < grid.length; i += 1) {
      const gap =
        (Date.parse(`${days[i]}T00:00:00.000Z`) - Date.parse(`${days[i - 1]}T00:00:00.000Z`)) /
        86_400_000;
      expect(gap).toBe(1);
    }
  });

  it('counts lessons and questions on the day they happened', () => {
    const grid = activityCalendar(progressWith('2026-08-20', '2026-08-20'), LOG, {
      today: TODAY,
      days: 7,
    });
    const on = (day: string) => grid.find((d) => d.day === day);

    expect(on('2026-08-20')).toMatchObject({ lessons: 2, doubts: 1, activity: 'lesson' });
    expect(on('2026-08-21')).toMatchObject({ lessons: 0, doubts: 1, activity: 'doubts' });
    expect(on('2026-08-22')).toMatchObject({ lessons: 0, doubts: 2, activity: 'doubts' });
  });

  it('ignores anything older than the window', () => {
    const grid = activityCalendar(progressWith('2026-01-04'), [], { today: TODAY, days: 7 });

    expect(grid.every((d) => d.activity === 'none')).toBe(true);
  });
});

describe('streakBounds', () => {
  const cases: Record<string, Progress> = {
    'nothing at all': progressWith(),
    'a run ending today': progressWith('2026-08-20', '2026-08-21', '2026-08-22'),
    'a run ending yesterday': progressWith('2026-08-20', '2026-08-21'),
    'a broken run': progressWith('2026-08-14', '2026-08-15', '2026-08-19'),
    'one day, twice over': progressWith('2026-08-22', '2026-08-22'),
    'an old record and a new run': progressWith(
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05',
      '2026-08-21', '2026-08-22',
    ),
  };

  it.each(Object.entries(cases))(
    'reports the same current streak as computeStreak: %s',
    (_name, progress) => {
      expect(streakBounds(progress, TODAY).current).toBe(computeStreak(progress, TODAY));
    },
  );

  it('finds a longest run that is not the current one', () => {
    const bounds = streakBounds(cases['an old record and a new run'], TODAY);

    expect(bounds.current).toBe(2);
    expect(bounds.longest).toBe(5);
  });

  it('never reports a record shorter than the streak running now', () => {
    for (const progress of Object.values(cases)) {
      const bounds = streakBounds(progress, TODAY);
      expect(bounds.longest).toBeGreaterThanOrEqual(bounds.current);
    }
  });

  it('counts a day once however many lessons were finished on it', () => {
    expect(streakBounds(cases['one day, twice over'], TODAY).longest).toBe(1);
  });

  it('names the last day a lesson was finished', () => {
    expect(streakBounds(cases['a broken run'], TODAY).lastActiveDay).toBe('2026-08-19');
    expect(streakBounds(cases['nothing at all'], TODAY).lastActiveDay).toBeNull();
  });

  it('is all zeroes when nothing has ever been finished', () => {
    expect(streakBounds(progressWith(), TODAY)).toEqual({
      current: 0,
      longest: 0,
      lastActiveDay: null,
    });
  });

  it('spans a month boundary as one unbroken run', () => {
    const bounds = streakBounds(
      progressWith('2026-07-30', '2026-07-31', '2026-08-01'),
      new Date('2026-08-01T20:00:00.000Z'),
    );

    expect(bounds.longest).toBe(3);
    expect(bounds.current).toBe(3);
  });
});

describe('labelBook', () => {
  it('takes titles from the catalog and beat topics from the lesson', () => {
    const book = labelBook(CATALOG.lessons, [NUTRITION]);

    expect(book['class10-science-life-processes-autotrophic-nutrition'].title).toBe('Autotrophic Nutrition');
    for (const beat of NUTRITION.beats) {
      expect(book['class10-science-life-processes-autotrophic-nutrition'].beats[beat.id]).toBe(beat.topic);
    }
  });

  it('keeps a catalog title even when the lesson file never loaded', () => {
    const book = labelBook(CATALOG.lessons, []);

    expect(book['class10-respiration'].title).toBe('Respiration');
    expect(book['class10-respiration'].beats).toEqual({});
  });

  it("falls back to the lesson's own title when it is not in the catalog", () => {
    const book = labelBook([], [NUTRITION]);

    expect(book['class10-science-life-processes-autotrophic-nutrition'].title).toBe(NUTRITION.title);
  });

  it('has nothing to say about a lesson it has never seen', () => {
    expect(labelBook(CATALOG.lessons, [NUTRITION])['class10-withdrawn']).toBeUndefined();
  });
});

describe('day and time labels', () => {
  it('says Today and Yesterday before it says a date', () => {
    expect(dayLabel('2026-08-22', TODAY)).toBe('Today');
    expect(dayLabel('2026-08-21', TODAY)).toBe('Yesterday');
    expect(dayLabel('2026-08-20', TODAY)).toBe('20 August 2026');
  });

  it('crosses a month boundary to find yesterday', () => {
    expect(dayLabel('2026-07-31', new Date('2026-08-01T09:00:00.000Z'))).toBe('Yesterday');
  });

  it('spells the date out in English', () => {
    expect(formatDay('2026-01-09')).toBe('9 January 2026');
    expect(formatDay('2026-12-31')).toBe('31 December 2026');
  });

  it('hands back a key it cannot parse rather than inventing a month', () => {
    expect(formatDay('not-a-day')).toBe('not-a-day');
    expect(formatDay('2026-13-01')).toBe('2026-13-01');
  });

  it('renders a clock time, and nothing at all for a broken timestamp', () => {
    const label = timeLabel('2026-08-22T18:40:00.000Z');

    expect(label).not.toBe('');
    expect(label).not.toContain('Invalid');
    expect(timeLabel('whenever')).toBe('');
  });
});
