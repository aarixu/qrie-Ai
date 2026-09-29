/**
 * THE CHECK — does the working on the board agree with the answer it reaches?
 *
 * Deterministic, exact, and 0 model calls. Given the equation-like lines of a
 * lesson in the order the class writes them, it:
 *
 *   1. READS each line (parse.ts). A line it cannot read is SKIPPED, with a
 *      reason — never failed.
 *
 *   2. FINDS THE CLAIMED ANSWERS. A claim is a statement with a lone variable
 *      at one end and a constant at the other: `y = 19 / 29`,
 *      `x = 3 - 2(19/29) = (87 - 38)/29 = 49 / 29`, or either half of
 *      `Solution: x = 49/29, y = 19/29`.
 *
 *   3. SPLITS THE LINES INTO PROBLEMS. A problem runs up to and including a
 *      run of claims; a line of working after that run starts the next one.
 *      Two neighbouring problems are joined back into one when their claims
 *      agree, or when joining them leaves no more failing lines than keeping
 *      them apart — so a wrong "y = 19/28" in the middle of a derivation is
 *      one problem with a bad line, while two worked examples with answers
 *      x = 2 and x = 3 stay two problems. A line labelled as a practice
 *      question ("Try:", "Your turn:" — parse.ts) is a problem of its own
 *      wherever it stands, never joined to a neighbour, so it is held to no
 *      worked example's answer. Lines after the last claim have no answer to
 *      be held to either; their variable steps are skipped.
 *
 *   4. PICKS ONE ANSWER PER PROBLEM. When claims disagree, the combinations
 *      of the values they offer are tried — every constant side of a claim
 *      chain counts, so `x = 8/2 = 5` offers 4 and 5 — and the one under
 *      which the fewest lines fail is kept. Ties go to the answer on a line
 *      labelled "Solution:"/"Answer:", else to the last one written; the
 *      label never outvotes the working. Past 64 combinations only that
 *      preferred answer is tried.
 *
 *      ROOTS. A variable that some line of the problem uses at degree 2 or
 *      more, as a polynomial (`x² - 5x + 6 = 0`, `(x - 2)(x - 3) = 0`), may
 *      have several values at once. Its claims are not rivals: the answers
 *      tried for it are SETS of the values offered — every value claimed
 *      first, then every other set of them, largest first (past 6 distinct
 *      values, only the claimed set). Under a set of roots, a statement with
 *      a pair that uses the variable at degree 2 or more — or that mentions
 *      it and is not a polynomial, such as a variable in a divisor — must
 *      hold for EVERY root; any other statement must hold for AT LEAST ONE,
 *      and statements joined by `⇒` on one line for the same one
 *      (`x - 2 = 0 ⇒ x = 3` fails). A claimed root the quadratic does not
 *      hold for fails the problem either way: under a set that includes it
 *      that line fails, and under a set without it the root's own claim
 *      fails. A root set is reported in `roots`, not `solutions`; one claimed
 *      value is an ordinary answer.
 *
 *   5. CHECKS EVERY ADJACENT PAIR of every chain. A pair that is equal as
 *      polynomials holds whatever the values (`7(3 - 2y) - 15y = 21 - 14y -
 *      15y`); a pair of constants is equal or not (`2 - 21 = -17` fails);
 *      a pair with variables is held to the problem's answer; a pair that
 *      divides by zero fails; a pair whose variables have no answer is left
 *      open. A line fails if any pair fails, passes if some pair held and
 *      none failed, and is skipped when every pair was left open.
 *
 * ONE SHAPE IS EXCUSED, and only when the lines carry pages (`section`):
 * a page that comes before every page holding an answer or a line that holds
 * under it; whose equations pin an answer of their own in two or more
 * variables (a determined linear system of two or more equations); under
 * whose own answer nothing off that page holds; and whose problem is stated
 * again where it is worked — the lines of working off that page that hold
 * (claims do not count) pin the problem's answer by themselves. That is an
 * opening puzzle the class never solves — the proof lesson's
 * "x + y = 50, y = x + 30", followed by a page that states and works
 * "7x - 15y = 2, x + 2y = 3" — and its lines that fail only under the
 * problem's answer are skipped as a separate problem. So these still fail:
 * a lone line on such a page, which pins no answer; a one-variable problem
 * stated on its own page ("3x + 5 = 20") and worked on the next with a slip
 * in the first step; a stated system followed by pages that write only an
 * answer; a page whose answer the later working does follow; and a numeric
 * slip on such a page ("50 - 30 = 25"), which is never excused.
 *
 * KNOWN BLIND SPOT: a system in two or more variables stated alone on its
 * own page, followed on later pages by working that restates it with every
 * equation changed — so that nothing on either side holds under the other
 * side's answer — looks exactly like an unsolved opening puzzle followed by
 * a new problem, and is skipped. Nothing in the maths tells the two apart;
 * the page boundary is the only cue used.
 */

import { toPoly, valueOf, variablesIn, type Expr, type Values } from './expr.ts';
import { parseLine, type ParsedLine, type Side } from './parse.ts';
import * as P from './poly.ts';
import { TooLarge, DivisionByZero, equals, formatRational, type Rational } from './rational.ts';

/** One line of board text. `section` groups lines by page; see the header. */
export interface Line {
  id: string;
  text: string;
  section?: string;
}

export interface Failure {
  id: string;
  text: string;
  reason: string;
}

export interface Skipped {
  id: string;
  text: string;
  reason: string;
}

export interface Passed {
  id: string;
  text: string;
}

export interface Problem {
  /** The lines held to this answer: every line of the problem that passed or failed. */
  ids: string[];
  /** One value per variable. A variable with a set of roots is in `roots` instead. */
  solutions: Record<string, Rational>;
  /** Each variable kept with two or more roots (header, step 4), in board order. */
  roots: Record<string, Rational[]>;
}

