import type { SubjectSyllabus } from '@ai-tutor/syllabus';
import type { CatalogEntry } from './content';
import { streakBounds } from './history';
import type { DoubtEntry } from '../stores/doubtLog';
import type { StudentProfile } from '../stores/profile';
import { computeStreak, type Progress } from '../stores/progress';
import { bestScore, type QuizAttempt } from '../stores/quizHistory';

/**
 * What the student has actually done, said out loud.
 *
 * THE RULE THIS FILE EXISTS TO HOLD: an achievement may only be derived from
 * something the app already records — a lesson finished, a hand raised, a quiz
 * attempted, a placement test taken. There are no points, no levels and nothing
 * to collect here, because the product has none of those systems and a card
 * implying one would be a promise it cannot keep.
 *
 * Each achievement is defined exactly once, right here, so the card, its
 * progress bar and its date can never tell three different stories.
 *
 * Pure and clock-free, like lib/history.ts: `today` is a parameter, and every
 * day is the UTC calendar day of its timestamp — the same boundary the streak
 * counts by, so an achievement can never contradict the streak that earned it.
 */

export type AchievementId =
  | 'first-lesson'
  | 'five-lessons'
  | 'chapter-complete'
  | 'first-question'
  | 'ten-questions'
  | 'streak-3'
  | 'streak-7'
  | 'placement-test'
  | 'perfect-quiz'
  | 'quiz-improved';

export interface AchievementProgress {
  value: number;
  /** Never zero: a bar with no target is not progress. */
  target: number;
  /** The line that teaches — "3 of 10 questions asked" — never a bare number. */
  label: string;
}

export interface Achievement {
  id: AchievementId;
  title: string;
  /** The rule, in one line. Tense-neutral: it heads an earned card and a locked one. */
  body: string;
  /** Material Symbols name. */
  icon: string;
  earned: boolean;
  /** UTC day it was earned, when the stored data can say which. */
  earnedOn?: string;
  /** Present only while it is unearned. */
  progress?: AchievementProgress;
}

/** Which lessons make up one chapter. Built by `chaptersOf` from the catalogue. */
export interface ChapterLessons {
  /** "<syllabusId>/<chapterId>". */
  id: string;
  title: string;
  lessonIds: string[];
}

/** Everything the app knows about one student, in one argument. */
export interface StudentRecord {
  progress: Progress;
  doubts: readonly DoubtEntry[];
  quizzes: readonly QuizAttempt[];
  profile: StudentProfile;
  /**
   * Chapter membership — empty until the lesson catalogue has loaded. While it
   * is empty the chapter achievement is left OUT of the catalogue rather than
   * shown at zero: "0 of 0 lessons" is not a locked achievement, it is a false
   * statement about where the student stands.
   */
  chapters: readonly ChapterLessons[];
}

// ----------------------------------------------------------------- helpers

/** Every timestamp is `new Date().toISOString()`, so the first ten chars are the UTC day. */
const dayOf = (iso: string): string => iso.slice(0, 10);

