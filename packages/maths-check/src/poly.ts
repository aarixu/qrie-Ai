/**
 * POLYNOMIALS WITH EXACT COEFFICIENTS — how two sides of an `=` are compared.
 *
 * Reading both sides into a polynomial, rather than into a number, is what
 * lets one comparison answer three different questions:
 *
 *   - `2 - 21 = -19`: both sides are constants; they are equal or not.
 *   - `7(3 - 2y) - 15y = 21 - 14y - 15y`: the difference of the two sides
 *     expands to 0 — an IDENTITY, true for every y, so it needs no answer.
 *   - `21 - 29y = 2`: the difference is `19 - 29y`, which is 0 for one y
 *     only. That is an equation, and it can only be checked against the
 *     value of y the board claims.
 *
 * A polynomial is a map from a monomial (its variables and their powers) to
 * a `Rational` coefficient. Division is allowed only by a constant: `x/2` is
 * a polynomial, `1/x` is not, and building one throws `NotPolynomial` — the
 * checker then falls back to substituting numbers first, when it has them.
 */

import {
  add as radd,
  div as rdiv,
  isZero as rIsZero,
  mul as rmul,
  neg as rneg,
  pow as rpow,
  type Rational,
  ZERO,
  ONE,
} from './rational.ts';

/** Thrown when an expression is not a polynomial (a variable in a divisor), or is too big to expand. */
export class NotPolynomial extends Error {
  constructor(why: string) {
    super(why);
    this.name = 'NotPolynomial';
  }
}

/** Variable name -> power (>= 1). The constant monomial has no entries. */
type Powers = Readonly<Record<string, number>>;

interface Term {
  powers: Powers;
  coef: Rational;
}

/** A polynomial. Zero coefficients are never stored, so the zero polynomial is the empty map. */
export type Poly = ReadonlyMap<string, Term>;

/**
 * Past this many terms an expansion is refused rather than run. A Class 6-10
 * line expands to a handful of terms; a runaway `(a+b+c+d)^64` should not
 * hang prep. The number is a guard, not a measurement.
 */
const MAX_TERMS = 2000;

const keyOf = (p: Powers): string =>
  Object.keys(p)
    .sort()
    .map((v) => `${v}^${p[v]}`)
    .join('*');

function put(out: Map<string, Term>, powers: Powers, coef: Rational): void {
  const key = keyOf(powers);
  const had = out.get(key);
  const next = had ? radd(had.coef, coef) : coef;
  if (rIsZero(next)) out.delete(key);
  else out.set(key, { powers, coef: next });
  if (out.size > MAX_TERMS) throw new NotPolynomial('the expansion is too large to check');
}

export function constant(c: Rational): Poly {
  const out = new Map<string, Term>();
  if (!rIsZero(c)) out.set('', { powers: {}, coef: c });
  return out;
}

export function variable(name: string): Poly {
  const powers = { [name]: 1 };
  return new Map([[keyOf(powers), { powers, coef: ONE }]]);
}

export function add(a: Poly, b: Poly): Poly {
  const out = new Map(a) as Map<string, Term>;
  for (const t of b.values()) put(out, t.powers, t.coef);
  return out;
}

export function neg(a: Poly): Poly {
  const out = new Map<string, Term>();
  for (const [k, t] of a) out.set(k, { powers: t.powers, coef: rneg(t.coef) });
  return out;
}

export const sub = (a: Poly, b: Poly): Poly => add(a, neg(b));

export function mul(a: Poly, b: Poly): Poly {
  const out = new Map<string, Term>();
  for (const s of a.values()) {
    for (const t of b.values()) {
      const powers: Record<string, number> = { ...s.powers };
      for (const [v, k] of Object.entries(t.powers)) powers[v] = (powers[v] ?? 0) + k;
      put(out, powers, rmul(s.coef, t.coef));
    }
  }
  return out;
}

/** The value of a polynomial with no variables, or null when it has any. */
export function constantValue(p: Poly): Rational | null {
  if (p.size === 0) return ZERO;
  if (p.size === 1 && p.has('')) return p.get('')!.coef;
  return null;
}

/** Division by a constant only. Throws `DivisionByZero` for 0 and `NotPolynomial` for a variable divisor. */
export function divide(a: Poly, b: Poly): Poly {
  const c = constantValue(b);
  if (c === null) throw new NotPolynomial('a variable in a divisor');
  const inv = rdiv(ONE, c);
  const out = new Map<string, Term>();
  for (const [k, t] of a) out.set(k, { powers: t.powers, coef: rmul(t.coef, inv) });
  return out;
}