export interface CheckResult {
  /**
   * True when no line failed. A result with nothing checked is also ok — the
   * caller decides whether that is enough.
   */
  ok: boolean;
  /**
   * The answers of the LAST problem that has any (the board's final answer).
   * Every problem, with its own answers, is in `problems`.
   */
  solutions: Record<string, Rational>;
  /** The root sets of that same last problem; empty when it has none. */
  roots: Record<string, Rational[]>;
  failures: Failure[];
  skipped: Skipped[];
  passed: Passed[];
  /** Each problem that claims an answer, in board order. */
  problems: Problem[];
}

// ------------------------------------------------------------ preparing --

interface Claim {
  name: string;
  /** The answer this claim states: the constant at the far end from the variable. */
  stated: Rational;
  /** Every constant side of the chain, in order — `x = 8/2 = 5` offers 4 and 5. */
  offered: Rational[];
  final: boolean;
}

interface Pair {
  left: Side;
  right: Side;
  /** left - right with no values put in; or why it could not be built. */
  sym: P.Poly | 'div-zero' | 'not-poly';
  vars: Set<string>;
}

interface Prepared {
  line: Line;
  parsed: ParsedLine | null;
  parseReason: string;
  pairs: Pair[][]; // per statement
  claims: Claim[];
  kind: 'claim' | 'work' | 'other';
  /** Labelled as a practice question: a problem of its own (header, step 3). */
  practice: boolean;
}

function symbolic(a: Expr, b: Expr): Pair['sym'] {
  try {
    return toPoly({ k: 'sub', a, b });
  } catch (e) {
    if (e instanceof DivisionByZero) return 'div-zero';
    if (e instanceof P.NotPolynomial || e instanceof TooLarge) return 'not-poly';
    throw e;
  }
}

function claimOf(sides: Side[], final: boolean): Claim | null {
  for (const ordered of [sides, [...sides].reverse()]) {
    const head = ordered[0].expr;
    const tail = ordered[ordered.length - 1].expr;
    if (head.k !== 'var') continue;
    const stated = variablesIn(tail).size === 0 ? valueOf(tail) : null;
    if (stated === null) continue;
    const offered = ordered
      .slice(1)
      .filter((s) => variablesIn(s.expr).size === 0)
      .map((s) => valueOf(s.expr))
      .filter((v): v is Rational => v !== null);
    return { name: head.name, stated, offered, final };
  }
  return null;
}

function prepare(line: Line): Prepared {
  const read = parseLine(line.text);
  if (!read.ok) {
    return { line, parsed: null, parseReason: read.reason, pairs: [], claims: [], kind: 'other', practice: false };
  }
  const pairs = read.line.statements.map((st) =>
    st.sides.slice(1).map((right, i) => {
      const left = st.sides[i];
      return {
        left,
        right,
        sym: symbolic(left.expr, right.expr),
        vars: variablesIn(right.expr, variablesIn(left.expr)),
      };
    }),
  );
  const claims = read.line.statements
    .map((st) => claimOf(st.sides, read.line.final))
    .filter((c): c is Claim => c !== null);
  const hasVars = pairs.some((ps) => ps.some((p) => p.vars.size > 0));
  return {
    line,
    parsed: read.line,
    parseReason: '',
    pairs,
    claims,
    kind: claims.length > 0 ? 'claim' : hasVars ? 'work' : 'other',
    practice: read.line.practice,
  };
}

// -------------------------------------------------------------- judging --

/**
 * An answer being tried for one problem: the values each variable may take.
 * One value for most variables; two or more only for a set of roots
 * (header, step 4).
 */
type Answer = Readonly<Record<string, readonly Rational[]>>;

const showValues = (values: Values, only?: Iterable<string>): string => {
  const names = only ? [...new Set(only)].filter((v) => v in values) : Object.keys(values);
  return names
    .sort()
    .map((v) => `${v} = ${formatRational(values[v])}`)
    .join(', ');
};

/** `x = 2 or x = 3, y = 1` — an answer, roots and all. */
const showAnswer = (answer: Answer, only?: ReadonlySet<string>): string =>
  Object.keys(answer)
    .filter((v) => !only || only.has(v))
    .sort()
    .map((v) => answer[v].map((r) => `${v} = ${formatRational(r)}`).join(' or '))
    .join(', ');

type PairVerdict =
  | { kind: 'holds'; usedValues: boolean }
  | { kind: 'fails'; usedValues: boolean; reason: string }
  | { kind: 'open'; free: string[] };

function describeMismatch(pair: Pair, values: Values, used: boolean): string {
  const lv = valueOf(pair.left.expr, values);
  const rv = valueOf(pair.right.expr, values);
  const when = used ? `, when ${showValues(values, pair.vars)}` : '';
  // "y = <something>" that disagrees with the answer kept for the problem
  // (the one step 4 of the header picked): say it in those words.
  for (const [lone, other, otherValue] of [
    [pair.left, pair.right, rv],
    [pair.right, pair.left, lv],
  ] as const) {
    if (lone.expr.k === 'var' && otherValue !== null && lone.expr.name in values) {
      const v = lone.expr.name;
      const otherVars = variablesIn(other.expr);
      const from =
        otherVars.size > 0 ? ` (from \`${other.source}\`, when ${showValues(values, otherVars)})` : '';
      return (
        `this line gives ${v} = ${formatRational(otherValue)}${from}, ` +
        `but the answer kept for this problem is ${v} = ${formatRational(values[v])}`
      );
    }
  }
  if (lv !== null && rv !== null) {
    return `\`${pair.left.source}\` is ${formatRational(lv)}, not ${formatRational(rv)}${when}`;
  }
  return `\`${pair.left.source}\` and \`${pair.right.source}\` differ${when}`;
}

