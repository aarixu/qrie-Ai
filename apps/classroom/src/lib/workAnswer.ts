import { latexToPlain } from '@ai-tutor/lesson-format';
import { equationIn, formatRational, sameEquation, workableEquation, type Rational } from '@ai-tutor/maths-check';

/**
 * WHAT "WORK IT OUT" CAN CHECK, AND WHAT COUNTS AS THE ANSWER (T8.1, eighth
 * review 2026-09-29).
 *
 * The panel follows a student's working from the question's equation to an
 * answer, so it is offered only where that path exists: a board form holding
 * exactly one equation, read as it means (`latexToPlain`, never the width
 * ruler), that is one linear equation in one unknown and not already solved.
 * "Is $x = 5$ a solution of $2x + 3 = 11$?" holds two; "$2^{x} = 32$" and a
 * quadratic are past what the checker can follow; and "If $3x + 2 = 11$, find
 * the value of $2x + 1$" asks for something the working never reaches (third
 * review) — any other piece of maths with a letter in it, beyond the unknown
 * itself, takes the panel away. And the question must ask for the unknown, or
 * expect an equation as its answer (below).
 */
export function workStartOf(ask: { question?: string; written?: string; expect?: string } | null | undefined): string | null {
  const written = ask?.written;
  if (!written) return null;
  const pieces = [...written.matchAll(/\$([^$]*)\$/g)].map((m) => m[1]);
  const equations = pieces.filter((tex) => tex.includes('='));
  if (equations.length !== 1) return null;
  if (pieces.some((tex) => !tex.includes('=') && /[A-Za-z]/.test(tex) && !/^\s*[A-Za-z]\s*$/.test(tex))) return null;
  const plain = latexToPlain(`$${equations[0]}$`);
  if (plain === null || !workableEquation(plain)) return null;
  // And the working can reach the answer: the question asks for the unknown
  // ("solve", "find the value of y"), or its answer is itself an equation.
  // "What remains on the left side?", answered in words, is neither — the
  // panel ticked "x + 3 = 7" and could never finish (production, phone).
  const asks = `${ask?.question ?? ''} ${written}`;
  const forTheUnknown = /\bsolve\b|\bvalue of\b|\bfind\s+\$?\s*[a-z]\b/i.test(asks);
  return forTheUnknown || expectedEquation(ask?.expect, plain) !== null ? plain : null;
}

/** A number as a planner writes one: a sign, a decimal, a fraction. */
const NUM = String.raw`-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?`;
/** Not followed by more of a number — a sentence's full stop is not a decimal. */
const AFTER = String.raw`(?!\d|\.\d|\s*\/\s*\d)`;

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
};

/**
 * `expect` as plain maths (fourth review): LaTeX read, a mixed number made a
 * fraction ("2½", "2 1/2", "2\frac{1}{2}" → 5/2), every dash a minus, "- 2",
 * "(-2)" and "+3" made plain numbers, "2 x 4" read as a product, and number
 * words made numbers ("Four, since …").
 */
function plainExpect(expect: string): string {
  const mixed = (whole: string, top: string, bottom: string): string =>
    `${Number(whole) * Number(bottom) + Number(top)}/${bottom}`;
  let t = expect.replace(/(\d+)\s*\\[dt]?frac\s*\{(\d+)\}\s*\{(\d+)\}/g, (_, w, a, b) => mixed(w, a, b));
  t = latexToPlain(t) ?? t;
  return t
    .replace(/[−–—]/g, '-')
    .replace(/(\d+)\s*½/g, (_, w) => mixed(w, '1', '2'))
    .replace(/½/g, '1/2')
    .replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (_, w, a, b) => mixed(w, a, b))
    .replace(/\((\d+)\)\/\((\d+)\)/g, '$1/$2')
    .replace(/\(\s*(-)\s*(\d+(?:\.\d+)?)\s*\)/g, '$1$2')
    .replace(/(=|\bis)\s*([+-])\s*(\d)/gi, (_, lead, sign, d) => `${lead} ${sign === '-' ? '-' : ''}${d}`)
    .replace(/(\d)\s+x\s+(\d)/g, '$1 × $2')
    .replace(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi'), (w) => String(NUMBER_WORDS[w.toLowerCase()]));
}

