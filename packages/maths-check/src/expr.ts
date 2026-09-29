/**
 * THE EXPRESSION TREE, and the one path from a tree to arithmetic.
 *
 * The reader (parse.ts) builds these trees; everything that computes —
 * `evaluate`, the checker, even the reader working out a bracketed power —
 * goes through `toPoly` below, so there is exactly one place where a board
 * expression becomes a number.
 */

import * as P from './poly.ts';
import { DivisionByZero, TooLarge, type Rational } from './rational.ts';

export type Expr =
  | { k: 'num'; value: Rational }
  | { k: 'var'; name: string }
  | { k: 'neg'; a: Expr }
  | { k: 'add' | 'sub' | 'mul' | 'div'; a: Expr; b: Expr }
  | { k: 'pow'; a: Expr; n: number };

/** A value for each variable the board has given one. */
export type Values = Readonly<Record<string, Rational>>;

/**
 * The expression as a polynomial, with every variable in `values` replaced
 * by its number first. A variable with no value stays a variable.
 *
 * Throws `DivisionByZero` (rational.ts) for a zero divisor, and
 * `NotPolynomial` (poly.ts) for a divisor that still holds a variable.
 */
export function toPoly(e: Expr, values: Values = {}): P.Poly {
  switch (e.k) {
    case 'num':
      return P.constant(e.value);
    case 'var':
      return Object.prototype.hasOwnProperty.call(values, e.name)
        ? P.constant(values[e.name])
        : P.variable(e.name);
    case 'neg':
      return P.neg(toPoly(e.a, values));
    case 'add':
      return P.add(toPoly(e.a, values), toPoly(e.b, values));
    case 'sub':
      return P.sub(toPoly(e.a, values), toPoly(e.b, values));
    case 'mul':
      return P.mul(toPoly(e.a, values), toPoly(e.b, values));
    case 'div':
      return P.divide(toPoly(e.a, values), toPoly(e.b, values));
    case 'pow':
      return P.power(toPoly(e.a, values), e.n);
  }
}

/**
 * The number an expression works out to, or null — when a variable has no
 * value, a divisor is zero, or a divisor holds a variable.
 */
export function valueOf(e: Expr, values: Values = {}): Rational | null {
  try {
    return P.constantValue(toPoly(e, values));
  } catch (err) {
    if (err instanceof DivisionByZero || err instanceof P.NotPolynomial || err instanceof TooLarge) return null;
    throw err;
  }
}

/** Every variable the expression mentions. */
export function variablesIn(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.k) {
    case 'num':
      break;
    case 'var':
      out.add(e.name);
      break;
    case 'neg':
    case 'pow':
      variablesIn(e.a, out);
      break;
    default:
      variablesIn(e.a, out);
      variablesIn(e.b, out);
  }
  return out;
}
