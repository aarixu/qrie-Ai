import { toPoly } from './expr.ts';
import { parseLine, type Statement } from './parse.ts';
import * as P from './poly.ts';
import { TooLarge, div, equals, formatRational, isZero, mul, neg, type Rational } from './rational.ts';

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
 *   - VALUE: a final "x = n" that does not make the line before true, where
 *     terms had to move to get there ("x = 17" after "x + 5 = 12"): it may be
 *     the sum or the move, so it is named as neither. After "3x = 9" the only
 *     step left is the division, and "x = 6" is ARITHMETIC.
 *
 * Every statement of a step must follow from the one before it, and every
 * link of a chain ("3(x + 4) = 3x + 12 = 21") must hold, not only its ends.
 *
 * THE RULE. A line's equation is its first side minus its last. A step is
 * right when its equation is a non-zero multiple of the previous one's — the
 * same equation moved, collected, divided or multiplied through — and every
 * all-number part of it is true. "x = 3" after "3x = 9" is right; so is a
 * root list "x = 2, x = 3" whose every value makes the previous line true.
 *
 * A line with no unknown at all ("21 - 12 = 9") is a sum on the side: right,
 * or an ARITHMETIC slip, and marked `aside` so it is never the next step's
 * reference.
 *
 * What it does not judge: a step it cannot read (it says so, and the tutor
 * does not pretend), and anything past polynomial equations — a step that
 * squares both sides, or takes a root, reads as a changed equation.
 */

export type StepVerdict =
  | { ok: true; solved?: { name: string; value: Rational }; aside?: true }
  | { ok: false; kind: 'arithmetic' | 'procedural' | 'value'; reason: string }
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

/** "x = 3" alone, or chained to it ("x = 9/3 = 3"): the letter and its value. */
function claimOf(st: Statement): { name: string; value: Rational } | null {
  if (st.sides.length < 2) return null;
  const [l, r] = [st.sides[0], st.sides[st.sides.length - 1]].map((s) => toPoly(s.expr));
  const vars = [...P.variablesOf(l)];
  if (vars.length !== 1 || P.variablesOf(r).size !== 0) return null;
  // The left side is the letter itself, nothing more.
  if (!P.isZero(P.sub(l, P.variable(vars[0])))) return null;
  const value = P.constantValue(r);
  return value === null ? null : { name: vars[0], value };
}

/** "3x = 9", "x/2 = 4": one term in the letter against a number — only a division is left. */
function dividingThrough(st: Statement): boolean {
  if (st.sides.length < 2) return false;
  const [l, r] = [st.sides[0], st.sides[st.sides.length - 1]].map((s) => toPoly(s.expr));
  const one = (a: P.Poly, b: P.Poly) => a.size === 1 && P.variablesOf(a).size === 1 && P.variablesOf(b).size === 0;
  return one(l, r) || one(r, l);
}

/**
 * A chain "a = b = c" claims every link. Each must be an identity (3(x + 4) =
 * 3x + 12), all numbers (checked by `arithmeticSlip`), or the statement's own
 * equation; "3(x + 4) = 3x + 4 = 21" breaks at its first link.
 */
function brokenLink(st: Statement): boolean {
  if (st.sides.length < 3) return false;
  const whole = equationOf(st);
  const polys = st.sides.map((side) => toPoly(side.expr));
  for (let i = 0; i + 1 < polys.length; i++) {
    const link = P.sub(polys[i], polys[i + 1]);
    if (P.isZero(link)) continue;
    if (P.variablesOf(polys[i]).size === 0 && P.variablesOf(polys[i + 1]).size === 0) continue;
    if (proportional(whole, link) !== null) continue;
    return true;
  }
  return false;
}

/** Why `st` does not follow from `ref` (whose statement is `refSt`). */
function notFollowing(st: Statement, ref: P.Poly, refSt: Statement): StepVerdict {
  // "x = 6" after "3x = 9": the method was right and the division was not.
  // "x = 12 - 2" after "2x = 12" shows the operation they chose — the
  // wrong one — so it is the method, not the sum.
  const claim = claimOf(st);
  const bare = /^\s*-?\d+(\.\d+)?(\s*\/\s*\d+)?\s*$/.test(st.sides.at(-1)?.source ?? '');
  if (claim && bare && P.variablesOf(ref).size === 1 && ref.size <= 2) {
    const reason = `${claim.name} = ${formatRational(claim.value)} does not make the line before true`;
    return { ok: false, kind: dividingThrough(refSt) ? 'arithmetic' : 'value', reason };
  }
  return { ok: false, kind: 'procedural', reason: 'this step is not the same equation as the line before' };
}

