import type { Mastery } from '@ai-tutor/knowledge-graph';
import type { Klass, StudentContext } from '@ai-tutor/persona';
import type { StudentProfile } from '../stores/profile';
import type { DoubtEntry } from '../stores/doubtLog';
import { computeStreak, type Progress } from '../stores/progress';

/**
 * Everything the tutor is allowed to know about the student in front of her.
 *
 * The rule this file exists to enforce is the persona's: a signal we do not
 * actually measure is left ABSENT, never defaulted. An absent factor produces
 * no line in her prompt; a defaulted one produces a tutor adapting to a student
 * who does not exist. So every field below is either read from something the
 * app really records, or omitted.
 *
 * Deliberately not here: lastAnswer (the classroom asks no check questions yet,
 * so there is no answer to classify) and namedMisconception at the lesson level
 * (the bank names what a wrong CHOICE reveals, and a lesson is not a choice —
 * the quiz supplies it where it is real).
 */

const isKlass = (n: number | null): n is Klass => n !== null && n >= 6 && n <= 12;

/**
 * Mean belief across the nodes this lesson teaches, or absent if none were
 * probed. Takes the belief MAP — the learner model's projection — and never a
 * DiagnosticResult: the stored placement is one day's record, and the persona
 * used to read it as the student's present (2026-09-16 audit, task 3.4).
 */
export function masteryForLesson(
  mastery: Mastery | null,
  lessonRefs: readonly string[],
): number | undefined {
  if (mastery === null || lessonRefs.length === 0) return undefined;
  const beliefs = lessonRefs
    .map((nodeId) => mastery[nodeId])
    .filter((b): b is number => typeof b === 'number' && Number.isFinite(b));
  if (beliefs.length === 0) return undefined;
  return beliefs.reduce((sum, b) => sum + b, 0) / beliefs.length;
}

export function buildStudentContext(input: {
  profile: StudentProfile;
  klass: number | null;
  progress: Progress;
  doubts: readonly DoubtEntry[];
  lessonId: string;
  /** Graph node ids this lesson teaches, for the mastery reading. */
  nodeIds?: readonly string[];
  /**
   * What we believe per outcome, from the LEARNER MODEL. Injected like the
   * planner's, and for the same reason: this file must not know where belief
   * lives, only that it is never the stored placement blob.
   *
   * UNASSISTED belief (B6): the caller passes `masteryFromModel()`, which holds
   * only outcomes the student has answered cold. An outcome answered only with
   * help is absent, so it never lifts the persona's mastery reading.
   */
  mastery?: Mastery;
  /**
   * The outcomes the learner model's mastery rule holds for (`masteredAt`,
   * B8): the caller passes `masteredFromModel()`. Only when every node this
   * lesson teaches is in it may she say they already hold it; absent, nothing
   * is mastered (lam-one-brain Task 6, D24).
   */
  mastered?: ReadonlySet<string>;
  /** What she remembers about them, as private notes (lib/studentMemory.ts `memoryNotes`). */
  notes?: readonly string[];
  today?: Date;
}): StudentContext | null {
  const klass = input.klass ?? input.profile.klass;
  // No class means no student to describe. The caller falls back to a tutor
  // who adapts to nothing rather than one who adapts to a guess.
  if (!isKlass(klass)) return null;

  const ctx: StudentContext = { klass };

  // Hands raised in THIS lesson — the pace signal the persona reads.
  const raised = input.doubts.filter((d) => d.lessonId === input.lessonId).length;
  if (raised > 0) ctx.doubtCount = raised;

  const streak = computeStreak(input.progress, input.today);
  if (streak > 0) ctx.attendance = { kind: 'streak', days: streak };

  const mastery = masteryForLesson(input.mastery ?? null, input.nodeIds ?? []);
  if (mastery !== undefined) ctx.mastery = mastery;
  // Only beside a belief, and only when the rule holds for every node taught:
  // the persona reads it as the second half of "they hold it".
  const nodes = input.nodeIds ?? [];
  if (mastery !== undefined && nodes.length > 0 && nodes.every((id) => input.mastered?.has(id) === true)) {
    ctx.mastered = true;
  }

  if (input.notes && input.notes.length > 0) ctx.notes = [...input.notes];

  return ctx;
}

/**
 * The longest name onboarding keeps, in characters.
 *
 * A first name is a word or two. Anything past this is not a name, and a
 * field with no limit is a field somebody pastes a paragraph into — which the
 * app then prints on every greeting.
 */
export const MAX_NAME_CHARS = 40;

/** A typed name as it is stored: trimmed, then cut at MAX_NAME_CHARS. */
export function capName(name: string): string {
  return name.trim().slice(0, MAX_NAME_CHARS).trimEnd();
}

