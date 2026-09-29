import katex from 'katex';
import 'katex/dist/katex.min.css';
import { hasMath } from '@ai-tutor/lesson-format';

/**
 * MATHS ON THE BOARD, TYPESET (T6, 2026-09-29).
 *
 * Aarav, looking at a held question on production: "this should be written
 * as an equation — why is it in English? Use LaTeX." A board line carries its
 * maths in LaTeX between `$…$`, and this turns it into HTML the stage can
 * place inside a `foreignObject`: the words stay in her handwriting, the maths
 * is typeset by KaTeX.
 *
 * SAFE BY CONSTRUCTION. Board text is written by a model, so every character
 * outside the maths is HTML-escaped, and KaTeX runs with `trust: false` (its
 * default, set here so nobody turns it on by accident): no `\href`, no
 * `\htmlClass`, no raw HTML reaches the page. Maths KaTeX cannot parse is
 * shown as its source in plain text rather than in KaTeX's red error box —
 * a child should see "x^2 + 3x", never a parser's complaint.
 */

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** One piece of LaTeX as HTML, or null when KaTeX cannot read it. */
export function texToHtml(tex: string): string | null {
  try {
    return katex.renderToString(tex, { throwOnError: true, trust: false, output: 'html', strict: 'ignore' });
  } catch {
    return null;
  }
}

/**
 * A formula element's text as LaTeX: its own `$…$` taken off, and a trailing
 * equation number the way a textbook sets it. Planners write the label with
 * dashes or dots — "x + y = 14 --- (1)" — which LaTeX would print as three
 * minus signs.
 */
export function formulaTex(text: string): string {
  return text
    .trim()
    .replace(/^\$|\$$/g, '')
    .replace(/\s*(?:-{2,}|\.{2,}|…|—)\s*\(([0-9]+|[ivx]+)\)\s*$/i, String.raw` \qquad ($1)`);
}

/** A board line with `$…$` maths in it, as HTML: words escaped, maths typeset. */
export function lineToHtml(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/\$([^$]+)\$/g)) {
    out += escapeHtml(text.slice(last, m.index));
    out += texToHtml(m[1]) ?? escapeHtml(m[1]);
    last = (m.index ?? 0) + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

export { hasMath };