function judgePair(pair: Pair, values: Values): PairVerdict {
  if (pair.sym === 'div-zero') {
    const reason = `\`${pair.left.source} = ${pair.right.source}\` divides by zero`;
    return { kind: 'fails', usedValues: false, reason };
  }
  let needed: Set<string>;
  if (pair.sym === 'not-poly') {
    needed = pair.vars;
  } else {
    if (P.isZero(pair.sym)) return { kind: 'holds', usedValues: false };
    needed = P.variablesOf(pair.sym);
    if (needed.size === 0) {
      return { kind: 'fails', usedValues: false, reason: describeMismatch(pair, {}, false) };
    }
  }
  const free = [...needed].filter((v) => !(v in values));
  if (free.length > 0) return { kind: 'open', free };
  let diff: Rational | null;
  try {
    diff = P.constantValue(toPoly({ k: 'sub', a: pair.left.expr, b: pair.right.expr }, values));
  } catch (e) {
    if (e instanceof DivisionByZero) {
      const when = showValues(values, pair.vars);
      const reason = `\`${pair.left.source} = ${pair.right.source}\` divides by zero when ${when}`;
      return { kind: 'fails', usedValues: true, reason };
    }
    if (e instanceof P.NotPolynomial || e instanceof TooLarge) return { kind: 'open', free: [] };
    throw e;
  }
  if (diff === null) return { kind: 'open', free: [] };
  if (diff.n === 0n) return { kind: 'holds', usedValues: true };
  return { kind: 'fails', usedValues: true, reason: describeMismatch(pair, values, true) };
}

/** One statement (a chain of `=`) under one set of values. */
interface StatementVerdict {
  outcome: 'held' | 'failed' | 'open';
  reasons: string[];
  /** How many of `reasons` came from pairs that failed with no values put in. */
  plain: number;
  free: string[];
  /** Some pair held only because of the values put in. */
  heldOnValues: boolean;
  /** Every failing pair failed only because of the values put in (true when none failed). */
  failedOnValuesOnly: boolean;
}

function judgeStatement(pairs: readonly Pair[], values: Values): StatementVerdict {
  const reasons: string[] = [];
  const free: string[] = [];
  let plain = 0;
  let held = false;
  let heldOnValues = false;
  for (const pair of pairs) {
    const v = judgePair(pair, values);
    if (v.kind === 'holds') {
      held = true;
      if (v.usedValues) heldOnValues = true;
    } else if (v.kind === 'fails') {
      reasons.push(v.reason);
      if (!v.usedValues) plain++;
    } else {
      free.push(...v.free);
    }
  }
  return {
    outcome: reasons.length > 0 ? 'failed' : held ? 'held' : 'open',
    reasons,
    plain,
    free,
    heldOnValues,
    failedOnValuesOnly: plain === 0,
  };
}

const openVerdict = (free: string[]): StatementVerdict => ({
  outcome: 'open',
  reasons: [],
  plain: 0,
  free,
  heldOnValues: false,
  failedOnValuesOnly: true,
});

interface Judged {
  status: 'passed' | 'failed' | 'skipped';
  reason: string;
  /** Some pair held only because of the values put in. */
  heldOnValues: boolean;
  /** Every failing pair failed only because of the values put in. */
  failedOnValuesOnly: boolean;
}

/** A line's verdict from its statements' — step 5 of the header. */
function lineVerdict(p: Prepared, verdicts: readonly StatementVerdict[]): Judged {
  const reasons = verdicts.flatMap((v) => v.reasons);
  const heldOnValues = verdicts.some((v) => v.heldOnValues);
  if (reasons.length > 0) {
    const failedOnValuesOnly = verdicts.every((v) => v.failedOnValuesOnly);
    return { status: 'failed', reason: reasons.join('; '), heldOnValues, failedOnValuesOnly };
  }
  if (verdicts.some((v) => v.outcome === 'held')) {
    return { status: 'passed', reason: '', heldOnValues, failedOnValuesOnly: false };
  }
  const names = [...new Set(verdicts.flatMap((v) => v.free))].sort().join(', ');
  const why = names
    ? `it depends on ${names}, which no answer written for its problem gives a value`
    : 'nothing in it could be worked out to a number';
  return {
    status: 'skipped',
    reason: p.practice ? `a practice question for the student, held to no worked example's answer: ${why}` : why,
    heldOnValues: false,
    failedOnValuesOnly: false,
  };
}

/** The line under one value per variable. */
function judgeLine(p: Prepared, values: Values): Judged {
  if (!p.parsed) {
    const reason = `not read as an equation: ${p.parseReason}`;
    return { status: 'skipped', reason, heldOnValues: false, failedOnValuesOnly: false };
  }
  return lineVerdict(
    p,
    p.pairs.map((statement) => judgeStatement(statement, values)),
  );
}

/** Every way of picking one value per variable from `answer`. */
function assignmentsOf(answer: Answer): Values[] {
  let out: Record<string, Rational>[] = [{}];
  for (const [name, vals] of Object.entries(answer)) {
    out = out.flatMap((a) => vals.map((v) => ({ ...a, [name]: v })));
  }
  return out;
}

/** A pair that must hold for every root: it uses a root variable at degree 2 or more, or divides by it. */
function mustHoldForEveryRoot(pair: Pair, roots: ReadonlySet<string>): boolean {
  if (pair.sym === 'div-zero') return false;
  if (pair.sym === 'not-poly') return [...pair.vars].some((v) => roots.has(v));
  const sym = pair.sym;
  return [...roots].some((v) => P.degreeIn(sym, v) >= 2);
}

