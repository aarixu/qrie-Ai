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

/** Past this, a piece of maths is not a board line: shown as text, never typeset. */
const MAX_TEX = 400;

/** One piece of LaTeX as HTML, or null when KaTeX cannot read it. */
export function texToHtml(tex: string): string | null {
  if (tex.length > MAX_TEX) return null;
  try {
    return katex.renderToString(tex.replace(/\\dfrac/g, '\\frac'), {
      throwOnError: true,
      trust: false,
      output: 'html',
      strict: 'ignore',
      // No \rule or size command may draw past a few ems, and no macro may
      // expand without end (seventh review: hardening).
      maxSize: 5,
      maxExpand: 100,
    });
  } catch {
    return null;
  }
}

/**
 * Whether a FORMULA element's text is maths KaTeX will set as its author
 * meant. Formulas are plain text by the planner's contract, and plain text
 * with words in it — "Mass of Reactants = Mass of Products", "Profit % =
 * (Profit / CP) × 100", "A --> B" — comes out of KaTeX as run-together italics
 * (seventh review, 2026-09-29). So: `$…$`-delimited, or no word (a run of
 * three or more letters with a vowel in it — sin, cos, tan and log excepted),
 * no chemical formula, no %, #, &, ~, and no arrow.
 */
export function typesetsAsMaths(text: string): boolean {
  const t = text.trim();
  if (/^\$[^$]+\$$/.test(t)) return true;
  if (/[%#&~]|->|<-|→/.test(t)) return false;
  // A power LaTeX would raise only the first character of, without braces:
  // "10^-9", "2^10". "x^2-5x" and "I^2Rt" raise one character, as meant.
  if (/\^(?:-|\d{2,}|[A-Za-z]{2,})/.test(t)) return false;
  // "H2O", "CO2": a chemical formula would be set as italic variables.
  if (/[A-Z][a-z]?\d+[A-Z]|[A-Z]{2,}\d/.test(t)) return false;
  // Letters side by side are a product ("mgh", "2ab"); a run with a vowel in
  // it is a word (eighth review: "PE = mgh" was refused).
  const words = (t.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => /[aeiou]/i.test(w));
  return words.every((w) => /^(sin|cos|tan|log|cot|sec|cosec)$/i.test(w));
}

/**
 * A formula element's text as LaTeX: its own `$…$` taken off, and a trailing
 * equation number the way a textbook sets it. Planners write the label with
 * dashes or dots — "x + y = 14 --- (1)" — which LaTeX would print as three
 * minus signs.
 */
export function formulaTex(text: string): string {
  const tex = text
    .trim()
    .replace(/^\$|\$$/g, '')
    .replace(/\s*(?:-{2,}|\.{2,}|…|—)\s*\(([0-9]+|[ivx]+)\)\s*$/i, String.raw` \qquad ($1)`);
  // Plain-text functions set upright, as functions, not as italic letters
  // (eighth review: "sin 30" was set as s·i·n·30). KaTeX has no \cosec.
  return tex
    .replace(/(?<![\\A-Za-z])cosec(?![A-Za-z])/g, String.raw`\operatorname{cosec}`)
    .replace(/(?<![\\A-Za-z{])(sin|cos|tan|cot|sec|log)(?![A-Za-z])/g, String.raw`\$1`);
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
