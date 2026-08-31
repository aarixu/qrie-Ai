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

/**
 * The student, written down for the class PLANNER.
 *
 * Same discipline as `buildStudentContext`, same reason: every line comes from
 * something the app really recorded, and a signal nobody measured produces no
 * line at all. `statement` turns outcome ids into words a planner can teach
 * to — injected, because this file must not care where the map lives.
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
  today?: Date;
}): string[] {
  const lines: string[] = [];

  if (input.profile.name) lines.push(`The student's name is ${input.profile.name}.`);

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

  // Placement beliefs: only the settled ends, in the persona's own bands.
  const diagnostic = input.profile.diagnostic;
  if (diagnostic) {
    const strong = Object.entries(diagnostic.mastery)
      .filter(([, b]) => b >= 0.75)
      .map(([id]) => input.statement(id))
      .filter((s): s is string => s !== undefined)
      .slice(0, 3);
    if (strong.length > 0) lines.push(`They hold securely: ${strong.join('; ')}.`);
    const shaky = Object.entries(diagnostic.mastery)
      .filter(([, b]) => b <= 0.4)
      .map(([id]) => input.statement(id))
      .filter((s): s is string => s !== undefined)
      .slice(0, 3);
    if (shaky.length > 0) lines.push(`The ground is shaky under: ${shaky.join('; ')}.`);
  }

  return lines;
}