/** A statement that must hold under every assignment: the first failure, else held or open. */
function forEveryRoot(pairs: readonly Pair[], assignments: readonly Values[]): StatementVerdict {
  const each = assignments.map((a) => judgeStatement(pairs, a));
  const failed = each.find((v) => v.outcome === 'failed');
  if (failed) return failed;
  const held = each.filter((v) => v.outcome === 'held');
  if (held.length > 0) return { ...held[0], heldOnValues: held.some((v) => v.heldOnValues) };
  return openVerdict(each.flatMap((v) => v.free));
}

/**
 * Statements joined by `⇒` that must hold together under at least one
 * assignment. Returns one verdict per member, in order.
 */
function forSomeRoot(
  members: readonly { pairs: readonly Pair[]; sides: readonly Side[] }[],
  assignments: readonly Values[],
  answer: Answer,
  roots: ReadonlySet<string>,
): StatementVerdict[] {
  const table = assignments.map((a) => members.map((m) => judgeStatement(m.pairs, a)));
  const holds = table.find(
    (row) => row.every((v) => v.outcome !== 'failed') && row.some((v) => v.outcome === 'held'),
  );
  if (holds) return holds;
  if (!table.every((row) => row.some((v) => v.outcome === 'failed'))) {
    // No root settles it either way.
    return members.map((_, j) => openVerdict(table.flatMap((row) => row[j].free)));
  }
  // It fails for every root. The row with the fewest reasons explains it;
  // a slip no root can mend (`(5 + 1)/2 = 4`) is reported as itself.
  const count = (row: StatementVerdict[]) => row.reduce((n, v) => n + v.reasons.length, 0);
  const best = table.reduce((a, b) => (count(b) < count(a) ? b : a));
  const usesRoots = members.some((m) => m.pairs.some((pair) => [...pair.vars].some((v) => roots.has(v))));
  if (!usesRoots || best.every((v) => v.reasons.length === v.plain)) return best;
  const kept = showAnswer(answer, roots);
  const claim = members.length === 1 ? claimOf([...members[0].sides], false) : null;
  const reason =
    claim && roots.has(claim.name)
      ? `this line gives ${claim.name} = ${formatRational(claim.stated)}, ` +
        `which is not one of the roots kept for this problem (${kept})`
      : `\`${members.map((m) => m.sides.map((s) => s.source).join(' = ')).join(' ⇒ ')}\` ` +
        `holds for none of the roots kept for this problem (${kept})`;
  return members.map((_, j) =>
    j === 0
      ? { outcome: 'failed', reasons: [reason], plain: 0, free: [], heldOnValues: false, failedOnValuesOnly: true }
      : openVerdict([]),
  );
}

/** The line under an answer that may hold root sets (header, step 4). */
function judgeUnder(p: Prepared, answer: Answer): Judged {
  const assignments = assignmentsOf(answer);
  if (assignments.length === 1 || !p.parsed) return judgeLine(p, assignments[0]);
  const roots = new Set(Object.keys(answer).filter((v) => answer[v].length > 1));
  const statements = p.parsed.statements;
  const verdicts: StatementVerdict[] = new Array(statements.length);
  const groups: number[][] = [];
  statements.forEach((st, i) => {
    if (p.pairs[i].some((pair) => mustHoldForEveryRoot(pair, roots))) {
      verdicts[i] = forEveryRoot(p.pairs[i], assignments);
      return;
    }
    const last = groups[groups.length - 1];
    if (st.implied && last) last.push(i);
    else groups.push([i]);
  });
  for (const g of groups) {
    const members = g.map((i) => ({ pairs: p.pairs[i], sides: statements[i].sides }));
    forSomeRoot(members, assignments, answer, roots).forEach((v, j) => {
      verdicts[g[j]] = v;
    });
  }
  return lineVerdict(p, verdicts);
}

// ------------------------------------------------------------- problems --

interface Evaluation {
  answer: Answer;
  judged: Judged[];
  failCount: number;
}

/** Linear rows from the pairs of these lines that are equations, not identities; null on any other shape. */
function linearRows(lines: readonly Prepared[]): P.LinearRow[] | null {
  const rows: P.LinearRow[] = [];
  for (const p of lines) {
    for (const pair of p.pairs.flat()) {
      if (pair.sym === 'div-zero' || pair.vars.size === 0) continue;
      if (pair.sym === 'not-poly') return null;
      if (P.isZero(pair.sym)) continue;
      const row = P.linearRow(pair.sym);
      if (!row) return null;
      rows.push(row);
    }
  }
  return rows;
}

/**
 * The page rule from the header: which pages before the first anchored page
 * are an opening puzzle of their own. Mutates `judged` for those lines.
 */
function excuseSeparatePages(seg: Prepared[], judged: Judged[], answer: Answer): void {
  if (Object.keys(answer).length === 0) return;
  const sections: (string | undefined)[] = [];
  for (const p of seg) if (!sections.includes(p.line.section)) sections.push(p.line.section);
  const anchoredAt = sections.findIndex((s) =>
    seg.some((p, i) => p.line.section === s && (p.claims.length > 0 || judged[i].heldOnValues)),
  );
  for (const s of sections.slice(0, Math.max(anchoredAt, 0))) {
    const idx = seg.flatMap((p, i) => (p.line.section === s ? [i] : []));
    const excusable = idx.filter((i) => judged[i].status === 'failed' && judged[i].failedOnValuesOnly);
    if (excusable.length === 0) continue;

    // Its own determined system in two or more variables. That takes two or
    // more equations — one cannot pin two variables — so the first test only
    // exits early; the variable count is the one that decides.
    const rows = linearRows(idx.map((i) => seg[i]));
    if (!rows || rows.length < 2) continue;
    const own = P.solveLinear(rows);
    if (own.kind !== 'unique' || Object.keys(own.values).length < 2) continue;

    // Does anything off this page follow from this page's own answer?
    const followed = seg.some((p) => p.line.section !== s && judgeLine(p, own.values).heldOnValues);
    if (followed) continue;

    // Is the problem stated again where it is worked? The working off this
    // page that holds — claims excluded — must pin every variable by itself.
    const working = seg.filter(
      (p, i) => p.line.section !== s && p.kind === 'work' && judged[i].status === 'passed',
    );
    const workingRows = linearRows(working);
    const stated = workingRows ? P.solveLinear(workingRows) : null;
    if (!stated || stated.kind !== 'unique' || !Object.keys(own.values).every((v) => v in stated.values)) continue;

    for (const i of excusable) {
      judged[i] = {
        status: 'skipped',
        reason:
          `a separate problem on its own page (its equations give ${showValues(own.values)}), ` +
          `which nothing else on the board follows from, so it is not held to ${showAnswer(answer)}`,
        heldOnValues: false,
        failedOnValuesOnly: false,
      };
    }
  }
}

