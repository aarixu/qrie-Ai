import { track } from './telemetry';

/**
 * WHY A PREPARATION WAS REFUSED, WHERE SOMEBODY CAN READ IT (production,
 * 2026-09-29).
 *
 * class-prep's maths gate throws with the wrong lines and the reasons on the
 * error (`mathsProblems`), and the student sees only element ids. Nothing read
 * them, so a class refused on production — "does not add up (lines: b2_10,
 * b3_2, …)" — could not be told apart from a checker that misread a right
 * line. They go to the console on this device (the working, never a student's
 * words: it is the planner's), and telemetry gets the count alone.
 */
export function reportPrepFailure(error: unknown): void {
  const problems = (error as { mathsProblems?: unknown } | null)?.mathsProblems;
  if (!Array.isArray(problems) || problems.length === 0) return;
  console.error('[prep] the working on the board did not add up:', problems);
  track('prep_refused', { rule: 'maths', lines: problems.length });
}
