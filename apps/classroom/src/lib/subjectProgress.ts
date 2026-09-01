import type { CatalogEntry } from './content';
import type { Progress } from '../stores/progress';

/**
 * WHERE A STUDENT STANDS, SUBJECT BY SUBJECT.
 *
 * The app knew two numbers — lessons finished and days in a row — and neither
 * of them answers the question a student actually has, which is "am I behind
 * in Science or in Maths". Every catalogue entry has carried a subject all
 * along and the profile has carried the chosen subjects; nothing ever joined
 * the two.
 *
 * Pure on purpose: it takes the catalogue, what has been finished and when,
 * and returns rows. No store, no fetch, no clock of its own — so the whole
 * thing is testable, and the screen that shows it owns no arithmetic.
 */

export interface SubjectProgress {
  subject: string;
  /** Lessons finished in this subject. */
  done: number;
  /** Lessons that exist for this subject and this student's class. */
  available: number;
  /** 0..1, or null when the subject has nothing to study yet. */
  share: number | null;
  /** ISO date-time of the most recent finish, or null. */
  lastStudied: string | null;
  /**
   * True when this subject has a syllabus but no lessons behind it.
   *
   * Class 9 Maths is exactly this: 306 mapped nodes and not one lesson, so a
   * student who picks it takes a placement test and gets a plan where every
   * step is a dead end. A screen that cannot say "coming soon" here will
   * quietly show them a zero instead and let them think it is their fault.
   */
  empty: boolean;
}

export interface SubjectProgressInput {
  /** Every lesson this student's class can reach. */
  catalog: readonly CatalogEntry[];
  progress: Progress;
  /** What they chose in onboarding. Empty means "whatever their class offers". */
  chosen: readonly string[];
  /** Subjects with an authored syllabus for this class — including empty ones. */
  offered: readonly string[];
}

/**
 * One row per subject the student is studying, in a stable order.
 *
 * Sorted by name rather than by progress: a list that reorders itself as a
 * student works stops being a place they can find things.
 */
export function subjectProgress(input: SubjectProgressInput): SubjectProgress[] {
  const { catalog, progress, chosen, offered } = input;

  // Their own choice wins. With no choice on file, everything their class
  // offers is honest — a guessed subset would hide a subject they study.
  const subjects = chosen.length > 0 ? [...chosen] : [...offered];

  return subjects
    .map((subject): SubjectProgress => {
      const lessons = catalog.filter((entry) => entry.subject === subject);
      let done = 0;
      let lastStudied: string | null = null;

      for (const lesson of lessons) {
        const at = progress.lessons[lesson.id]?.completedAt;
        if (!at) continue;
        done += 1;
        if (lastStudied === null || at > lastStudied) lastStudied = at;
      }

      const available = lessons.length;
      return {
        subject,
        done,
        available,
        // Null rather than 0 when there is nothing to study: a progress bar
        // at zero says "you have done none of it", which is a different and
        // unfair statement from "there is none of it yet".
        share: available === 0 ? null : done / available,
        lastStudied,
        empty: available === 0,
      };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/**
 * The subject to nudge them towards, or null.
 *
 * The one they have touched least recently among those that have anything to
 * study — because the point of tracking several subjects is noticing the one
 * quietly being dropped, not celebrating the one going well.
 *
 * Never an empty subject: pointing a student at a dead end is worse than
 * saying nothing.
 */
export function subjectNeedingAttention(rows: readonly SubjectProgress[]): string | null {
  const real = rows.filter((row) => !row.empty);
  if (real.length === 0) return null;

  // Never studied beats long ago: a subject with no history at all is the
  // one most likely to be forgotten entirely.
  const untouched = real.filter((row) => row.lastStudied === null);
  if (untouched.length > 0) {
    return [...untouched].sort((a, b) => a.subject.localeCompare(b.subject))[0].subject;
  }

  return [...real].sort((a, b) => (a.lastStudied! < b.lastStudied! ? -1 : 1))[0].subject;
}
