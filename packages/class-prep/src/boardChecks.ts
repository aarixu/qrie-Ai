import { toolStrings, type Element, type Lesson } from '@ai-tutor/lesson-format';
// By relative path, as gate.ts reaches maths-check.
import { cePart, checkReaction } from '../../maths-check/src/chem.ts';

/**
 * THREE CHECKS ON WHAT THE SMART BOARD WRITES (canvas C3, 2026-10-02).
 *
 *   echo   ink that writes out the very line she is saying — eight words or
 *          more, at least 80% of them taken from that line, covering at least
 *          60% of it — is a subtitle, and subtitles
 *          are what Aarav took off the board. Research says the same: printed
 *          words that repeat the narration hurt learning (redundancy, 16 of 16
 *          tests). A key point written in a few words as she says the sentence
 *          is a teacher's note and is not this.
 *   tex    maths the board cannot set. A `$…$` group whose commands are not
 *          ones the board knows comes out as raw LaTeX source in front of a
 *          child. Chemistry in `\ce{…}` is the board's too (KaTeX mhchem).
 *   chem   a reaction in `\ce{…}` whose atoms do not balance. A skeletal
 *          equation is real Class 10 content (NCERT 1.1.2), so a line that
 *          says it is "skeletal" or "unbalanced" is let through.
 *
 * Each problem is written to the planner, naming its beat, like every other
 * rule in gate.ts — which is where these are run.
 */

export interface BoardCheckProblem {
  rule: 'echo' | 'tex' | 'chem';
  where: string;
  message: string;
}

const plannerBeatOf = (id: string): string => id.replace(/__.*$/, '').replace(/_\d+.*$/, '');
const words = (text: string): string[] =>
  text
    .replace(/\$[^$]*\$/g, ' ')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

const writtenText = (el: Element): string | null => {
  if (el.kind === 'handwrite' || el.kind === 'text' || el.kind === 'note' || el.kind === 'formula') return el.text;
  // A tool's caption and labels are ink too: a caption that reads her line back is a subtitle.
  if (el.kind === 'tool') return toolStrings(el.tool, el.params).join(' ') || null;
  return null;
};

/** One written element, whatever lines it wrapped onto: `b3_11_l1` -> `b3_11`. */
const groupOf = (id: string): string => id.replace(/_l\d+$/, '');

/**
 * The LaTeX commands a Class 6-12 board needs, and so the ones it sets. A
 * command outside this list is either a slip ("\fracc") or maths past the
 * syllabus, and KaTeX would show a slip as its source in red.
 */
const TEX_COMMANDS = new Set([
  'frac', 'dfrac', 'tfrac', 'sqrt', 'text', 'mathrm', 'operatorname', 'mathbf', 'mathit', 'overline', 'vec', 'bar',
  'left', 'right', 'quad', 'qquad', 'times', 'div', 'cdot', 'pm', 'mp', 'neq', 'ne', 'leq', 'le', 'geq', 'ge',
  'approx', 'sim', 'propto', 'infty', 'pi', 'theta', 'alpha', 'beta', 'gamma', 'delta', 'Delta', 'lambda', 'mu',
  'omega', 'Omega', 'rho', 'sigma', 'phi', 'circ', 'degree', 'angle', 'triangle', 'parallel', 'perp', 'cong',
  'therefore', 'because', 'Rightarrow', 'rightarrow', 'Leftarrow', 'leftarrow', 'leftrightarrow', 'implies', 'to',
  'longrightarrow', 'Longrightarrow', 'rightleftharpoons', 'ldots', 'cdots', 'percent', 'sin', 'cos', 'tan', 'cot',
  'sec', 'csc', 'log', 'ln', 'ce',
]);

/** Why the board cannot set this piece of LaTeX, or null when it can. */
function texTrouble(tex: string): string | null {
  let depth = 0;
  for (const c of tex.replace(/\\[{}]/g, '')) {
    if (c === '{') depth += 1;
    if (c === '}') depth -= 1;
    if (depth < 0) return 'a brace closes that never opened';
  }
  if (depth !== 0) return 'a brace never closes';
  const unknown = [...tex.matchAll(/\\([A-Za-z]+)/g)].map((m) => m[1]).find((name) => !TEX_COMMANDS.has(name));
  return unknown ? `the board does not set \\${unknown}` : null;
}

export function boardChecks(lesson: Lesson): BoardCheckProblem[] {
  const problems: BoardCheckProblem[] = [];
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));

  // echo: per spoken moment, the ink it adds, wrapped lines joined back up.
  lesson.beats.forEach((beat, n) => {
    const said = words(beat.narration);
    if (said.length < 8) return;
    const before = new Set(n > 0 ? lesson.beats[n - 1].show : []);
    const groups = new Map<string, string[]>();
    for (const id of beat.show) {
      if (before.has(id)) continue;
      const el = byId.get(id);
      const text = el ? writtenText(el) : null;
      if (text === null) continue;
      groups.set(groupOf(id), [...(groups.get(groupOf(id)) ?? []), text]);
    }
    const saidSet = new Set(said);
    for (const [group, lines] of groups) {
      const ink = words(lines.join(' '));
      if (ink.length < 8) continue;
      const shared = ink.filter((w) => saidSet.has(w)).length;
      if (shared / said.length >= 0.6 && shared / ink.length >= 0.8) {
        problems.push({
          rule: 'echo',
          where: group,
          message:
            `Beat "${plannerBeatOf(group)}": "${lines.join(' ').slice(0, 60)}" writes out the very line she says — ` +
            `a subtitle, not a note. Write the key point in a few words instead.`,
        });
      }
    }
  });

  for (const el of lesson.elements) {
    const text = writtenText(el);
    if (!text) continue;
    for (const m of text.matchAll(/\$([^$]+)\$/g)) {
      const tex = m[1];
      const ce = cePart(tex);
      if (ce !== null) {
        const verdict = checkReaction(ce);
        if (verdict.kind === 'unbalanced' && !/skeletal|unbalanced/i.test(text)) {
          problems.push({
            rule: 'chem',
            where: el.id,
            message:
              `Beat "${plannerBeatOf(el.id)}": the reaction "${ce}" does not balance. Balance it, or say on the ` +
              `board that it is the skeletal (unbalanced) equation.`,
          });
        }
        continue;
      }
      const trouble = texTrouble(tex);
      if (trouble !== null) {
        problems.push({
          rule: 'tex',
          where: el.id,
          message:
            `Beat "${plannerBeatOf(el.id)}": the maths "$${tex.slice(0, 40)}$" cannot be set — ${trouble}. ` +
            `Use plain commands only: \\frac, \\sqrt, ^, _, \\times, \\div, \\pm, \\le, \\ge, \\ne, \\pi, \\theta, \\circ, \\ce{} for chemistry.`,
        });
      }
    }
  }
  return problems;
}