function evaluate(seg: Prepared[], answer: Answer): Evaluation {
  const judged = seg.map((p) => judgeUnder(p, answer));
  excuseSeparatePages(seg, judged, answer);
  return { answer, judged, failCount: judged.filter((j) => j.status === 'failed').length };
}

/** More combinations than this and only the preferred answer is tried. A guard, not a measurement. */
const MAX_CANDIDATES = 64;
/** More distinct values than this for one root variable and only the claimed set is tried. A guard, not a measurement. */
const MAX_ROOT_VALUES = 6;

/** The variables some line of the problem uses at degree 2 or more — step 4 of the header. */
function squaredVariables(seg: Prepared[]): Set<string> {
  const out = new Set<string>();
  for (const p of seg) {
    for (const pair of p.pairs.flat()) {
      if (typeof pair.sym === 'string') continue;
      for (const v of P.variablesOf(pair.sym)) if (P.degreeIn(pair.sym, v) >= 2) out.add(v);
    }
  }
  return out;
}

/** Root sets to try: every value claimed first, then each other non-empty set of the values offered, largest first. */
function rootSets(claimed: Rational[], offered: Rational[]): Rational[][] {
  if (offered.length > MAX_ROOT_VALUES) return [claimed];
  const others: Rational[][] = [];
  for (let mask = 1; mask < 1 << offered.length; mask++) {
    const set = offered.filter((_, i) => mask & (1 << i));
    const same = set.length === claimed.length && set.every((v) => claimed.some((w) => equals(v, w)));
    if (!same) others.push(set);
  }
  others.sort((a, b) => b.length - a.length);
  return [claimed, ...others];
}

function candidates(seg: Prepared[]): Answer[] {
  const claims = seg.flatMap((p) => p.claims);
  if (claims.length === 0) return [{}];
  const squared = squaredVariables(seg);
  // Per variable: the last claim written, or the last "Solution:"-labelled
  // one when there is any — later claims overwrite earlier ones in this
  // loop. For a squared variable: every distinct value claimed, in order.
  const preferred = new Map<string, Rational[]>();
  for (const c of claims) {
    if (squared.has(c.name)) {
      const set = preferred.get(c.name) ?? [];
      if (!set.some((w) => equals(w, c.stated))) set.push(c.stated);
      preferred.set(c.name, set);
      continue;
    }
    const labelledExists = claims.some((d) => d.name === c.name && d.final);
    if (!labelledExists || c.final) preferred.set(c.name, [c.stated]);
  }
  const options = new Map<string, Rational[][]>();
  for (const [name, claimed] of preferred) {
    const offered = [...claimed];
    for (const c of claims) {
      if (c.name !== name) continue;
      for (const v of c.offered) if (!offered.some((w) => equals(w, v))) offered.push(v);
    }
    options.set(name, squared.has(name) ? rootSets(claimed, offered) : offered.map((v) => [v]));
  }
  let combos: Answer[] = [{}];
  for (const [name, list] of options) {
    combos = combos.flatMap((c) => list.map((v) => ({ ...c, [name]: v })));
    if (combos.length > MAX_CANDIDATES) return [Object.fromEntries(preferred)];
  }
  return combos;
}

function best(seg: Prepared[]): Evaluation {
  let out: Evaluation | null = null;
  for (const answer of candidates(seg)) {
    const e = evaluate(seg, answer);
    if (!out || e.failCount < out.failCount) out = e;
  }
  return out!;
}

const hasClaims = (seg: Prepared[]) => seg.some((p) => p.claims.length > 0);
const isPractice = (seg: Prepared[]) => seg.some((p) => p.practice);

function agree(a: Prepared[], b: Prepared[]): boolean {
  const seen = new Map<string, Rational>();
  for (const c of [...a, ...b].flatMap((p) => p.claims)) {
    const had = seen.get(c.name);
    if (had && !equals(had, c.stated)) return false;
    seen.set(c.name, c.stated);
  }
  return true;
}

/** A line's sides, split at "=", without spaces or a leading label: "4x + 5 = 4(1) + 5" is ["4x+5", "4(1)+5"]. */
function sidesOf(p: Prepared): string[] {
  const text = p.line.text.replace(/^[^=]*?:/, '');
  return text.split('=').map((side) =>
    side
      .replace(/\s+/g, '')
      .toLowerCase()
      // "4 × x + 5" is the same side as "4x + 5" (sixth review).
      .replace(/([0-9])[×*·](?=[a-z])/g, '$1'),
  );
}

/** Every variable a line's working mentions. */
function varsOf(p: Prepared): Set<string> {
  const out = new Set<string>();
  for (const ps of p.pairs) for (const pair of ps) for (const v of pair.vars) out.add(v);
  return out;
}

/** One problem's lines, and those of them carried in from the problem before it. */
interface Segment {
  lines: Prepared[];
  /** A table's equation, or an answer used as the next problem's given. Never this problem's to fail. */
  carried: Set<Prepared>;
}

