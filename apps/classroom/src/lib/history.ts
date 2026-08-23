import type { Lesson } from '@ai-tutor/lesson-format';
import type { DoubtEntry } from '../stores/doubtLog';
import { computeStreak, type Progress } from '../stores/progress';
import type { CatalogEntry } from './content';

/**
 * The student's own record, derived from the only two things the app collects:
 * a doubt log (lesson, beat, timestamp) and a completion time per lesson.
 * Nothing here is a new signal — every function folds those two.
 *
 * Pure and clock-free: the current day is always passed in, so a test never has
 * to freeze time.
 *
 * DAY BOUNDARY: every day key is the UTC calendar day of the timestamp, which
 * is what computeStreak counts by. Two boundaries would let the activity grid
 * contradict the streak number printed directly above it, and a student would
 * be right to trust neither.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Both stores write `new Date().toISOString()`, so the first ten chars are the UTC day. */
const dayKey = (iso: string): string => iso.slice(0, 10);

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

const shiftDays = (date: Date, by: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + by);
  return next;
};

const dayAfter = (day: string): string => dayOf(shiftDays(new Date(`${day}T00:00:00.000Z`), 1));

// ----------------------------------------------------------------- doubts

export interface DoubtDay {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  /** The questions asked that day, newest first. */
  doubts: DoubtEntry[];
}

