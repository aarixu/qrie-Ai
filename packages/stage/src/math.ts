import katex from 'katex';
import 'katex/dist/katex.min.css';
// Chemistry, `\ce{…}`: registers mhchem's macros on this KaTeX (canvas C3).
import 'katex/contrib/mhchem';
import { hasMath } from '@ai-tutor/lesson-format';

/**
 * MATHS ON THE BOARD, TYPESET (T6, 2026-09-29).
 *
 * Aarav, looking at a held question on production: "this should be written
 * as an equation — why is it in English? Use LaTeX." A board line carries its
 * maths in LaTeX between `$…$`, and this turns it into HTML the stage can
 * place inside a `foreignObject`: the words stay in her board face (Quicksand),
 * the maths is typeset by KaTeX.
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
 * Abbreviations a Class 6-10 board writes as words, never as a product of
 * letters. A three-letter one with no vowel ("GCD") is a word only because it
 * is here; the others ("LSA", "NCERT") are words anyway, and a three-letter
 * one here is never read as a bare point name (ninth review). "SI" is not
 * here: "SI = PRT/100" is a formula.
 */
const ABBREVIATIONS = new Set([
  'HCF', 'LCM', 'GCD', 'MRP', 'GST', 'TDS', 'CSA', 'TSA', 'LSA', 'LHS', 'RHS', 'BODMAS',
  'SSS', 'SAS', 'ASA', 'AAS', 'CPCT', 'BPT', 'NCERT',
  'DNA', 'ATP', 'RBC', 'WBC', 'LPG', 'CNG', 'PVC', 'CFC',
]);

/** One to three capitals right after an angle or triangle sign, a point name: "∠ABC", "ΔAOB", "△PQR". */
const POINT_NAME = /([∠Δ△]\s*)([A-Z]{1,3})(?![A-Za-z])/g;

/**
 * "ΔABC ~ ΔDEF": a ~ between two triangle names means "is similar to". LaTeX
 * reads a bare ~ as a space, so `formulaTex` writes it as `\sim`.
 */
const SIMILAR = /([Δ△]\s*[A-Z]{3})\s*~\s*(?=[Δ△]\s*[A-Z]{3}(?![A-Za-z]))/g;

/**
 * Whether a FORMULA element's text is maths KaTeX will set as its author
 * meant. Formulas are plain text by the planner's contract, and plain text
 * with words in it — "Mass of Reactants = Mass of Products", "Profit % =
 * (Profit / CP) × 100", "A --> B" — comes out of KaTeX as run-together italics
 * (seventh review, 2026-09-29). So: `$…$`-delimited, or no word (see below;
 * sin, cos, tan, cot, sec, cosec and log excepted), no chemical formula, no
 * power LaTeX would raise only the first character of, no %, #, &, no ~
 * except between two triangle names ("ΔABC ~ ΔDEF"), and no arrow.
 */
export function typesetsAsMaths(text: string): boolean {
  const t = text.trim();
  if (/^\$[^$]+\$$/.test(t)) return true;
  if (/[%#&~]|->|<-|→/.test(t.replace(SIMILAR, '$1 '))) return false;
  // A power LaTeX would raise only the first character of, without braces:
  // "10^-9", "2^10". "x^2-5x" and "I^2Rt" raise one character, as meant.
  if (/\^(?:-|\d{2,}|[A-Za-z]{2,})/.test(t)) return false;
  // "H2O", "CO2": a chemical formula would be set as italic variables.
  if (/[A-Z][a-z]?\d+[A-Z]|[A-Z]{2,}\d/.test(t)) return false;
  // Point names are maths, vowels and all (ninth review: "∠AOB = 90°"): one
  // to three capitals right after ∠, Δ or △, and a bare run of three capitals
  // that is not an abbreviation and whose every letter is a point already
  // named that way ("ar (ABC)" beside "ΔABC").
  const points = [...t.matchAll(POINT_NAME)].map((m) => m[2]).join('');
  const isPoints = (w: string) =>
    /^[A-Z]{3}$/.test(w) && !ABBREVIATIONS.has(w) && [...w].every((c) => points.includes(c));
  // Letters side by side are a product ("mgh", "PRT"); a word is a run of
  // three with a vowel in it, any run of four or more ("kmph"), or one of the
  // abbreviations above ("HCF", "GCD") — eighth, third, fourth and ninth
  // reviews ("SI = PRT/100" is a formula).
  const words = (t.replace(POINT_NAME, '$1').match(/[A-Za-z]{3,}/g) ?? []).filter(
    (w) => (/[aeiou]/i.test(w) || w.length >= 4 || ABBREVIATIONS.has(w)) && !isPoints(w),
  );
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
    .replace(/\s*(?:-{2,}|\.{2,}|…|—)\s*\(([0-9]+|[ivx]+)\)\s*$/i, String.raw` \qquad ($1)`)
    // "a^(m+n)": LaTeX raises only the bracket; the whole power goes up.
    .replace(/\^\(([^()]*)\)/g, '^{$1}')
    // "ΔABC ~ ΔDEF": similar, not a space.
    .replace(SIMILAR, String.raw`$1 \sim `);
  // Plain-text functions set upright, as functions, not as italic letters
  // (eighth review: "sin 30" was set as s·i·n·30). KaTeX has no \cosec.
  return tex
    .replace(/(?<![\\A-Za-z])cosec(?![A-Za-z])/g, String.raw`\operatorname{cosec}`)
    .replace(/(?<![\\A-Za-z{])(sin|cos|tan|cot|sec|log)(?![A-Za-z])/g, String.raw`\$1`);
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';

/**
 * A formula KaTeX does not set, as the board writes it in plain text: an
 * arrow drawn as an arrow, and — in a reaction (an arrow and a formula like
 * "O2") — the atom counts as subscripts: "6O2 -> 6CO2" reads "6O₂ → 6CO₂".
 * A count follows a letter or a bracket; a coefficient does not, so it stays
 * full size. The planner writes chemistry as plain text in an equation, and
 * this is that text, made readable; the letters and numbers are unchanged.
 */
export function plainFormula(text: string): string {
  const arrows = text.replace(/<=>/g, '⇌').replace(/-->|->/g, '→');
  if (arrows === text && !/[→⇌]/.test(text)) return text;
  if (!/[A-Z][a-z]?\d/.test(arrows)) return arrows;
  return arrows.replace(/(?<=[A-Za-z)\]])\d+/g, (digits) => [...digits].map((d) => SUBSCRIPT[Number(d)]).join(''));
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