const nextDay = (day: string): string => {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** One entry per finished lesson, oldest first — so the nth is the day the nth was finished. */
const completionDays = (progress: Progress): string[] =>
  Object.values(progress.lessons)
    .map((lesson) => lesson.completedAt)
    .filter((iso): iso is string => iso !== undefined)
    .map(dayOf)
    .sort();

/**
 * The first day a run of consecutive active days reached `length`.
 *
 * `streakBounds` stays the one authority on WHETHER a run that long happened;
 * this walk exists only for the date it does not return. If the two ever
 * disagreed, the card would lose its date — never its truth.
 */
function dayRunReached(days: readonly string[], length: number): string | undefined {
  let run = 0;
  let previous: string | null = null;
  for (const day of [...new Set(days)].sort()) {
    run = previous !== null && day === nextDay(previous) ? run + 1 : 1;
    if (run >= length) return day;
    previous = day;
  }
  return undefined;
}

/**
 * Is `a` a better result than `b`? Ratios by cross-multiplication, integers
 * only — the rule stores/quizHistory already compares attempts by, so the two
 * screens can never disagree about which attempt was the better one.
 */
const beats = (a: QuizAttempt, b: QuizAttempt): boolean => a.score * b.total > b.score * a.total;

/** The attempt that came nearest to full marks; the longer quiz wins an exact tie. */
function closestToPerfect(attempts: readonly QuizAttempt[]): QuizAttempt | null {
  let best: QuizAttempt | null = null;
  for (const attempt of attempts) {
    if (
      best === null ||
      beats(attempt, best) ||
      (!beats(best, attempt) && attempt.total > best.total)
    ) {
      best = attempt;
    }
  }
  return best;
}

/**
 * The first attempt that beat the student's own best on THAT lesson, or null.
 * Same lesson, later attempt, better ratio — a higher score on an easier quiz
 * somewhere else is not improvement.
 */
function firstImprovement(attempts: readonly QuizAttempt[]): QuizAttempt | null {
  const best = new Map<string, QuizAttempt>();
  for (const attempt of attempts) {
    const previous = best.get(attempt.lessonRef);
    if (previous === undefined) best.set(attempt.lessonRef, attempt);
    else if (beats(attempt, previous)) return attempt;
  }
  return null;
}

interface ChapterStanding {
  title: string;
  done: number;
  total: number;
  /** The day the last of its lessons was finished; absent until all of them are. */
  completedOn?: string;
}

/** Nearer to done wins; a finished chapter beats every unfinished one. */
const isCloser = (a: ChapterStanding, b: ChapterStanding): boolean => {
  const aDone = a.done === a.total;
  const bDone = b.done === b.total;
  if (aDone !== bDone) return aDone;
  if (a.done !== b.done) return a.done > b.done;
  return a.total - a.done < b.total - b.done;
};

/** The chapter this student is closest to finishing, or null when none is known. */
function closestChapter(
  chapters: readonly ChapterLessons[],
  progress: Progress,
): ChapterStanding | null {
  let best: ChapterStanding | null = null;
  for (const chapter of chapters) {
    if (chapter.lessonIds.length === 0) continue;
    const days = chapter.lessonIds
      .map((lessonId) => progress.lessons[lessonId]?.completedAt)
      .filter((iso): iso is string => iso !== undefined)
      .map(dayOf)
      .sort();
    const finished = days.length === chapter.lessonIds.length;
    const standing: ChapterStanding = {
      title: chapter.title,
      done: days.length,
      total: chapter.lessonIds.length,
      ...(finished ? { completedOn: days[days.length - 1] } : {}),
    };
    if (best === null || isCloser(standing, best)) best = standing;
  }
  return best;
}

/**
 * Which lessons sit in which chapter, from the catalogue's own `topicRef`
 * ("<syllabusId>/<chapterId>/<topicId>"). A chapter with no lesson yet never
 * appears, so a student is never measured against content that does not exist.
 */
export function chaptersOf(
  syllabi: readonly SubjectSyllabus[],
  catalog: readonly CatalogEntry[],
): ChapterLessons[] {
  const byChapter = new Map<string, string[]>();
  for (const entry of catalog) {
    if (entry.topicRef === undefined) continue;
    const [syllabusId, chapterId] = entry.topicRef.split('/');
    if (!syllabusId || !chapterId) continue;
    const key = `${syllabusId}/${chapterId}`;
    const lessons = byChapter.get(key);
    if (lessons) lessons.push(entry.id);
    else byChapter.set(key, [entry.id]);
  }

  return [...byChapter].map(([id, lessonIds]) => {
    const [syllabusId, chapterId] = id.split('/');
    const chapter = syllabi
      .find((s) => s.id === syllabusId)
      ?.chapters.find((c) => c.id === chapterId);
    // A chapter the syllabus does not name still counts: its id is a poor
    // label but a true one, and dropping it would hide finished work.
    return { id, title: chapter?.title ?? chapterId, lessonIds };
  });
}

// ------------------------------------------------------------- the catalogue

type Spec = Pick<Achievement, 'id' | 'title' | 'body' | 'icon'>;

interface Verdict {
  earned: boolean;
  /** The day it was earned, where the data can say. Read only when earned. */
  on?: string;
  /** Read only while unearned. */
  progress: AchievementProgress;
}

/** The shape of every achievement that is a count against a target. */
const counted = (value: number, target: number, label: string, on?: string): Verdict => ({
  earned: value >= target,
  on,
  progress: { value, target, label },
});

const card = (spec: Spec, verdict: Verdict): Achievement =>
  verdict.earned
    ? { ...spec, earned: true, ...(verdict.on === undefined ? {} : { earnedOn: verdict.on }) }
    : { ...spec, earned: false, progress: verdict.progress };

/**
 * The whole catalogue, every entry answered for this student. The order here is
 * the catalogue's own; the screen sorts it (see `splitAchievements`).
 */
export function achievements(record: StudentRecord, today: Date): Achievement[] {
  const { progress, doubts, quizzes, profile } = record;

  const lessonDays = completionDays(progress);
  const finished = lessonDays.length;

  const askedDays = [...doubts]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((doubt) => dayOf(doubt.at));

  const attempts = [...quizzes]
    .filter((attempt) => attempt.total > 0)
    .sort((a, b) => a.at.localeCompare(b.at));
  const perfect = attempts.find((attempt) => attempt.score === attempt.total);
  const nearPerfect = closestToPerfect(attempts);
  const improvement = firstImprovement(attempts);
  const lastPractised = attempts.at(-1);
  // The score to beat is that lesson's own best, which is exactly what
  // `quiz-improved` asks for — never a friendlier number from another lesson.
  const toBeat = lastPractised === undefined ? null : bestScore(attempts, lastPractised.lessonRef);

  const longest = streakBounds(progress, today).longest;
  const running = computeStreak(progress, today);
  const streak = (length: number): Verdict => ({
    earned: longest >= length,
    on: dayRunReached(lessonDays, length),
    // The distance shown is the run going on NOW, not the record: a student
    // whose best week was in July needs today, not a reminder of July.
    progress: { value: running, target: length, label: `${running} of ${length} days in a row` },
  });

  const chapter = closestChapter(record.chapters, progress);

  return [
    card(
      {
        id: 'first-lesson',
        title: 'First class finished',
        body: 'Watch one class all the way to the end.',
        icon: 'school',
      },
      counted(finished, 1, 'No lesson finished yet', lessonDays.at(0)),
    ),
    card(
      {
        id: 'five-lessons',
        title: 'Five lessons in',
        body: 'Finish five lessons in all.',
        icon: 'library_books',
      },
      counted(finished, 5, `${finished} of 5 lessons finished`, lessonDays.at(4)),
    ),
    ...(chapter === null
      ? []
      : [
          card(
            {
              id: 'chapter-complete',
              title: 'Chapter finished',
              body: 'Finish every lesson in one chapter.',
              icon: 'menu_book',
            },
            counted(
              chapter.done,
              chapter.total,
              `${chapter.done} of ${chapter.total} lessons in ${chapter.title}`,
              chapter.completedOn,
            ),
          ),
        ]),
    card(
      {
        id: 'first-question',
        title: 'You raised your hand',
        body: 'Stop a class and ask the tutor a question.',
        icon: 'back_hand',
      },
      counted(askedDays.length, 1, 'No questions asked yet', askedDays.at(0)),
    ),
    card(
      {
        id: 'ten-questions',
        title: 'Ten questions asked',
        body: 'Ask ten questions in class.',
        icon: 'forum',
      },
      counted(askedDays.length, 10, `${askedDays.length} of 10 questions asked`, askedDays.at(9)),
    ),
    card(
      {
        id: 'streak-3',
        title: 'Three days running',
        body: 'Finish a lesson on three days in a row.',
        icon: 'local_fire_department',
      },
      streak(3),
    ),
    card(
      {
        id: 'streak-7',
        title: 'A full week',
        body: 'Finish a lesson on seven days in a row.',
        icon: 'calendar_month',
      },
      streak(7),
    ),
    card(
      {
        id: 'placement-test',
        title: 'You know where you stand',
        body: 'Take the placement test, so lessons start where you are.',
        icon: 'psychology',
      },
      counted(
        profile.diagnostic === null ? 0 : 1,
        1,
        'Placement test not taken yet',
        profile.diagnosedAt === null ? undefined : dayOf(profile.diagnosedAt),
      ),
    ),
    card(
      {
        id: 'perfect-quiz',
        title: 'A perfect quiz',
        body: 'Get every question right in one practice quiz.',
        icon: 'done_all',
      },
      {
        earned: perfect !== undefined,
        on: perfect === undefined ? undefined : dayOf(perfect.at),
        progress:
          nearPerfect === null
            ? { value: 0, target: 1, label: 'No practice quiz taken yet' }
            : {
                value: nearPerfect.score,
                target: nearPerfect.total,
                label: `Best so far ${nearPerfect.score} of ${nearPerfect.total} in one quiz`,
              },
      },
    ),
    card(
      {
        id: 'quiz-improved',
        title: 'Better than last time',
        body: 'Practise a lesson again and beat your own best score on it.',
        icon: 'trending_up',
      },
      {
        earned: improvement !== null,
        on: improvement === null ? undefined : dayOf(improvement.at),
        // Two halves, and only two: put a score on the board, then beat it.
        // Counting attempts instead would show 3 of 2 to a student who has
        // practised three times without improving.
        progress: {
          value: toBeat === null ? 0 : 1,
          target: 2,
          label:
            toBeat === null
              ? 'No practice quiz taken yet'
              : `Best so far ${toBeat.score} of ${toBeat.total} — practise that lesson again and beat it`,
        },
      },
    ),
  ];
}

// ------------------------------------------------------------------ sorting

/** How far along an achievement is, 0..1. An earned one sorts as a full bar. */
const fraction = (item: Achievement): number =>
  item.progress === undefined || item.progress.target <= 0
    ? 1
    : Math.min(item.progress.value / item.progress.target, 1);

export interface AchievementSplit {
  /** Most recently earned first; any without a stored date come last. */
  earned: Achievement[];
  /** Nearest to earned first. */
  locked: Achievement[];
}

/**
 * The two lists the screen draws.
 *
 * Both sorts are stable, so whatever the data cannot separate keeps the
 * catalogue's own order — which is what makes the nearest achievement on a
 * blank record "First class finished" rather than an arbitrary one of the ties.
 */
export function splitAchievements(list: readonly Achievement[]): AchievementSplit {
  const earned = list
    .filter((item) => item.earned)
    .sort((a, b) => (b.earnedOn ?? '').localeCompare(a.earnedOn ?? ''));
  const locked = list
    .filter((item) => !item.earned)
    .sort(
      (a, b) => fraction(b) - fraction(a) || (a.progress?.target ?? 0) - (b.progress?.target ?? 0),
    );
  return { earned, locked };
}

/** The one to name when there is nothing else to show. */
export const nearestLocked = (list: readonly Achievement[]): Achievement | null =>
  splitAchievements(list).locked[0] ?? null;

/**
 * Has anything at all happened yet? True the moment any achievement moves.
 * Derived from the catalogue itself, so "nothing yet" cannot come to mean one
 * thing on the screen and another in the function that fills it.
 */
export const hasAnyProgress = (list: readonly Achievement[]): boolean =>
  list.some((item) => item.earned || (item.progress?.value ?? 0) > 0);
