import { isWords, openParams, type ToolSpec } from './types.ts';

export interface EquationMoveParams {
  steps: string[];
}

/** One step every 1.4 s, as `derive` writes them; a moving term takes half of that. */
export const EQUATION_STEP_MS = 1400;
export const EQUATION_MOVE_MS = 700;
/** Height of one line of working, in canvas units. */
export const EQUATION_LINE_H = 56;
const STEP_MAX = 60;

export const equationMove: ToolSpec<EquationMoveParams> = {
  tool: 'equationMove',
  summary:
    'Working, step under step, where the terms that move slide to their new place: a term crossing "=" flips its sign, a number dividing moves under.',
  whenToUse:
    'Solving or rearranging ONE equation in 2 to 6 steps, every step true, written plainly like "derive". Longer working stays "derive".',
  recipes: ['equation-solving'],
  example: { steps: ['2x + 3 = 11', '2x = 11 - 3', '2x = 8', 'x = 8/2', 'x = 4'] },
  validate(raw) {
    const { params, problems } = openParams('equationMove', raw, ['steps']);
    if (!params) return { ok: false, problems };
    const steps = params.steps;
    if (!Array.isArray(steps) || steps.length < 2 || steps.length > 6) problems.push('steps needs 2 to 6 lines');
    else
      steps.forEach((s, i) => {
        if (!isWords(s)) problems.push(`steps[${i}] needs words`);
        else if (s.length > STEP_MAX) problems.push(`steps[${i}] is over ${STEP_MAX} characters`);
        else if ((s.match(/=/g) ?? []).length !== 1) problems.push(`steps[${i}] "${s}" needs exactly one "="`);
      });
    return problems.length > 0 ? { ok: false, problems } : { ok: true, params: params as unknown as EquationMoveParams };
  },
  aspect: (p) => 640 / (p.steps.length * EQUATION_LINE_H + 24),
  minSize: { w: 360, h: 2 * EQUATION_LINE_H + 24 },
  durationMs: (p) => p.steps.length * EQUATION_STEP_MS,
  strings: (p) => p.steps,
};