function problemsOf(prepared: Prepared[]): Segment[] {
  /**
   * A run of claims closes a problem; the next line of working opens another.
   * A practice question is a run of its own.
   *
   * MORE RULES (two reviews, 2026-09-29) — each ordinary Class 6-10 shape was
   * failed as wrong maths (and a failed class is refused), or wrong maths was
   * passed. At a run of claims followed straight away by working that USES
   * those variables:
   *   - AN ANSWER. If the problem so far has an equation in one of those
   *     variables that no claim has answered yet, the run is its answer and is
   *     checked against it: "5x = 15, x = 4" fails. When the working after it
   *     writes the value out ("2x + 1 = 2(4) + 1"), the run is ALSO carried
   *     into the next problem as its given — "find x, then use it".
   *     When the working does not write it out ("x = 2" then "3x - 1 = 8"),
   *     the next problem is a fresh one in the same letter.
   *   - GIVENS. Otherwise — every one of those variables already answered in
   *     the problem so far, or the board starting on them — the run opens a new
   *     problem: "x = 4, 2x + 3 = 11, x = 5, 2x + 3 = 13" and
   *     "a = 4, P = 4a = 16, a = 5, P = 4a = 20" are two problems each.
   *   - A TABLE. Inside a run of claims, a variable claimed again starts a new
   *     problem, and the table's own equation is carried into every row:
   *     "y = 2x + 3, x = 0, y = 3, x = 1, y = 6" fails its second row.
   * A carried line is never failed by the problem it was carried into: the
   * fault is in that problem's own lines (`checkLines`).
   */
  const runs: Segment[] = [];
  let cur: Prepared[] = [];
  let carried = new Set<Prepared>();
  let inClaims = false;
  let givens = false;
  let claimed = new Set<string>();
  /** The letters claimed in the current run, in the order they were first claimed. */
  let runOrder: string[] = [];
  /** The claim lines of an answer that the next working also takes as its given. */
  let passOn: Prepared[] | null = null;
  const close = () => {
    if (cur.length > 0) runs.push({ lines: cur, carried });
    cur = [];
    carried = new Set();
    inClaims = false;
    givens = false;
    claimed = new Set();
    runOrder = [];
  };
  /** Start the next problem on lines carried in from the one just closed. */
  const carryIn = (lines: readonly Prepared[], asRow = false) => {
    for (const l of lines) {
      cur.push(l);
      carried.add(l);
      // A table row's carried givens stay givens for the rows after it, so
      // row three is checked against them as row two was (sixth review).
      if (asRow) {
        for (const c of l.claims) {
          if (!runOrder.includes(c.name)) runOrder.push(c.name);
          claimed.add(c.name);
        }
      }
    }
  };
  /**
   * `p` gives a letter a different value from the one the problem so far gave
   * it AND is followed by its own working — a new example, not a rival
   * answer: "x = 1, 3(1) + 2 = 5, x = 2, 3(2) + 2 = 8"; "a = 4, P = 4a = 16,
   * a = 5, P = …" (an unreadable line counts as working). A BARE re-claim with
   * nothing after it is a rival, held to the problem it follows: "x = 3,
   * x = 4"; "x = 4, 2x + 3 = 2(4) + 3 = 11, So x = 5"; a wrong second root
   * (third and fourth reviews, 2026-09-29).
   */
  const reclaims = (p: Prepared, i: number): boolean => {
    const rival = cur.some((l) =>
      l.claims.some((h) => p.claims.some((c) => h.name === c.name && !equals(h.stated, c.stated))),
    );
    if (!rival) return false;
    const next = prepared[i + 1];
    if (next === undefined || next.practice) return false;
    // An unreadable line is working only if it names the letter ("P = 4a" for
    // a = 5); "Check: 2 × 4 + 3 = 11 ✓" names none (sixth review).
    if (next.parsed === null) {
      return (
        // The letter as a letter in maths — next to a number or an operator
        // ("4a", "a + 3", "(a)") — never the English word "a" in "a side of 5"
        // (seventh review).
        p.claims.some((c) =>
          new RegExp(`[0-9)×*·/+\\-=^(]\\s*${c.name}(?![A-Za-z])|(?<![A-Za-z])${c.name}\\s*[=+\\-×*·/^)0-9]`).test(next.line.text),
        ) ||
        substitutesValue(p.claims, next.line.text)
      );
    }
    if (next.kind === 'work') return p.claims.some((c) => varsOf(next).has(c.name));
    // The strict reading only where the letter has an equation to answer:
    // "x = 3, 3 + 7 = 10, x = 5, 5 + 7 = 12" evaluates at two values and has
    // none, so a value written anywhere in the working shows it (seventh review).
    if (next.kind === 'other') {
      const answerable = p.claims.some((c) => cur.some((l) => l.kind === 'work' && varsOf(l).has(c.name)));
      return answerable ? substitutesValue(p.claims, next.line.text) : showsValue(p.claims, sidesOf(next));
    }
    return false;
  };
  /**
   * A numbers-only line substitutes a value when it shows it in place of a
   * letter: in brackets, "3(2) + 2", or after a times sign, "2 × 4 + 3" — not
   * wherever the digit happens to appear. "2(4) + 3 = 11" does not substitute
   * x = 3 because it contains a "+ 3" (sixth review, 2026-09-29).
   */
  const substitutesValue = (claims: readonly Claim[], text: string): boolean =>
    claims.some((c) => {
      const v = formatRational(c.stated).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      return new RegExp(`\\(\\s*${v}\\s*\\)|[×*·]\\s*${v}(?![0-9.])`).test(text);
    });
  /** Some claimed value is written inside working: a side that is more than a lone number. */
  const showsValue = (claims: readonly Claim[], sides: readonly string[]): boolean => {
    const working = sides.filter((side) => !/^[-+]?[0-9.]+$/.test(side));
    return claims.some((c) => {
      const shown = formatRational(c.stated).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      const at = new RegExp(`(^|[^0-9.])${shown}([^0-9.]|$)`);
      return working.some((side) => at.test(side));
    });
  };
  /** Some of `names` appears in an equation of the problem so far that no claim in it answers. */
  const unanswered = (names: readonly string[]): boolean => {
    const answered = new Set(cur.flatMap((p) => p.claims.map((c) => c.name)));
    const used = new Set(cur.filter((p) => p.kind === 'work').flatMap((p) => [...varsOf(p)]));
    return names.some((n) => used.has(n) && !answered.has(n));
  };
  /** The claims of the run starting at `i`, and the line after it. */
  const runAt = (i: number): { claims: Claim[]; next: Prepared | undefined } => {
    const claims: Claim[] = [];
    const vars = new Set<string>();
    let j = i;
    while (j < prepared.length && prepared[j].kind === 'claim' && !prepared[j].practice) {
      const names = prepared[j].claims.map((c) => c.name);
      if (names.some((n) => vars.has(n))) break;
      names.forEach((n) => vars.add(n));
      claims.push(...prepared[j].claims);
      j++;
    }
    return { claims, next: prepared[j] };
  };
  /**
   * Givens are SUBSTITUTED: the working right after them shows the value —
   * "x = 4" then "2x + 3 = 2(4) + 3". An answer followed by a fresh problem in
   * the same letter ("x = 2" then "3x - 1 = 8") shows no such thing.
   */
  const substituted = (claims: readonly Claim[], next: Prepared): boolean => {
    const used = varsOf(next);
    // Written out means inside working: a side after the first that is more
    // than a lone number. "x - y = 1" does not show x = 1; "2(1) + 3" does
    // (third review, 2026-09-29 — the graphical method's second table).
    return showsValue(
      claims.filter((c) => used.has(c.name)),
      sidesOf(next).slice(1),
    );
  };
  /**
   * A TRY, not an answer (NCERT Class 6-7 trial and error): the working after
   * the claim evaluates the very side of the unanswered equation ("4x + 5 =
   * 17", "x = 1", "4x + 5 = 4(1) + 5 = 9") without reaching the equation's
   * other side, and a DIFFERENT value of the same letter is tried later the
   * same way. Working that reaches the other side ("x + y = 10 + 4 = 14") is
   * an answer being checked, and is held to the equation. A lone letter is
   * never "the same side" (fourth review, 2026-09-29).
   */
  const isTry = (claims: readonly Claim[], next: Prepared): boolean => {
    let first = sidesOf(next)[0];
    // "LHS = 4(1) + 5" stands for the equation's own left side (seventh review).
    const onlyEquation = cur.find((l) => l.kind === 'work');
    if (first === 'lhs' && onlyEquation) first = sidesOf(onlyEquation)[0];
    if (first === undefined || /^[a-z]$/.test(first)) return false;
    const equation = cur.find((l) => l.kind === 'work' && sidesOf(l).includes(first));
    if (!equation) return false;
    const others = sidesOf(equation).filter((side) => side !== first);
    if (sidesOf(next).slice(1).some((side) => others.includes(side))) return false;
    const names = new Set(claims.map((c) => c.name));
    for (let k = prepared.indexOf(next) + 1; k < prepared.length; k++) {
      const again = prepared[k].claims.some(
        (c) => names.has(c.name) && !claims.some((r) => r.name === c.name && equals(r.stated, c.stated)),
      );
      // The later try's working evaluates the same side — written out again,
      // or as "LHS" the way NCERT sets a trial table (sixth review).
      if (again) {
        const after = prepared[k + 1];
        return after !== undefined && (sidesOf(after)[0] === first || sidesOf(after)[0] === 'lhs');
      }
    }
    return false;
  };
  /**
   * A table row: a letter already claimed in this run comes back, and was not
   * claimed on the line just before — "x = 0, y = 3, x = 1" is a row, while
   * "d = 40(3), d = 130" and "y = 10 - 6, y = 5" are a result and its rival,
   * checked against each other (third and fourth reviews, 2026-09-29). The
   * run's givens claimed before the row's first letter are carried into the
   * row with the table's equation: "s = 40, t = 1, d = 40, t = 2, d = 80".
   */
  const newRow = (p: Prepared): boolean => {
    if (claimed.size < 2 || p.parsed?.final) return false;
    // A whole row on one line — "x = 1, y = 5" after "x = 0, y = 3" — is a
    // new row whatever the line before claimed (sixth review).
    if (p.claims.length >= 2 && p.claims.every((c) => claimed.has(c.name))) return true;
    const before = cur[cur.length - 1];
    return p.claims.some((c) => claimed.has(c.name) && !before?.claims.some((h) => h.name === c.name));
  };
  /** The lines a new row starts on: the table's equations, and the givens claimed before its first letter. */
  const rowCarry = (p: Prepared): Prepared[] => {
    const row = p.claims.find((c) => claimed.has(c.name))?.name;
    const upTo = row === undefined ? -1 : runOrder.indexOf(row);
    const givenNames = new Set(runOrder.slice(0, Math.max(0, upTo)));
    return cur.filter(
      (l) => l.kind === 'work' || (l.claims.length > 0 && l.claims.every((c) => givenNames.has(c.name))),
    );
  };
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    if (p.practice) {
      close();
      runs.push({ lines: [p], carried: new Set() });
      continue;
    }
    if (p.kind === 'claim') {
      if (inClaims && newRow(p)) {
        // A new row: the table's equation and the run's earlier givens come with it.
        const carry = rowCarry(p);
        close();
        carryIn(carry, true);
      } else if (!p.parsed?.final && reclaims(p, i)) {
        // A letter given a new value, unlabelled, with nothing between that
        // the checker could read ("a = 4, P = 4a = 16, a = 5": capital P is
        // not read): a new example, not a rival answer. A "Solution:" line
        // that disagrees is still held to the problem it closes.
        close();
      }
      if (!inClaims) {
        const run = runAt(i);
        const next = run.next;
        const uses =
          next !== undefined &&
          next.kind === 'work' &&
          !next.practice &&
          run.claims.some((c) => varsOf(next).has(c.name));
        const trying =
          next !== undefined && !next.practice && cur.length > 0 && unanswered(run.claims.map((c) => c.name)) && isTry(run.claims, next);
        if (trying) {
          // A try written as "LHS = …" is not working the parser reads, but it
          // is a try all the same: the equation stays out of it.
          close();
          givens = true;
        } else if (uses) {
          if (cur.length > 0 && unanswered(run.claims.map((c) => c.name)) && !isTry(run.claims, next)) {
            // The answer to the problem so far; and the next one's given too
            // when that working writes the value out.
            if (substituted(run.claims, next)) passOn = [];
          } else {
            if (cur.length > 0) close();
            givens = true;
          }
        }
      }
      inClaims = true;
      for (const c of p.claims) if (!runOrder.includes(c.name)) runOrder.push(c.name);
      p.claims.forEach((c) => claimed.add(c.name));
      cur.push(p);
      passOn?.push(p);
      continue;
    }
    if (p.kind === 'work' && inClaims) {
      if (givens) {
        // The givens belong to this working: it continues the same problem.
        inClaims = false;
        givens = false;
        claimed = new Set();
        runOrder = [];
      } else {
        const given = passOn;
        close();
        if (given) carryIn(given);
      }
      passOn = null;
    }
    cur.push(p);
  }
  close();

  // Join neighbours that are one problem after all (see the header, step 3).
  // A segment that carries lines in is never joined: it already says where
  // it came from, and joining would hold a line twice.
  const out: Segment[] = [];
  let acc: Segment | null = null;
  for (const seg of runs) {
    if (!acc) {
      acc = seg;
      continue;
    }
    const a: Prepared[] = acc.lines;
    const r: Prepared[] = seg.lines;
    if (seg.carried.size > 0 || isPractice(a) || isPractice(r) || !hasClaims(a) || !hasClaims(r)) {
      out.push(acc);
      acc = seg;
    } else if (agree(a, r)) {
      acc = { lines: [...a, ...r], carried: acc.carried };
    } else {
      const joined: Prepared[] = [...a, ...r];
      if (best(joined).failCount <= best(a).failCount + best(r).failCount) acc = { lines: joined, carried: acc.carried };
      else {
        out.push(acc);
        acc = seg;
      }
    }
  }
  if (acc) out.push(acc);
  return out;
}

