import { CANVAS_H, CANVAS_W } from '@ai-tutor/lesson-format';
import { unsafeMarkup } from './safety';
import type { VisualBrief } from './types';

/**
 * Is this SVG safe and correct enough to put on a child's board?
 *
 * Two jobs, and the first one is not negotiable. This markup is INLINED into
 * the page so its groups can be lit one at a time, which means a model that
 * emitted a `<script>` would have emitted it into our origin. Everything the
 * browser can execute is rejected here rather than sanitised, because a picture
 * we do not fully understand is a picture we should not show.
 *
 * The second job is that the artwork keeps the promises the brief made: the
 * named parts exist, so nothing points at a part that was never drawn, and no
 * baked-in text, so labels stay ours to translate and to place.
 *
 * Deterministic and instant. No model judges this — a vision model asked
 * whether a picture is "correct" is slower, costs money, and was measured
 * disagreeing with itself, so it cannot be the gate.
 */
/** The four motions a drawing may ask for. The renderer owns what they mean. */
export const MOTIONS: ReadonlySet<string> = new Set([
  'curie-drift',
  'curie-flow',
  'curie-pulse',
  'curie-sway',
]);

export function verifySvg(svg: string, brief: VisualBrief): string[] {
  const problems: string[] = [];
  const src = svg.trim();

  if (!src.startsWith('<svg')) {
    problems.push('does not start with <svg');
    return problems; // nothing below is meaningful on a non-SVG
  }

  // --- safety: nothing executable, nothing that reaches the network ---
  problems.push(...unsafeMarkup(src));

  // --- correctness: the brief's promises ---
  const viewBox = /viewBox\s*=\s*"([^"]+)"/i.exec(src);
  if (!viewBox) {
    problems.push('has no viewBox');
  } else {
    const n = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (n.length !== 4 || n[2] !== CANVAS_W || n[3] !== CANVAS_H) {
      problems.push(`viewBox must be "0 0 ${CANVAS_W} ${CANVAS_H}", got "${viewBox[1]}"`);
    }
  }

  if (/<text[\s>]/i.test(src)) problems.push('contains <text> — the board draws its own labels');

  /**
   * Motion, from a closed set of four.
   *
   * A drawing may mark a shape with one of these and the renderer owns what it
   * means: `curie-drift` wanders, `curie-flow` runs along its own path,
   * `curie-pulse` beats, `curie-sway` rocks. That is the whole painter — the
   * model gets a vocabulary, never a stylesheet.
   *
   * Any OTHER class is rejected rather than ignored, the gate's posture
   * everywhere: a class this board does not know is a promise the drawing
   * appears to make and the renderer will not keep.
   */
  for (const m of src.matchAll(/class\s*=\s*"([^"]*)"/gi)) {
    const names = m[1].trim().split(/\s+/).filter(Boolean);
    const unknown = names.filter((name) => !MOTIONS.has(name));
    if (names.length > 1 || unknown.length > 0) {
      problems.push(
        `unknown class "${m[1]}" — a shape may carry exactly one of: ${[...MOTIONS].join(', ')}`,
      );
    }
  }

  const groups = new Set([...src.matchAll(/<g[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));
  const missing = brief.parts.filter((p) => !groups.has(p));
  if (missing.length > 0) problems.push(`missing named group(s): ${missing.join(', ')}`);

  // A picture with no shapes passes every check above and shows the student
  // nothing, so the emptiness has to be its own failure.
  if (!/<(path|circle|ellipse|rect|line|polyline|polygon)[\s>]/i.test(src)) {
    problems.push('contains no drawn shapes');
  }

  return problems;
}
