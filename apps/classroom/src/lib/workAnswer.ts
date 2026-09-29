import { latexToPlain } from '@ai-tutor/lesson-format';
import { equals, evaluate, sameEquation, solveOne, workableEquation, type Rational } from '@ai-tutor/maths-check';

/**
 * WHAT "WORK IT OUT" CAN CHECK, AND WHAT COUNTS AS THE ANSWER (T8.1; eighth,
 * third, fourth and fifth reviews, 2026-09-29).
 *
 * ONE RULE FOR BOTH. Four review rounds each found phrasings that keyword and
 * first-number heuristics got wrong — a panel offered that could never
 * finish, a right answer refused, a check sum taken. So now:
 *   - the question's equation is solved (`solveOne`);
 *   - the values `expect` names as its answer are read (`answerValues`);
 *   - the panel is offered exactly when that solution is among them, or when
 *     the answer is itself an equation in the unknown (`expectedEquation`);
 *   - a solved step is taken exactly when its value is among them.
 * An offered panel can therefore always be finished, and a solved step is
 * taken exactly when it is what the question asked for.
 *
 * The board form must hold exactly one equation, read as it means
 * (`latexToPlain`), one linear equation in one unknown and not already solved,
 * and no other maths in a letter beyond the unknown itself ("If $3x + 2 = 11$,
 * find the value of $2x + 1$" asks for something else).
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
  const solution = solveOne(plain);
  if (!solution) return null;
  // No expected answer to read: only a question that plainly asks for the unknown.
  if (!ask?.expect) return /\bsolve\b|\bvalue of\s+\$?[a-z]\b|\bfind\s+\$?[a-z]\b/i.test(`${ask?.question ?? ''} ${written}`) ? plain : null;
  return solvesAsExpected(ask.expect, solution) || expectedEquation(ask.expect, plain) !== null ? plain : null;
}

const UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUMBER_WORD = [...UNITS, ...TENS.filter(Boolean), 'hundred', 'thousand', 'lakh'].join('|');
/** "twenty-five", "two hundred and five", "minus four": one run of number words. */
const NUMBER_PHRASE = new RegExp(
  String.raw`\b(?:(?:minus|negative)\s+)?(?:${NUMBER_WORD})(?:(?:[\s-]+(?:and\s+)?)(?:${NUMBER_WORD}))*\b`,
  'gi',
);

/** A run of number words as its value ("twenty-five" → 25, "two hundred" → 200). */
function wordsToNumber(phrase: string): number {
  let total = 0;
  let current = 0;
  const words = phrase.toLowerCase().split(/[\s-]+/).filter((w) => w !== 'and');
  const negative = words[0] === 'minus' || words[0] === 'negative';
  for (const w of negative ? words.slice(1) : words) {
    const unit = UNITS.indexOf(w);
    const tens = TENS.indexOf(w);
    if (unit >= 0) current += unit;
    else if (tens >= 2) current += tens * 10;
    else if (w === 'hundred') current = (current || 1) * 100;
    else if (w === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
    } else if (w === 'lakh') {
      total += (current || 1) * 100000;
      current = 0;
    }
  }
  const value = total + current;
  return negative ? -value : value;
}

/**
 * `expect` as plain maths: LaTeX read (a mixed number made a fraction first),
 * number words made numbers, currency and thousands separators dropped, every
 * dash a minus, "(-2)", "- 2" and "+3" made plain numbers, "2 x 4" read as a
 * product, and a parenthesised fraction "(-3)/(2)" made "-3/2".
 */
