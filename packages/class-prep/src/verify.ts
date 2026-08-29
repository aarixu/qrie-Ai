import { CANVAS_H, CANVAS_W } from '@ai-tutor/lesson-format';
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
export function verifySvg(svg: string, brief: VisualBrief): string[] {
  const problems: string[] = [];
  const src = svg.trim();

  if (!src.startsWith('<svg')) {
    problems.push('does not start with <svg');
    return problems; // nothing below is meaningful on a non-SVG
  }

  // --- safety: nothing executable, nothing that reaches the network ---
  if (/<script[\s>]/i.test(src)) problems.push('contains <script>');
  if (/<foreignObject[\s>]/i.test(src)) problems.push('contains <foreignObject>');
  if (/<(iframe|object|embed|use)[\s>]/i.test(src)) problems.push('contains an embedding tag');
  if (/\son[a-z]+\s*=/i.test(src)) problems.push('contains an inline event handler');
  if (/javascript:/i.test(src)) problems.push('contains a javascript: URL');
  // An external reference would leak the student's IP to whoever the model
  // decided to link, and would break the moment that host went away.
  if (/(href|src)\s*=\s*["'](?!#)/i.test(src)) problems.push('references an external resource');

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
