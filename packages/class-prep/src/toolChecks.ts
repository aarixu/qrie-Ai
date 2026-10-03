import { SPOKEN_MS_PER_CHAR, toolDurationMs, toolProblems, type Element, type Lesson } from '@ai-tutor/lesson-format';
// By relative path, as gate.ts reaches maths-check.
import { checkStep, parseLine } from '../../maths-check/src/index.ts';

/**
 * FOUR RULES FOR THE TOOLKIT (canvas visual toolkit, part 1).
 *
 *   tool-valid       the tool exists and its params pass its spec — the same
 *                    check validateLesson and the relay run, phrased here for
 *                    the repair round with the planner's beat.
 *   tool-maths       every equationMove step is an equation maths-check reads,
 *                    and each follows from the one above it (maths-check's
 *                    `checkStep`: same solution, no arithmetic slip). A step
 *                    past what it can check is let through, not refused.
 *   tool-one-motion  one tool starts per spoken line: two moving at once split
 *                    the eye between them.
 *   tool-fits-line   the line lasts as long as its tool draws (at ~14
 *                    characters a second, plus half a second), so the drawing
 *                    is not still moving into the next sentence.
 *
 * Messages are written TO THE PLANNER, like every rule in gate.ts.
 */

export interface ToolCheckProblem {
  rule: 'tool-valid' | 'tool-maths' | 'tool-one-motion' | 'tool-fits-line';
  where: string;
  message: string;
}

type ToolElement = Extract<Element, { kind: 'tool' }>;

const plannerBeatOf = (id: string): string => id.replace(/__.*$/, '').replace(/_\d+.*$/, '');
const GRACE_MS = 500;
const seconds = (ms: number): string => (ms / 1000).toFixed(1);

function mathsProblems(el: ToolElement): ToolCheckProblem[] {
  if (el.tool !== 'equationMove' || !Array.isArray(el.params.steps)) return [];
  const steps = el.params.steps.filter((s): s is string => typeof s === 'string');
  const beat = plannerBeatOf(el.id);
  const problems: ToolCheckProblem[] = [];
  steps.forEach((step, i) => {
    if (!parseLine(step).ok) {
      problems.push({
        rule: 'tool-maths',
        where: el.id,
        message: `Beat "${beat}": equationMove step "${step}" cannot be read as an equation. Write it plainly, like "2x + 3 = 11".`,
      });
    } else if (i > 0 && parseLine(steps[i - 1]).ok && checkStep(steps[i - 1], step).ok === false) {
      problems.push({
        rule: 'tool-maths',
        where: el.id,
        message: `Beat "${beat}": equationMove step "${step}" does not follow from "${steps[i - 1]}" — every step must be the same equation, still true.`,
      });
    }
  });
  return problems;
}

export function toolChecks(lesson: Lesson): ToolCheckProblem[] {
  const problems: ToolCheckProblem[] = [];
  const isTool = (el: Element | undefined): el is ToolElement => el?.kind === 'tool';

  for (const el of lesson.elements.filter(isTool)) {
    for (const problem of toolProblems(el.tool, el.params)) {
      problems.push({ rule: 'tool-valid', where: el.id, message: `Beat "${plannerBeatOf(el.id)}": its ${el.tool}: ${problem}.` });
    }
    problems.push(...mathsProblems(el));
  }

  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  lesson.beats.forEach((beat, n) => {
    const before = new Set(n > 0 ? lesson.beats[n - 1].show : []);
    const fresh = beat.show.filter((id) => !before.has(id)).map((id) => byId.get(id)).filter(isTool);
    const line = beat.narration.slice(0, 60);
    if (fresh.length > 1) {
      problems.push({
        rule: 'tool-one-motion',
        where: beat.id,
        message: `Beat "${plannerBeatOf(beat.id)}": the line "${line}" starts ${fresh.length} tools at once (${fresh.map((t) => t.tool).join(', ')}). One at a time — give each its own line.`,
      });
    }
    const lineMs = beat.narration.length * SPOKEN_MS_PER_CHAR + GRACE_MS;
    for (const el of fresh) {
      const drawMs = toolDurationMs(el.tool, el.params);
      if (drawMs === null) continue;
      const needs = (el.after ?? 0) + drawMs;
      if (needs > lineMs) {
        problems.push({
          rule: 'tool-fits-line',
          where: beat.id,
          message: `Beat "${plannerBeatOf(beat.id)}": the line "${line}" lasts about ${seconds(lineMs - GRACE_MS)}s, and its ${el.tool} needs ${seconds(needs)}s. Say more while it draws, or give it fewer steps.`,
        });
      }
    }
  });
  return problems;
}
