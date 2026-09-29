import { toPoly } from './expr.ts';
import { parseLine, type Statement } from './parse.ts';
import * as P from './poly.ts';
import { TooLarge, div, equals, formatRational, isZero, mul, type Rational } from './rational.ts';

/**
 * ONE STEP OF A STUDENT'S WORKING, CHECKED AGAINST THE STEP BEFORE IT (T8.1).
 *
 * A tutor watching a child solve 3(x + 4) = 21 does not wait for the answer:
 * she looks at each line as it is written. So does this — exactly, with no
 * model — and it says which KIND of slip it is, because the two are helped
 * differently:
 *   - ARITHMETIC: a number worked out wrong inside the line ("21 − 12 = 8");
 *     the method is fine, a calculation is not.
 *   - PROCEDURAL: the line is not the same equation any more ("3x + 4 = 21"
 *     after "3(x + 4) = 21" — the bracket was opened on one term only).
 *
 * THE RULE. A line's equation is its first side minus its last. A step is
 * right when its equation is a non-zero multiple of the previous one's — the
 * same equation moved, collected, divided or multiplied through — and every
 * all-number part of it is true. "x = 3" after "3x = 9" is right; so is a
 * root list "x = 2, x = 3" whose every value makes the previous line true.
 *
 * What it does not judge: a step it cannot read (it says so, and the tutor
 * does not pretend), and anything past polynomial equations — a step that
 * squares both sides, or takes a root, reads as a changed equation.
 */

export type StepVerdict =
  | { ok: true; solved?: { name: string; value: Rational } }
  | { ok: false; kind: 'arithmetic' | 'procedural'; reason: string }
  | { ok: null; reason: string };

const equationOf = (st: Statement): P.Poly => P.sub(toPoly(st.sides[0].expr), toPoly(st.sides[st.sides.length - 1].expr));

/** A non-zero rational k with b = k·a, or null. */
function proportional(a: P.Poly, b: P.Poly): Rational | null {
  if (P.isZero(a) || P.isZero(b) || a.size !== b.size) return null;
  let k: Rational | null = null;
  for (const [key, term] of a) {
    const other = b.get(key);
    if (!other) return null;
    const ratio = div(other.coef, term.coef);
    if (k === null) k = ratio;
    else if (!equals(k, ratio)) return null;
  }
  return k !== null && !isZero(k) ? k : null;
}

/** The first all-number pair of neighbouring sides that disagree, as a reason. */
function arithmeticSlip(st: Statement): string | null {
  const values = st.sides.map((side) => {
    const p = toPoly(side.expr);
    return P.variablesOf(p).size === 0 ? (P.constantValue(p) ?? { n: 0n, d: 1n }) : null;
  });
  for (let i = 0; i + 1 < st.sides.length; i++) {
    const a = values[i];
    const b = values[i + 1];
    if (a && b && !equals(a, b)) {
      return `${st.sides[i].source.trim()} is ${formatRational(a)}, not ${formatRational(b)}`;
    }
  }
  return null;
}

/** "x = 3" alone: the letter and its value. */
function claimOf(st: Statement): { name: string; value: Rational } | null {
  if (st.sides.length !== 2) return null;
  const [l, r] = st.sides.map((s) => toPoly(s.expr));
  const vars = [...P.variablesOf(l)];
  if (vars.length !== 1 || P.variablesOf(r).size !== 0) return null;
  // The left side is the letter itself, nothing more.
  if (!P.isZero(P.sub(l, P.variable(vars[0])))) return null;
  const value = P.constantValue(r);
  return value === null ? null : { name: vars[0], value };
}

/** Does `value` make the previous equation true? */
function satisfies(prev: P.Poly, name: string, value: Rational): boolean {
  const rest = P.variablesOf(prev);
  rest.delete(name);
  if (rest.size > 0) return false;
  let total: Rational = { n: 0n, d: 1n };
  for (const term of prev.values()) {
    const power = term.powers[name] ?? 0;
    let v: Rational = { n: 1n, d: 1n };
    for (let i = 0; i < power; i++) v = mul(v, value);
    const t = mul(term.coef, v);
    total = { n: total.n * t.d + t.n * total.d, d: total.d * t.d };
  }
  return total.n === 0n;
}

export function checkStep(previous: string, step: string): StepVerdict {
  const before = parseLine(previous);
  const now = parseLine(step);
  if (!now.ok) return { ok: null, reason: `this step could not be read: ${now.reason}` };
  if (!before.ok) return { ok: null, reason: `the line before could not be read: ${before.reason}` };
  try {
    // A number worked out wrong inside the step is the slip, whatever else.
    for (const st of now.line.statements) {
      const slip = arithmeticSlip(st);
      if (slip) return { ok: false, kind: 'arithmetic', reason: slip };
    }
    const prevStatements = before.line.statements;
    const prev = equationOf(prevStatements[prevStatements.length - 1]);

    // A list of roots: every one must make the line before true.
    const claims = now.line.statements.map(claimOf);
    if (now.line.statements.length > 1 && claims.every((c) => c !== null)) {
      const wrong = claims.find((c) => !satisfies(prev, c!.name, c!.value));
      return wrong
        ? { ok: false, kind: 'arithmetic', reason: `${wrong.name} = ${formatRational(wrong.value)} does not make the line before true` }
        : { ok: true };
    }

    const next = equationOf(now.line.statements[now.line.statements.length - 1]);
    if (proportional(prev, next) !== null) {
      const solved = claims.length === 1 ? claims[0] : null;
      return solved ? { ok: true, solved } : { ok: true };
    }

    // "x = 6" after "3x = 9": the method was right and the division was not.
    // "x = 12 - 2" after "2x = 12" shows the operation they chose — the
    // wrong one — so it is the method, not the sum.
    const claim = claims.length === 1 ? claims[0] : null;
    const bare = /^\s*-?\d+(\.\d+)?(\s*\/\s*\d+)?\s*$/.test(
      now.line.statements[now.line.statements.length - 1].sides.at(-1)?.source ?? '',
    );
    if (claim && bare && P.variablesOf(prev).size === 1 && prev.size <= 2) {
      return { ok: false, kind: 'arithmetic', reason: `${claim.name} = ${formatRational(claim.value)} does not make the line before true` };
    }
    return { ok: false, kind: 'procedural', reason: 'this step is not the same equation as the line before' };
  } catch (e) {
    if (e instanceof P.NotPolynomial || e instanceof TooLarge) return { ok: null, reason: 'this step is past what can be checked' };
    throw e;
  }
}
