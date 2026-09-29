/**
 * EXACT FRACTIONS — never a float.
 *
 * A board line like `x = 3 - 2(19/29) = (87 - 38)/29 = 49 / 29` is right or
 * wrong exactly. A float gets `0.1 + 0.2` wrong in the seventeenth place,
 * and a checker that compares with a tolerance can be talked into passing a
 * step that is off by a small amount. So every number here is a bigint
 * numerator over a bigint denominator, kept in lowest terms with a positive
 * denominator — which makes equality a plain comparison of the two parts.
 *
 * Nothing in this file allocates a float at any point. Decimals written on
 * the board ("2.5") are read as 25/10 by `parseDecimal`, from their digits.
 */

export interface Rational {
  /** Numerator. Carries the sign. */
  readonly n: bigint;
  /** Denominator. Always > 0, and shares no factor with `n`. */
  readonly d: bigint;
}

/** Thrown when a divisor is zero. The checker reports it as a failure of the line. */
export class DivisionByZero extends Error {
  constructor() {
    super('division by zero');
    this.name = 'DivisionByZero';
  }
}

const abs = (a: bigint): bigint => (a < 0n ? -a : a);

function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/**
 * Build a fraction in lowest terms. A `number` argument must be an integer —
 * `BigInt(0.5)` throws a RangeError, which is the point: no float gets in.
 */
export function rational(n: bigint | number, d: bigint | number = 1n): Rational {
  let num = BigInt(n);
  let den = BigInt(d);
  if (den === 0n) throw new DivisionByZero();
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return g > 1n ? { n: num / g, d: den / g } : { n: num, d: den };
}

export const ZERO: Rational = { n: 0n, d: 1n };
export const ONE: Rational = { n: 1n, d: 1n };

export const add = (a: Rational, b: Rational): Rational => rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational): Rational => rational(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational): Rational => rational(a.n * b.n, a.d * b.d);
export const neg = (a: Rational): Rational => ({ n: -a.n, d: a.d });

/** Throws `DivisionByZero` when `b` is zero. */
export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0n) throw new DivisionByZero();
  return rational(a.n * b.d, a.d * b.n);
}

export const isZero = (a: Rational): boolean => a.n === 0n;
export const isInteger = (a: Rational): boolean => a.d === 1n;
/** Lowest terms make this exact: equal values have equal parts. */
export const equals = (a: Rational, b: Rational): boolean => a.n === b.n && a.d === b.d;

/** `a` to an integer power. A negative power of zero throws `DivisionByZero`. */
/**
 * A power whose result would be past what a board line ever needs. Checked on
 * the RESULT'S size, not the exponent: nested powers multiply, and
 * "(((9^64)^64)^64)^64" froze the thread for minutes (review, 2026-09-29).
 * The checker reads it as a line it cannot settle — skipped, never failed.
 */
export class TooLarge extends Error {
  constructor() {
    super('a power this large is past what this checker works out');
    this.name = 'TooLarge';
  }
}

/** Past this many bits in the result, a power is refused (`TooLarge`). */
const MAX_RESULT_BITS = 4096;
const bits = (n: bigint): number => (n < 0n ? -n : n).toString(2).length;

export function pow(a: Rational, k: number): Rational {
  if (!Number.isInteger(k)) throw new RangeError(`power ${k} is not a whole number`);
  if (k < 0) return pow(div(ONE, a), -k);
  if ((bits(a.n) + bits(a.d)) * k > MAX_RESULT_BITS) throw new TooLarge();
  // Square and multiply: log2(k) steps, not k.
  let out = ONE;
  let base = a;
  let e = k;
  while (e > 0) {
    if (e & 1) out = mul(out, base);
    e >>= 1;
    if (e > 0) base = mul(base, base);
  }
  return out;
}

/** Read "12", "2.5" or ".5" from its digits. Returns null for anything else. */
export function parseDecimal(text: string): Rational | null {
  const m = /^(\d*)(?:\.(\d+))?$/.exec(text);
  if (!m || (m[1] === '' && m[2] === undefined)) return null;
  const whole = m[1] === '' ? '0' : m[1];
  const frac = m[2] ?? '';
  return rational(BigInt(whole + frac), 10n ** BigInt(frac.length));
}

/** "49/29", "-19", "0". */
export function formatRational(a: Rational): string {
  return a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
}