/**
 * Whether a solved step ("x = 4") is the answer `expect` describes.
 *
 * A ✓ solved step already follows from the question's own equation; what is
 * left to settle is whether this unknown is what the question asked for
 * (fourth review: "7, because 2 × 3 + 1 = 7" and "Area = 10 × 5 = 50 cm²"
 * were taken for x = 3 and l = 10). In order:
 *   1. where `expect` gives this letter a value ("x = 4", "4 = x", "x is 4"),
 *      the step must be one of them;
 *   2. the answer is the clause before "since", "because", "(" or ";" — an
 *      equation in the letter there is itself the answer
 *      (`expectedEquation`), and a value is not;
 *   3. else the value is the number after the clause's last "=", else after
 *      its first "is", else its first number ("Five.", "15 years");
 *   4. with no number at all, the working speaks for itself.
 */
export function solvesAsExpected(expect: string | undefined, solved: { name: string; value: Rational }): boolean {
  if (!expect) return true;
  const n = solved.name;
  const claim = `${n} = ${formatRational(solved.value)}`;
  const same = (v: string): boolean => sameEquation(claim, `${n} = ${v.replace(/\s+/g, '')}`);
  const plain = plainExpect(expect);
  const values = [
    ...[...plain.matchAll(new RegExp(`(?<![A-Za-z0-9])${n}\\s*=\\s*(${NUM})${AFTER}`, 'g'))].map((m) => m[1]),
    ...[...plain.matchAll(new RegExp(`(?<![\\w.])(${NUM})\\s*=\\s*${n}(?![A-Za-z0-9])`, 'g'))].map((m) => m[1]),
    ...[...plain.matchAll(new RegExp(`(?<![A-Za-z0-9])${n}\\s+is\\s+(${NUM})${AFTER}`, 'gi'))].map((m) => m[1]),
  ];
  if (values.length > 0) return values.some(same);
  const clause = plain.split(/\bsince\b|\bbecause\b|\(|;/i)[0];
  if (clause.includes('=') && new RegExp(`(?<![A-Za-z])${n}(?![A-Za-z])`).test(clause)) return false;
  const eq = clause.lastIndexOf('=');
  const is = /\bis\b/i.exec(clause);
  const tail = eq >= 0 ? clause.slice(eq + 1) : is ? clause.slice(is.index + 2) : clause;
  const value = tail.match(new RegExp(`${NUM}${AFTER}`));
  return value === null || same(value[0]);
}

/**
 * The one equation `expect` names as the answer ("What remains is x + 3 = 7."),
 * or null: when it holds more than one ("2x = 8, so x = 4" — the first is a
 * step on the way), or when it is the question's own equation restated.
 */
export function expectedEquation(expect: string | undefined, start: string | null): string | null {
  if (!expect || (expect.match(/=/g) ?? []).length !== 1) return null;
  const eq = equationIn(expect);
  if (!eq || (start !== null && sameEquation(eq, start))) return null;
  return eq;
}

/**
 * The question's equation written again as it stands — not a step. Compared
 * as written (spaces and sides aside): `sameEquation` compares polynomials,
 * so "3x + 12 = 21" would count as "3(x + 4) = 21" restated.
 */
export function restates(start: string | null, step: string): boolean {
  if (start === null) return false;
  const sides = (t: string) => t.replace(/\s+/g, '').split('=');
  const a = sides(start);
  const b = sides(step);
  if (a.length !== 2 || b.length !== 2) return false;
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

/** "x = 6": a final value, right or wrong. */
export const isFinalValue = (text: string): boolean => /^\s*[A-Za-z]\s*=\s*-?\d+(\.\d+)?(\s*\/\s*\d+)?\s*$/.test(text);