// ------------------------------------------------------------------ API --

/**
 * Check a list of board lines. See the header for exactly what is checked,
 * what is skipped, and the one shape that is excused.
 */
export function checkLines(lines: readonly Line[]): CheckResult {
  const prepared = lines.map(prepare);
  const verdict = new Map<Prepared, Judged>();
  const problems: Problem[] = [];
  let solutions: Record<string, Rational> = {};
  let roots: Record<string, Rational[]> = {};

  /**
   * A line in two problems (carried: a table's equation, an answer used as a
   * given) keeps its worst verdict — failed over passed over skipped — but is
   * never failed by the problem it was carried INTO. There the fault is that
   * problem's own: its claims take the reason instead, so a wrong table row is
   * the line marked, not the equation every row shares.
   */
  const rank = (j: Judged) => (j.status === 'failed' ? 2 : j.status === 'passed' ? 1 : 0);
  const settle = (p: Prepared, j: Judged) => {
    const had = verdict.get(p);
    if (!had || rank(j) > rank(had)) verdict.set(p, j);
  };
  for (const { lines: seg, carried } of problemsOf(prepared)) {
    const e = best(seg);
    const blame = seg.flatMap((p, i) => (carried.has(p) && e.judged[i].status === 'failed' ? [e.judged[i]] : []));
    // The problem's own LAST claim takes it: in a table row "x = 1, y = 6" the
    // x is the row's input and the y is what is wrong.
    const own = seg.filter((p) => !carried.has(p) && p.claims.length > 0);
    const blamed = own[own.length - 1];
    seg.forEach((p, i) => {
      const j = e.judged[i];
      if (carried.has(p)) {
        settle(p, j.status === 'failed' ? { ...j, status: 'passed' } : j);
      } else if (blame.length > 0 && p === blamed && j.status !== 'failed') {
        settle(p, { ...blame[0], status: 'failed' });
      } else {
        settle(p, j);
      }
    });
    if (hasClaims(seg)) {
      solutions = {};
      roots = {};
      for (const [name, vals] of Object.entries(e.answer)) {
        if (vals.length === 1) solutions[name] = vals[0];
        else roots[name] = [...vals];
      }
      problems.push({
        ids: seg.filter((_, i) => e.judged[i].status !== 'skipped').map((p) => p.line.id),
        solutions,
        roots,
      });
    }
  }

  const failures: Failure[] = [];
  const skipped: Skipped[] = [];
  const passed: Passed[] = [];
  for (const p of prepared) {
    const j = verdict.get(p)!;
    const { id, text } = p.line;
    if (j.status === 'failed') failures.push({ id, text, reason: j.reason });
    else if (j.status === 'skipped') skipped.push({ id, text, reason: j.reason });
    else passed.push({ id, text });
  }
  return { ok: failures.length === 0, solutions, roots, failures, skipped, passed, problems };
}
