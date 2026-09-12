import type { Lesson } from '@ai-tutor/lesson-format';
import { createLocalStore } from './localStore';

/**
 * WHAT THE CLASSROOM TELLS THE MAP.
 *
 * A lesson used to end with a tick against a lesson id, which says a video was
 * watched and nothing about what the student can now do. Beats declare the
 * outcomes they teach, so finishing a class is evidence about those outcomes
 * and a raised hand is evidence against the one being taught at that moment.
 *
 * Two separate signals, recorded separately because they are not the same
 * strength of claim:
 *
 *   TAUGHT   the student sat through the beat that teaches this. Real, weak
 *            evidence — attendance is not understanding, and this must never
 *            be allowed to look like a passed question.
 *   CONFUSED the student stopped the class ON this beat. Located precisely,
 *            and the signal the placement test can never generate.
 *
 * The diagnostic reads both. Nothing here decides how much they are worth —
 * that belongs in the knowledge graph, which is where every other belief rule
 * already lives.
 */

export interface OutcomeSignals {
  /** Outcome ids the student has been taught, with how many times. */
  taught: Record<string, number>;
  /** Outcome ids the student raised a hand on, with how many times. */
  confused: Record<string, number>;
  /**
   * Outcome ids the student ANSWERED on, mid-class. The third signal, and the
   * strongest of the three: taught is attendance, confused is a located
   * struggle, answered is the student retrieving it with the chalk in their
   * hand. Right and wrong kept apart — they are opposite evidence.
   */
  answeredRight: Record<string, number>;
  answeredWrong: Record<string, number>;
  /** ISO time of the last signal, so a later pass can pick up from here. */
  updatedAt: string | null;
}

const EMPTY: OutcomeSignals = {
  taught: {},
  confused: {},
  answeredRight: {},
  answeredWrong: {},
  updatedAt: null,
};

export const outcomeStore = createLocalStore<OutcomeSignals>('ai-tutor:outcomes', EMPTY);

const bump = (into: Record<string, number>, ids: readonly string[]): Record<string, number> => {
  const next = { ...into };
  for (const id of ids) next[id] = (next[id] ?? 0) + 1;
  return next;
};

/** Every outcome a lesson teaches, across all its beats. */
export const outcomesOf = (lesson: Lesson): string[] => [
  ...new Set(lesson.beats.flatMap((beat) => beat.teaches ?? [])),
];

/** The outcomes one beat teaches — what a hand raised there is about. */
export function outcomesAtBeat(lesson: Lesson, beatId: string): string[] {
  return [...(lesson.beats.find((beat) => beat.id === beatId)?.teaches ?? [])];
}

/**
 * Record that a lesson was finished. Called once, on completion — a lesson
 * abandoned halfway teaches its later beats to nobody.
 */
export function recordLessonTaught(lesson: Lesson): void {
  const ids = outcomesOf(lesson);
  if (ids.length === 0) return; // a lesson authored before the map existed
  outcomeStore.update((s) => ({
    ...s,
    taught: bump(s.taught, ids),
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * Record a raised hand, against the outcomes that beat teaches.
 *
 * A beat that teaches nothing — a hook, a recap — records nothing. Confusion
 * during a story is not confusion about an outcome, and pretending otherwise
 * would push belief down on whatever happened to be nearby.
 */
export function recordDoubtAtBeat(lesson: Lesson, beatId: string): void {
  const ids = outcomesAtBeat(lesson, beatId);
  if (ids.length === 0) return;
  outcomeStore.update((s) => ({
    ...s,
    confused: bump(s.confused, ids),
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * What an ANSWER at this beat is evidence about.
 *
 * `checks` first: a question about something already covered is evidence about
 * THAT, not about whatever this beat happens to be teaching around it. Exported
 * because the ledger has to file an answer against exactly the same outcomes
 * this store does — two copies of this rule would drift, and the drift would be
 * invisible until a belief and a ledger row disagreed about the same moment.
 */
export function answeredOutcomesAtBeat(lesson: Lesson, beatId: string): string[] {
  const beat = lesson.beats.find((b) => b.id === beatId);
  return [...(beat?.checks?.length ? beat.checks : (beat?.teaches ?? []))];
}

/** Record an in-class answer against the outcomes the beat checks or teaches. */
export function recordAnswerAtBeat(lesson: Lesson, beatId: string, correct: boolean): void {
  const ids = answeredOutcomesAtBeat(lesson, beatId);
  if (ids.length === 0) return;
  outcomeStore.update((s) => ({
    ...s,
    ...(correct
      ? { answeredRight: bump(s.answeredRight, ids) }
      : { answeredWrong: bump(s.answeredWrong, ids) }),
    updatedAt: new Date().toISOString(),
  }));
}
