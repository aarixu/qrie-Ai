import type { Klass, StudentContext } from '@ai-tutor/persona';
import type { DiagnosticResult } from '@ai-tutor/knowledge-graph';
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

/** Mean belief across the nodes this lesson teaches, or absent if none were probed. */
export function masteryForLesson(
  diagnostic: DiagnosticResult | null,
  lessonRefs: readonly string[],
): number | undefined {
  if (diagnostic === null || lessonRefs.length === 0) return undefined;
  const beliefs = lessonRefs
    .map((nodeId) => diagnostic.mastery[nodeId])
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

  const mastery = masteryForLesson(input.profile.diagnostic, input.nodeIds ?? []);
  if (mastery !== undefined) ctx.mastery = mastery;

  return ctx;
}