function plainExpect(expect: string): string {
  const mixed = (whole: string, top: string, bottom: string): string =>
    `${Number(whole) * Number(bottom) + Number(top)}/${bottom}`;
  let t = expect.replace(/(\d+)\s*\\[dt]?frac\s*\{(\d+)\}\s*\{(\d+)\}/g, (_, w, a, b) => mixed(w, a, b));
  t = latexToPlain(t) ?? t;
  return t
    .replace(NUMBER_PHRASE, (phrase) => ` ${wordsToNumber(phrase)} `)
    .replace(/₹|\bRs\.?|\bINR\b/gi, ' ')
    .replace(/(?<=\d),(?=\d{2,3}\b)/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/(\d+)\s*½/g, (_, w) => mixed(w, '1', '2'))
    .replace(/½/g, '1/2')
    .replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (_, w, a, b) => mixed(w, a, b))
    .replace(/\((-?\d+(?:\.\d+)?)\)\s*\/\s*\((-?\d+(?:\.\d+)?)\)/g, '$1/$2')
    .replace(/\(\s*(-)\s*(\d+(?:\.\d+)?)\s*\)/g, '$1$2')
    .replace(/(=|\bis)\s*([+-])\s*(\d)/gi, (_, lead, sign, d) => `${lead} ${sign === '-' ? '-' : ''}${d}`)
    .replace(/(^|[^\d])\.(\d)/g, '$10.$2')
    .replace(/(\d)\s+x\s+(\d)/g, '$1 × $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The value of the arithmetic at the start of `text` ("8 + 4", "12 cm" → 12), or null. */
function leadingValue(text: string): Rational | null {
  const arithmetic = text.match(/^\s*[-\d.(][\d.\s+\-×*/÷()]*/)?.[0];
  if (!arithmetic) return null;
  try {
    return evaluate(arithmetic.replace(/×/g, '*').replace(/÷/g, '/').trim());
  } catch {
    return null;
  }
}

const OPERATOR = /[+\-×*/÷^(]/;
const CLOSING = /[+\-×*/÷^)=]/;
/** Where a clause ends: a stop, a semicolon or colon, a comma, or the words that start a reason or a check. */
const CLAUSE_END = /[,;:]|\.(?!\d)|\b(?:so|since|because|as|which|and|check)\b/i;

/**
 * The values `expect` names as the answer for `letter` (fifth review).
 *
 * The letter's own values first — "x = 4", "x = 8 + 4 = 12" (the end of the
 * chain), "12 = x", "x is 4". Without them, every number that stands on its
 * own ("Five.", "The son is 12 years old", "₹1,200") and the result of every
 * sum ("… = 50 cm²"), but never a number inside a sum ("2 × 4 + 3", "(12 + 3)")
 * or a coefficient ("2x").
 */
export function answerValues(expect: string, letter: string): Rational[] {
  const plain = plainExpect(expect);
  const own: Rational[] = [];
  const is = new RegExp(String.raw`(?<![A-Za-z0-9])${letter}\s*(?:=|\bis\b)`, 'g');
  for (const m of plain.matchAll(is)) {
    const rest = plain.slice((m.index ?? 0) + m[0].length);
    const chain = rest.split(CLAUSE_END)[0];
    const sides = chain.split('=');
    const value = leadingValue(sides[sides.length - 1]);
    if (value) own.push(value);
  }
  const reversed = new RegExp(String.raw`(-?\d+(?:\.\d+)?(?:\/\d+)?)\s*=\s*${letter}(?![A-Za-z0-9])(?!\s*[+\-×*/÷^(])`, 'g');
  for (const m of plain.matchAll(reversed)) {
    const before = plain.slice(0, m.index).trimEnd();
    if (before && (OPERATOR.test(before[before.length - 1]) || before.endsWith('='))) continue;
    const value = leadingValue(m[1]);
    if (value) own.push(value);
  }
  if (own.length > 0) return own;

  const loose: Rational[] = [];
  for (const m of plain.matchAll(/-?\d+(?:\.\d+)?(?:\/\d+)?/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = plain.slice(0, start).trimEnd();
    const prev = before[before.length - 1] ?? '';
    // A digit or a point just before is part of a bigger number, read already.
    if (/[\d.]/.test(plain[start - 1] ?? '')) continue;
    // A minus after a number or a sum is subtraction: the number is inside it.
    if (m[0].startsWith('-') && /[\d)]/.test(prev)) continue;
    if (!m[0].startsWith('-') && OPERATOR.test(prev)) continue;
    // "2x": a coefficient. "(12": inside a sum.
    if (/[A-Za-z]/.test(plain[end] ?? '')) continue;
    const next = plain.slice(end).trimStart()[0] ?? '';
    if (CLOSING.test(next)) continue;
    const value = leadingValue(m[0]);
    if (value) loose.push(value);
  }
  return loose;
}

/**
 * Whether a solved step ("x = 4") is the answer `expect` describes: its value
 * is among the values `expect` names (`answerValues`). With no `expect` the
 * working speaks for itself.
 */
export function solvesAsExpected(expect: string | undefined, solved: { name: string; value: Rational }): boolean {
  if (!expect) return true;
  return answerValues(expect, solved.name).some((v) => equals(v, solved.value));
}

/** An equation made of numbers, single letters and operators, somewhere in a sentence. */
const EQUATION_IN_TEXT = /(?:\d+(?:\.\d+)?|(?<![A-Za-z])[A-Za-z](?![A-Za-z])|[+\-×*/÷^()]|\s)+=(?:\d+(?:\.\d+)?|(?<![A-Za-z])[A-Za-z](?![A-Za-z])|[+\-×*/÷^()]|\s)+/;

/**
 * The one equation `expect` names as the answer ("What remains is x + 3 = 7.",
 * "Open the bracket: 3x + 12 = 21."), or null: when `expect` holds more than
 * one ("2x = 8, so x = 4" — the first is a step on the way), when the equation
 * has no unknown in it (a check, "2 × 4 + 3 = 11"), when it cannot be read,
 * or when it is the question's own equation written again as it stands.
 */
export function expectedEquation(expect: string | undefined, start: string | null): string | null {
  if (!expect) return null;
  const plain = plainExpect(expect);
  if ((plain.match(/=/g) ?? []).length !== 1) return null;
  let eq = plain.match(EQUATION_IN_TEXT)?.[0].trim();
  if (!eq) return null;
  // A parenthesis the sentence opened around it is not part of it.
  while (eq.startsWith('(') && (eq.match(/\(/g) ?? []).length > (eq.match(/\)/g) ?? []).length) eq = eq.slice(1).trim();
  while (eq.endsWith(')') && (eq.match(/\)/g) ?? []).length > (eq.match(/\(/g) ?? []).length) eq = eq.slice(0, -1).trim();
  if (!/[A-Za-z]/.test(eq) || !sameEquation(eq, eq)) return null;
  if (start !== null && restates(start, eq)) return null;
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
