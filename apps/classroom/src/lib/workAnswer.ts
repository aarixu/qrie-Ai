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
 * quadratic are past what the checker can follow.
 */
export function workStartOf(written: string | undefined): string | null {
  if (!written) return null;
  const equations = [...written.matchAll(/\$([^$]*)\$/g)].map((m) => m[1]).filter((tex) => tex.includes('='));
  if (equations.length !== 1) return null;
  const plain = latexToPlain(`$${equations[0]}$`);
  return plain !== null && workableEquation(plain) ? plain : null;
}

// Not followed by more of a number — a sentence's full stop is not a decimal.
const SOLVED_FORM = /(?<![A-Za-z0-9])([A-Za-z])\s*=\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)(?!\d|\.\d|\s*\/\s*\d)/g;
const NUMBER = /-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/g;

/**
 * Whether a solved step ("x = 4") is the answer `expect` describes.
 *
 * The last "letter = number" in `expect` is its answer ("Subtract 3 from both
 * sides: 2x = 8, so x = 4." — x = 4). With none, an `expect` holding some
 * other equation asks for something else ("2x + 5 = 11" when x is only the way
 * there), one number is the answer, and none at all leaves the working to
 * speak for itself.
 */
export function solvesAsExpected(expect: string | undefined, solved: { name: string; value: Rational }): boolean {
  const claim = `${solved.name} = ${formatRational(solved.value)}`;
  if (!expect) return true;
  const forms = [...expect.matchAll(SOLVED_FORM)];
  const last = forms[forms.length - 1];
  if (last) return sameEquation(claim, `${last[1]} = ${last[2]}`);
  if (expect.includes('=')) return false;
  const numbers = expect.match(NUMBER) ?? [];
  if (numbers.length === 1) return sameEquation(claim, `${solved.name} = ${numbers[0]}`);
  return numbers.length === 0;
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