/**
 * Whether the "Work it out" panel can check a question's equation: one
 * linear equation in one unknown, not already solved. Quadratics, pairs of
 * equations and a given value ("x = 3") are past what `checkStep` can follow
 * to an answer, so the panel is not offered for them (eighth review).
 */
export function workableEquation(line: string): boolean {
  const parsed = parseLine(line);
  if (!parsed.ok || parsed.line.statements.length !== 1) return false;
  const st = parsed.line.statements[0];
  if (st.sides.length !== 2) return false;
  try {
    const eq = equationOf(st);
    const vars = [...P.variablesOf(eq)];
    if (vars.length !== 1 || P.degreeIn(eq, vars[0]) !== 1) return false;
    return claimOf(st) === null && claimOf({ ...st, sides: [st.sides[1], st.sides[0]] }) === null;
  } catch {
    return false;
  }
}

/**
 * The one value of a linear equation in one unknown ("2x + 3 = 11" → x = 4),
 * or null for anything `workableEquation` refuses. What "Work it out" is
 * working towards.
 */
export function solveOne(line: string): { name: string; value: Rational } | null {
  if (!workableEquation(line)) return null;
  const parsed = parseLine(line);
  if (!parsed.ok) return null;
  try {
    const row = P.linearRow(equationOf(parsed.line.statements[0]));
    if (!row || row.coefs.size !== 1) return null;
    const [[name, coef]] = [...row.coefs];
    return { name, value: div(neg(row.constant), coef) };
  } catch {
    return null;
  }
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

/**
 * The same equation WRITTEN THE SAME WAY — each side equal as a polynomial,
 * in either order. Stricter than a right step: "3x + 12 = 21" is a right step
 * towards "x = 3" but is not "x = 3". Used to tell when a step IS the answer a
 * question asks for.
 */
export function sameEquation(a: string, b: string): boolean {
  const pa = parseLine(a);
  const pb = parseLine(b);
  if (!pa.ok || !pb.ok) return false;
  try {
    const sides = (l: typeof pa.line) => {
      const st = l.statements[l.statements.length - 1];
      return [toPoly(st.sides[0].expr), toPoly(st.sides[st.sides.length - 1].expr)];
    };
    const [a1, a2] = sides(pa.line);
    const [b1, b2] = sides(pb.line);
    const eq = (x: P.Poly, y: P.Poly) => P.isZero(P.sub(x, y));
    return (eq(a1, b1) && eq(a2, b2)) || (eq(a1, b2) && eq(a2, b1));
  } catch {
    return false;
  }
}

/** The equation inside a sentence: "What remains is x + 3 = 7." gives "x + 3 = 7". */
export function equationIn(sentence: string): string | null {
  const part = sentence.match(/[^.;,:]*=[^.;,:]*/)?.[0];
  if (!part) return null;
  return part.replace(/^\s*(?:[A-Za-z]{2,}\s+)+/, '').trim() || null;
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
    // A line with no unknown in it is a sum worked on the side — its
    // arithmetic was checked just above — and never a step of the equation,
    // nor the line the next step is read against (fourth review).
    if (now.line.statements.every((st) => st.sides.every((side) => P.variablesOf(toPoly(side.expr)).size === 0))) {
      return { ok: true, aside: true };
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

    // Each statement from the one before it, starting from the line before.
    let ref = prev;
    let refSt = prevStatements[prevStatements.length - 1];
    for (const st of now.line.statements) {
      // A sum worked beside the step ("21 - 12 = 9, 3x = 9") says nothing
      // about the equation, and `arithmeticSlip` has already checked it.
      if (st.sides.every((side) => P.variablesOf(toPoly(side.expr)).size === 0)) continue;
      if (brokenLink(st)) return { ok: false, kind: 'procedural', reason: 'one link of this chain is not the same as the next' };
      const eq = equationOf(st);
      if (proportional(ref, eq) === null) return notFollowing(st, ref, refSt);
      ref = eq;
      refSt = st;
    }
    const solved = claimOf(refSt);
    return solved ? { ok: true, solved } : { ok: true };
  } catch (e) {
    if (e instanceof P.NotPolynomial || e instanceof TooLarge) return { ok: null, reason: 'this step is past what can be checked' };
    throw e;
  }
}