/** The log split into days, newest day first. */
export function groupDoubtsByDay(doubts: readonly DoubtEntry[]): DoubtDay[] {
  const byDay = new Map<string, DoubtEntry[]>();
  for (const doubt of doubts) {
    const key = dayKey(doubt.at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(doubt);
    else byDay.set(key, [doubt]);
  }

  return [...byDay.entries()]
    .map(([day, entries]) => ({
      day,
      doubts: [...entries].sort((a, b) => b.at.localeCompare(a.at)),
    }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

export interface BeatDoubts {
  beatId: string;
  count: number;
}

export interface LessonDoubts {
  lessonId: string;
  count: number;
  /** Per-beat totals, most-asked first — the beat is the actionable unit. */
  beats: BeatDoubts[];
}

/** The log folded by lesson, most-asked lesson first. Ties keep first-asked order. */
export function groupDoubtsByLesson(doubts: readonly DoubtEntry[]): LessonDoubts[] {
  const byLesson = new Map<string, Map<string, number>>();
  for (const doubt of doubts) {
    const beats = byLesson.get(doubt.lessonId) ?? new Map<string, number>();
    beats.set(doubt.beatId, (beats.get(doubt.beatId) ?? 0) + 1);
    byLesson.set(doubt.lessonId, beats);
  }

  return [...byLesson.entries()]
    .map(([lessonId, beats]) => ({
      lessonId,
      count: [...beats.values()].reduce((total, n) => total + n, 0),
      beats: [...beats.entries()]
        .map(([beatId, count]) => ({ beatId, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);
}

export interface DoubtSpot {
  lessonId: string;
  beatId: string;
  count: number;
}

/** The single beat that drew the most questions, or null on an empty log. */
export function mostAskedBeat(doubts: readonly DoubtEntry[]): DoubtSpot | null {
  let best: DoubtSpot | null = null;
  for (const lesson of groupDoubtsByLesson(doubts)) {
    const top = lesson.beats[0];
    if (top !== undefined && (best === null || top.count > best.count)) {
      best = { lessonId: lesson.lessonId, beatId: top.beatId, count: top.count };
    }
  }
  return best;
}

// --------------------------------------------------------------- calendar

/** What happened on a day. A finished lesson outranks a question asked. */
export type DayActivity = 'none' | 'doubts' | 'lesson';

export interface ActivityDay {
  day: string;
  lessons: number;
  doubts: number;
  activity: DayActivity;
}

/** Twelve weeks — the window the streak screen draws. */
export const CALENDAR_DAYS = 84;

/**
 * A zero-filled window of days ending on `today`, oldest first. Filled rather
 * than derived from the data so the grid is always the same shape: a calendar
 * with holes in it reads as a rendering bug, not as a quiet week.
 */
export function activityCalendar(
  progress: Progress,
  doubts: readonly DoubtEntry[],
  options: { today: Date; days?: number },
): ActivityDay[] {
  const length = options.days ?? CALENDAR_DAYS;

  const lessonsPerDay = new Map<string, number>();
  for (const lesson of Object.values(progress.lessons)) {
    if (lesson.completedAt === undefined) continue;
    const key = dayKey(lesson.completedAt);
    lessonsPerDay.set(key, (lessonsPerDay.get(key) ?? 0) + 1);
  }

  const doubtsPerDay = new Map<string, number>();
  for (const doubt of doubts) {
    const key = dayKey(doubt.at);
    doubtsPerDay.set(key, (doubtsPerDay.get(key) ?? 0) + 1);
  }

  const grid: ActivityDay[] = [];
  let cursor = shiftDays(options.today, -(length - 1));
  for (let i = 0; i < length; i += 1) {
    const day = dayOf(cursor);
    const lessons = lessonsPerDay.get(day) ?? 0;
    const asked = doubtsPerDay.get(day) ?? 0;
    grid.push({
      day,
      lessons,
      doubts: asked,
      activity: lessons > 0 ? 'lesson' : asked > 0 ? 'doubts' : 'none',
    });
    cursor = shiftDays(cursor, 1);
  }
  return grid;
}

// ----------------------------------------------------------------- streak

export interface StreakBounds {
  current: number;
  longest: number;
  /** Most recent day a lesson was finished, or null if none ever was. */
  lastActiveDay: string | null;
}

/**
 * The streak, both ends of it.
 *
 * `current` delegates to computeStreak rather than repeating the same walk:
 * this screen and the Home badge have to print the same number, and one
 * implementation is the only way to guarantee they always will.
 */
export function streakBounds(progress: Progress, today: Date): StreakBounds {
  const days = [
    ...new Set(
      Object.values(progress.lessons)
        .map((lesson) => lesson.completedAt)
        .filter((iso): iso is string => iso !== undefined)
        .map(dayKey),
    ),
  ].sort();

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of days) {
    run = previous !== null && day === dayAfter(previous) ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }

  return {
    current: computeStreak(progress, today),
    longest,
    lastActiveDay: days.length > 0 ? days[days.length - 1] : null,
  };
}

// -------------------------------------------------------------- labelling

export interface LessonLabels {
  title: string;
  /** Beat id → the beat's plain-language topic. */
  beats: Record<string, string>;
}

export type LabelBook = Record<string, LessonLabels>;

/**
 * Ids → human labels. Titles come from the catalog and beat topics from the
 * lesson files, so a lesson whose file failed to load still contributes its
 * title and its rows degrade to raw beat ids instead of vanishing.
 */
export function labelBook(
  catalog: readonly CatalogEntry[],
  lessons: readonly Lesson[],
): LabelBook {
  const book: LabelBook = {};
  for (const entry of catalog) book[entry.id] = { title: entry.title, beats: {} };

  for (const lesson of lessons) {
    const beats: Record<string, string> = {};
    for (const beat of lesson.beats) beats[beat.id] = beat.topic;
    book[lesson.id] = { title: book[lesson.id]?.title ?? lesson.title, beats };
  }
  return book;
}

/**
 * "18 August 2026". Built from the key's own parts — parsing it into a Date
 * would re-read a UTC day in the reader's timezone and land a day off west of
 * Greenwich.
 */
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const name = MONTHS[month - 1];
  return name === undefined || Number.isNaN(date) ? day : `${date} ${name} ${year}`;
}

/** "Today", "Yesterday", then the date. */
export function dayLabel(day: string, today: Date): string {
  if (day === dayOf(today)) return 'Today';
  if (day === dayOf(shiftDays(today, -1))) return 'Yesterday';
  return formatDay(day);
}

/**
 * The clock time of a question, in the reader's own timezone — a doubt raised
 * at 8 pm has to read as 8 pm. The day headings above it are UTC days (the
 * boundary the streak counts by), so the two disagree for a question asked
 * between midnight and the UTC offset. That heading is the coarser of the two,
 * and the alternative is a clock that is wrong all day, every day.
 */
export function timeLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
