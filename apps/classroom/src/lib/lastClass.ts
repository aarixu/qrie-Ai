import { progressStore } from '../stores/progress';
import { fetchCatalog } from './content';

/**
 * THE CLASS THEY LAST FINISHED.
 *
 * Step one of the class opening, and the difference a student notices first: a
 * teacher who has met you before starts from the last thing you did together.
 *
 * WHAT IT DELIBERATELY IS NOT. It is not the conversation. The app holds which
 * class was finished and when — not a word of what was actually said in it,
 * because none of that is kept (apps/agent/src/worker.ts: "their voices and
 * their doubts do not leave the room they were spoken in"). So the planner is
 * given a title and a date and nothing else, and the tutor can say "last time
 * we did the nucleus" truthfully rather than inventing a memory of a chat.
 */

/** A day, so "yesterday" and "3 days ago" are both sayable. */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LastClass {
  title: string;
  daysAgo: number;
}

/**
 * Null when there is nothing to say — a first class, or a student whose only
 * lessons are unfinished. Silence is right there: "last time we did nothing"
 * is not an opening, and the persona's rule is that an absent signal produces
 * no line at all rather than a default.
 *
 * `exceptLessonId` skips the class about to be taught, so a student replaying
 * something is not greeted with "last time we did the very thing we are about
 * to do".
 */
export async function lastClassBefore(
  exceptLessonId?: string,
  now: Date = new Date(),
): Promise<LastClass | null> {
  const progress = progressStore.get();

  const finished = Object.entries(progress.lessons)
    .filter(([id, l]) => Boolean(l.completedAt) && id !== exceptLessonId)
    .map(([id, l]) => ({ id, at: new Date(l.completedAt!) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const latest = finished[0];
  if (!latest) return null;

  // The title comes from the catalogue, which may not be reachable. A class
  // remembered by its slug would read worse than not remembering it.
  let title: string | null = null;
  try {
    title = (await fetchCatalog()).find((e) => e.id === latest.id)?.title ?? null;
  } catch {
    title = null;
  }
  if (!title) return null;

  /**
   * Whole calendar days, not elapsed hours: a class finished at 11:40pm is
   * "yesterday" at 7am, and a student would find any other answer wrong.
   *
   * On a COPY, because setHours mutates. Calling it on the caller's own Date
   * rewinds their clock to midnight — which is exactly what happened here:
   * the first test to pass a shared `now` silently corrupted every later one
   * in the same file, and none of them failed to say so.
   */
  const midnight = (d: Date): number => new Date(d).setHours(0, 0, 0, 0);
  const daysAgo = Math.max(0, Math.floor((midnight(now) - midnight(latest.at)) / DAY_MS));
  return { title, daysAgo };
}
