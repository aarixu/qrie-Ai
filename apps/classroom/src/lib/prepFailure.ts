import { track } from './telemetry';

/**
 * WHY A PREPARATION WAS REFUSED, WRITTEN DOWN (production,
 * 2026-09-29).
 *
 * class-prep's maths gate throws with the wrong lines and the reasons on the
 * error (`mathsProblems`), and the student sees only element ids. Nothing read
 * them, so a class refused on production — "does not add up (lines: b2_10,
 * b3_2, …)" — could not be told apart from a checker that misread a right
 * line. They go to the console on this device, and to telemetry with their
 * element ids and reasons — the planner's text, never a student's words —
 * which is as readable as PostHog is (its key answers 401 today; see the plan).
 */
export function reportPrepFailure(error: unknown): void {
  const problems = (error as { mathsProblems?: unknown } | null)?.mathsProblems;
  if (!Array.isArray(problems) || problems.length === 0) return;
  console.error('[prep] the working on the board did not add up:', problems);
  track('prep_refused', {
    rule: 'maths',
    lines: problems.length,
    // Ids and the gate's reasons: the planner's text, never a student's words.
    problems: problems.slice(0, 8).map((p: { where?: unknown; message?: unknown }) => ({
      where: String(p.where ?? ''),
      message: String(p.message ?? '').slice(0, 200),
    })),
  });
}