/** `a` to a whole power. A negative power is allowed only of a nonzero constant. */
export function power(a: Poly, k: number): Poly {
  if (k < 0) {
    const c = constantValue(a);
    if (c === null) throw new NotPolynomial('a negative power of a variable');
    return constant(rpow(c, k));
  }
  // A number to a power goes through the size-guarded rational power
  // (TooLarge past a few thousand bits) — "(((9^64)^64)^64)^64" used to
  // multiply out here for minutes.
  const c = constantValue(a);
  if (c !== null) return constant(rpow(c, k));
  // A variable's power: past degree 64 no board line needs it.
  let degree = 0;
  for (const t of a.values()) degree = Math.max(degree, Object.values(t.powers).reduce((n, p) => n + p, 0));
  if (degree * k > 64) throw new NotPolynomial('a power past what this checker expands');
  let out = constant(ONE);
  for (let i = 0; i < k; i++) out = mul(out, a);
  return out;
}

export const isZero = (p: Poly): boolean => p.size === 0;

export function variablesOf(p: Poly): Set<string> {
  const out = new Set<string>();
  for (const t of p.values()) for (const v of Object.keys(t.powers)) out.add(v);
  return out;
}

/** The highest power of `v` in any term: 2 for `x² - 5x + 6` in x, 0 when `v` is absent. */
export function degreeIn(p: Poly, v: string): number {
  let out = 0;
  for (const t of p.values()) out = Math.max(out, t.powers[v] ?? 0);
  return out;
}

/** One linear equation, read as `sum(coefs[v] * v) + constant = 0`. */
export interface LinearRow {
  coefs: ReadonlyMap<string, Rational>;
  constant: Rational;
}

/** The polynomial as a linear row, or null when any term has degree above 1. */
export function linearRow(p: Poly): LinearRow | null {
  const coefs = new Map<string, Rational>();
  let c = ZERO;
  for (const t of p.values()) {
    const vars = Object.entries(t.powers);
    if (vars.length === 0) c = t.coef;
    else if (vars.length === 1 && vars[0][1] === 1) coefs.set(vars[0][0], t.coef);
    else return null;
  }
  return { coefs, constant: c };
}

/**
 * Solve linear rows exactly (Gauss-Jordan elimination over the rationals).
 *
 * `unique` only when the rows pin every variable that appears in them to one
 * value; `none` when they contradict each other; `many` when some variable is
 * left free.
 */
export function solveLinear(
  rows: readonly LinearRow[],
): { kind: 'unique'; values: Record<string, Rational> } | { kind: 'none' } | { kind: 'many' } {
  const vars = [...new Set(rows.flatMap((r) => [...r.coefs.keys()]))].sort();
  // Augmented matrix: [coefficients... | -constant].
  const m: Rational[][] = rows.map((r) => [...vars.map((v) => r.coefs.get(v) ?? ZERO), rneg(r.constant)]);
  let rank = 0;
  for (let col = 0; col < vars.length && rank < m.length; col++) {
    const pivot = m.findIndex((row, i) => i >= rank && !rIsZero(row[col]));
    if (pivot < 0) continue;
    [m[rank], m[pivot]] = [m[pivot], m[rank]];
    const p = m[rank][col];
    m[rank] = m[rank].map((x) => rdiv(x, p));
    for (let i = 0; i < m.length; i++) {
      if (i === rank || rIsZero(m[i][col])) continue;
      const f = m[i][col];
      m[i] = m[i].map((x, j) => radd(x, rneg(rmul(f, m[rank][j]))));
    }
    rank++;
  }
  // A row reading 0 = nonzero is a contradiction.
  for (const row of m) {
    if (row.slice(0, vars.length).every(rIsZero) && !rIsZero(row[vars.length])) return { kind: 'none' };
  }
  if (rank < vars.length) return { kind: 'many' };
  // Full rank: every column found a pivot, in order, so row i now reads
  // "vars[i] = value" with a 1 in column i and 0 in the other columns.
  const values: Record<string, Rational> = {};
  for (let i = 0; i < vars.length; i++) values[vars[i]] = m[i][vars.length];
  return { kind: 'unique', values };
}