/**
 * The student, written down for the class PLANNER.
 *
 * Same discipline as `buildStudentContext`, same reason: every line comes from
 * something the app really recorded, and a signal nobody measured produces no
 * line at all. `statement` turns outcome ids into words a planner can teach
 * to — injected, because this file must not care where the map lives.
 *
 * THE NAME IS NOT HERE, ON PURPOSE. It used to be the first line — "The
 * student's name is …" — which sent a child's name to a model vendor with
 * every class prepared, and put a string the child typed, unscreened, inside
 * a prompt: a name set to "ignore your instructions" was an instruction. The
 * planner teaches to what the student got wrong and what they hold; their
 * name tells it nothing about either. The cost: the planner's `fill` lines,
 * which the player speaks in front of a beat, can no longer use their name.
 */
export function studentLinesForPlanner(input: {
  profile: StudentProfile;
  progress: Progress;
  outcomes: {
    confused: Record<string, number>;
    answeredWrong: Record<string, number>;
    answeredRight: Record<string, number>;
  };
  statement: (outcomeId: string) => string | undefined;
  /**
   * What we believe about each outcome, from the learner model. Used to be read
   * off `profile.diagnostic.mastery` in here — the last placement test's stored
   * result, which knew nothing about the term of classes and quizzes since.
   *
   * UNASSISTED belief, and only where the student was asked cold (B6): the
   * caller passes `masteryFromModel()`. So "They hold securely" below is said
   * only of what they did alone, and an outcome they managed only with a hint
   * is named nowhere — the planner is not told they hold it.
   */
  mastery: Mastery;
  /**
   * The outcomes the mastery rule holds for (`masteredAt`, B8): the caller
   * passes `masteredFromModel()`. "They hold securely" needs this as well as a
   * high belief, since one lucky cold answer can reach the number (lam-one-brain
   * Task 6, D24). Absent, nothing is said to be held.
   */
  mastered?: ReadonlySet<string>;
  /**
   * The class they last finished, if any — the one thing the app can honestly
   * say it remembers about the last time these two met.
   */
  lastClass?: { title: string; daysAgo: number } | null;
  today?: Date;
}): string[] {
  const lines: string[] = [];

  const streak = computeStreak(input.progress, input.today);
  if (streak >= 2) lines.push(`They have studied ${streak} days in a row.`);

  const worded = (ids: Record<string, number>, cap: number): string[] =>
    Object.keys(ids)
      .map((id) => input.statement(id))
      .filter((s): s is string => s !== undefined)
      .slice(0, cap);

  // Strongest signal first: what they got WRONG with the chalk in their hand.
  const wrong = worded(input.outcomes.answeredWrong, 3);
  if (wrong.length > 0) lines.push(`They answered wrong on: ${wrong.join('; ')}.`);

  const confused = worded(input.outcomes.confused, 3);
  if (confused.length > 0) lines.push(`They raised a hand on: ${confused.join('; ')}.`);

  const right = worded(input.outcomes.answeredRight, 3);
  if (right.length > 0) lines.push(`They answered correctly on: ${right.join('; ')}.`);

  /**
   * WHAT WE BELIEVE, from the learner model rather than from the last placement
   * test's stored result. Only the settled ends, in the persona's own bands.
   *
   * SORTED, which it was not. These two lines are the only personalisation any
   * class receives, and they used to name three ARBITRARY outcomes — whichever
   * three `Object.entries` happened to yield first. A tutor told about the
   * student's third-worst and eleventh-worst ground is being told less than she
   * appears to be.
   */
  const beliefs = Object.entries(input.mastery);
  if (beliefs.length > 0) {
    const strong = beliefs
      .filter(([id, b]) => b >= 0.75 && input.mastered?.has(id) === true)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => input.statement(id))
      .filter((s): s is string => s !== undefined)
      .slice(0, 3);
    if (strong.length > 0) lines.push(`They hold securely: ${strong.join('; ')}.`);
    const shaky = beliefs
      .filter(([, b]) => b <= 0.4)
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => input.statement(id))
      .filter((s): s is string => s !== undefined)
      .slice(0, 3);
    if (shaky.length > 0) lines.push(`The ground is shaky under: ${shaky.join('; ')}.`);
  }

  /**
   * WHAT WE DID LAST TIME.
   *
   * Step one of Aarav's class opening, and the difference between a tutor and
   * a playlist: a teacher who has met you before starts from the last thing
   * you did together, and the student can tell within one sentence which kind
   * they are talking to.
   *
   * Named as a TITLE rather than described, because that is all the app
   * honestly knows: it holds which class was finished, not what was said in
   * it. Claiming to remember a conversation nobody recorded would be the app
   * pretending, which is worse than starting fresh — and this product's whole
   * persona rests on not doing that (packages/persona: "Say the honest thing").
   */
  if (input.lastClass) {
    const when = input.lastClass.daysAgo;
    const ago =
      when === 0 ? 'earlier today' : when === 1 ? 'yesterday' : `${when} days ago`;
    lines.push(`Their last class with you was "${input.lastClass.title}", ${ago}.`);
  }

  return lines;
}

/**
 * The name a tutor calls a child by: the first word of what they typed. One
 * helper for the greeting and onboarding — a regex copied twice lost its
 * backslash once and split "Ishaan" on the letter s.
 */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
