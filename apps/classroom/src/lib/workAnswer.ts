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
 * itself, takes the panel away.
 */
export function workStartOf(written: string | undefined): string | null {
  if (!written) return null;
  const pieces = [...written.matchAll(/\$([^$]*)\$/g)].map((m) => m[1]);
  const equations = pieces.filter((tex) => tex.includes('='));
  if (equations.length !== 1) return null;
  if (pieces.some((tex) => !tex.includes('=') && /[A-Za-z]/.test(tex) && !/^\s*[A-Za-z]\s*$/.test(tex))) return null;
  const plain = latexToPlain(`$${equations[0]}$`);
  return plain !== null && workableEquation(plain) ? plain : null;
}

// Not followed by more of a number — a sentence's full stop is not a decimal.
const SOLVED_FORM = /(?<![A-Za-z0-9])([A-Za-z])\s*=\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)(?!\d|\.\d|\s*\/\s*\d)/g;
const NUMBER = /-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/g;

/**
 * Whether a solved step ("x = 4") is the answer `expect` describes.
 *
 * A ✓ solved step already follows from the question's own equation, so it is
 * taken unless `expect` says otherwise (third review: "x is 4, since 2x = 8",
 * "Four, since 2 × 4 + 3 = 11" and "$x = \frac{8}{2}$" all refused x = 4):
 *   - where `expect` gives this letter a value ("x = 4", "4 = x", "x is 4"),
 *     the step must be one of them;
 *   - else, where it holds an equation in the letter, that equation is the
 *     answer (`expectedEquation`) and a value is not;
 *   - else, where it holds exactly one number and nothing else to go on, it
 *     must be that number ("7" when the question asked for 2x + 1);
 *   - else the working speaks for itself.
 */
export function solvesAsExpected(expect: string | undefined, solved: { name: string; value: Rational }): boolean {
  if (!expect) return true;
  const claim = `${solved.name} = ${formatRational(solved.value)}`;
  const plain = (latexToPlain(expect) ?? expect).replace(/−/g, '-').replace(/\((\d+)\)\/\((\d+)\)/g, '$1/$2');
  const n = solved.name;
  const values = [
    ...[...plain.matchAll(SOLVED_FORM)].filter((m) => m[1] === n).map((m) => m[2]),
    ...[...plain.matchAll(new RegExp(`(?<![\\w.])(-?\\d+(?:\\.\\d+)?(?:\\s*/\\s*\\d+)?)\\s*=\\s*${n}(?![A-Za-z0-9])`, 'g'))].map((m) => m[1]),
    ...[...plain.matchAll(new RegExp(`(?<![A-Za-z0-9])${n}\\s+is\\s+(-?\\d+(?:\\.\\d+)?(?:\\s*/\\s*\\d+)?)`, 'gi'))].map((m) => m[1]),
  ];
  if (values.length > 0) return values.some((v) => sameEquation(claim, `${n} = ${v}`));
  // An equation in the letter is itself the answer ("What remains is
  // x + 3 = 7."), which `expectedEquation` matches; a value is not it. An
  // all-number equation is a check ("2 × 4 + 3 = 11") and says nothing.
  const equationsInLetter = plain
    .split(/[;,:]|\.(?!\d)|\bso\b|\bsince\b|\bbecause\b/)
    .filter((part) => part.includes('=') && new RegExp(`(?<![A-Za-z])${n}(?![A-Za-z])`).test(part));
  if (equationsInLetter.length > 0) return false;
  const numbers = plain.match(NUMBER) ?? [];
  if (numbers.length === 1 && !plain.includes('=')) return sameEquation(claim, `${n} = ${numbers[0]}`);
  return true;
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
