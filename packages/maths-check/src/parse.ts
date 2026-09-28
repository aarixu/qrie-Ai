/**
 * READING A BOARD LINE — the way a Class 6-10 maths teacher writes one.
 *
 * A lesson writes lines like
 *
 *     7x - 15y = 2  ... (Equation 1)
 *     From (2): x = 3 - 2y  ... (Equation 3)
 *     x = 3 - 2(19/29) = (87 - 38)/29 = 49 / 29
 *     Solution: x = 49/29, y = 19/29
 *
 * and this file turns each into STATEMENTS — chains of two or more sides
 * joined by `=` — after stripping the labels around them. Every side is an
 * expression tree over exact fractions and single-letter lowercase variables.
 *
 * THE RULE IT IS BUILT ON: a line read two ways is refused, never guessed.
 * A misread line produces a confident wrong verdict, which is worse than a
 * skipped one. So it refuses, with a reason:
 *
 *   - prose around an equation ("How do we find x now that y = 19/29?");
 *   - `1/2x` and `6/2(1 + 2)` — a product straight after `/` is read as
 *     `1/(2x)` on some boards and `(1/2)x` on others;
 *   - `2 1/2` — a mixed number, or 2 times a half;
 *   - `2^3x` and `x^2y` — a product straight after a power written with `^`
 *     is `(2^3)x` on some boards and `2^(3x)` on others (a superscript,
 *     `x²y`, is read: the raised digits end the power);
 *   - `0.333...` and `1.689…` — a number trailing off in dots is a recurring
 *     or rounded decimal, not the exact value its digits spell; and dots
 *     trailing off anything else, unless a bracketed label follows them
 *     (`... (Equation 1)`, which is stripped);
 *   - a line labelled as a wrong step ("Wrong:", "Incorrect:", "Common
 *     mistake:", "Galat:") — it is on the board to be avoided, not checked;
 *   - `x4`, a capital letter, `π`, `√`, `≠`, `%` and anything else it does
 *     no arithmetic with;
 *   - a comma it cannot place (`x = 1,000`).
 *
 * A line labelled as a practice question ("Try:", "Your turn:", "Practice:")
 * is read, and marked `practice`, so the checker holds it to no worked
 * example's answer (check.ts).
 *
 * Implicit multiplication is read only with no space before the second
 * factor: `2y`, `xy`, `7(3 - 2y)`, `(a + b)(a - b)`, `x²y`. A space breaks
 * it (`2 x` is refused), which is also what keeps a spaced equation label
 * like `x + 2y = 3 (2)` from being read as a multiplication — that label is
 * stripped first, and anything label-shaped that is left fails to parse.
 */

import { valueOf, type Expr } from './expr.ts';
import { parseDecimal, type Rational } from './rational.ts';

/** One side of an `=`, with the text it was read from (for failure reasons). */
export interface Side {
  expr: Expr;
  source: string;
}

/** Two or more sides joined by `=`: `a = b = c` claims a = b AND b = c. */
export interface Statement {
  sides: Side[];
  /**
   * This statement follows from the one before it on the line — they were
   * joined by `⇒`, `=>` or `∴` — so both speak of the same value of each
   * variable. False for the first statement, and after `,`, `;` or "and",
   * which set statements side by side (`x = 2, x = 3` lists two roots).
   */
  implied: boolean;
}

export interface ParsedLine {
  statements: Statement[];
  /** The line was labelled as the final answer ("Solution:", "Answer:", "Ans:"). */
  final: boolean;
  /** The line was labelled as a question for the student ("Try:", "Your turn:", "Practice:"). */
  practice: boolean;
}

export type LineParse = { ok: true; line: ParsedLine } | { ok: false; reason: string };

/** Thrown inside the reader; `parseLine` and `evaluate` turn it into a refusal. */
export class ParseError extends Error {
  constructor(why: string) {
    super(why);
    this.name = 'ParseError';
  }
}

/**
 * Powers larger than this (either sign) are refused, so a runaway power
 * cannot stall prep. A guard, not a measurement of what boards write.
 */
const MAX_POWER = 64;

// ---------------------------------------------------------------- labels --

/** A trailing "... (Equation 1)", "… (i)", "-- (2)" or "— (1)": dots or dashes, then a bracket. */
const TRAIL_DOTTED = /\s*(?:\.{2,}|…|-{2,}|—)\s*\([^()]*\)\s*$/;
/** A trailing "(Equation 1)", "(Eq. 2)", "(eqn 3)". */
const TRAIL_NAMED = /\s*\(\s*(?:equation|eqn|eq)\.?\s*[0-9ivx]+\s*\)\s*$/i;
/**
 * A trailing "(2)" or "(ii)" AFTER A SPACE. Unspaced `2(19)` is a product
 * and is never touched. Roman numerals stop at ix so that "(x)" — which
 * could be the variable — is never stripped.
 */
const TRAIL_NUMBERED = /\s+\((?:\d{1,2}|i{1,3}|iv|vi{0,3}|ix)\)\s*$/i;
const LEAD_CONNECTIVE = /^(?:∴|therefore\b|hence\b|thus\b|so\b)\s*,?\s*/i;
const FINAL_LABEL = /^\s*(?:final\s+)?(?:solution|answer|ans|result)s?\.?\s*$/i;
/** A prefix naming the line as a mistake shown on purpose ("Common mistake:", "Galat:"). */
const WRONG_LABEL = /\b(?:wrong|incorrect|mistakes?|errors?|galat|galti)\b/i;
/** A prefix naming the line as a question for the student ("Try:", "Now you try:", "Your turn:"). */
const PRACTICE_LABEL = /\b(?:try|your\s+turn|practi[cs]e|exercises?|now\s+you|homework)\b/i;
/** Dots trailing off the line with no label after them: `0.333...`, `1.689…`, `2x...`. */
const TRAIL_BARE_DOTS = /(?:\.{2,}|…)\s*$/;

type Stripped = { ok: true; body: string; final: boolean; practice: boolean } | { ok: false; reason: string };

function stripLabels(text: string): Stripped {
  let body = text.replace(/[   ]/g, ' ').trim();
  let final = false;
  let practice = false;

  body = body.replace(LEAD_CONNECTIVE, '');
  // "Solution:", "From (2):", "Step 1:" — a prefix that is words, not maths.
  const colon = body.indexOf(':');
  if (colon > 0) {
    const prefix = body.slice(0, colon);
    if (!prefix.includes('=') && /[a-z]{2,}/i.test(prefix) && prefix.length <= 40) {
      if (WRONG_LABEL.test(prefix)) {
        return { ok: false, reason: `it is labelled as a wrong step ("${prefix.trim()}:"), shown to be avoided` };
      }
      final = FINAL_LABEL.test(prefix);
      practice = PRACTICE_LABEL.test(prefix);
      body = body.slice(colon + 1).trim().replace(LEAD_CONNECTIVE, '');
    }
  }

  // Dots that lead into a label ("... (Equation 1)") go with the label.
  body = body.replace(TRAIL_DOTTED, '').replace(TRAIL_NAMED, '').replace(TRAIL_NUMBERED, '').trim();
  // Dots left over are never stripped: after a number they mark a recurring
  // or rounded decimal, whose digits are not its value.
  if (TRAIL_BARE_DOTS.test(body)) {
    const reason = /\d\s*(?:\.{2,}|…)\s*$/.test(body)
      ? 'a recurring or rounded decimal: a number trailing off in "..." is not the exact value its digits spell'
      : 'it trails off in "...", so it is not a whole statement';
    return { ok: false, reason };
  }
  body = body.replace(/[.;,]\s*$/, '').trim();
  return { ok: true, body, final, practice };
}

/**
 * One line may hold several statements: "x = 49/29, y = 19/29",
 * "2x = 4 ⇒ x = 2", "x = 2 and y = 3". It is split only when EVERY piece
 * has its own `=`; otherwise the separator stays in, and the tokenizer
 * refuses it. A piece after `⇒`, `=>` or `∴` is marked `implied` (see
 * `Statement`).
 */
function splitStatements(body: string): { text: string; implied: boolean }[] {
  const marked = body.replace(/⇒|=>|∴/g, '\u0000');
  const pieces: { text: string; implied: boolean }[] = [];
  let depth = 0;
  let start = 0;
  let implied = false;
  for (let i = 0; i < marked.length; i++) {
    const c = marked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && (c === ',' || c === ';' || c === '\u0000')) {
      pieces.push({ text: marked.slice(start, i), implied });
      start = i + 1;
      implied = c === '\u0000';
    }
  }
  pieces.push({ text: marked.slice(start), implied });
  // "and" sets statements side by side: only the first half keeps the link.
  const split = pieces.flatMap((p) =>
    p.text.split(/\s+and\s+/i).map((text, k) => ({ text, implied: k === 0 && p.implied })),
  );
  if (split.length > 1 && split.every((p) => p.text.includes('='))) {
    return split.map((p) => ({ text: p.text.trim(), implied: p.implied }));
  }
  // Unsplit: the separator is still in the text, and the tokenizer refuses it.
  return [{ text: body, implied: false }];
}

// ------------------------------------------------------------- tokenizer --

type Token =
  | { t: 'num'; value: Rational }
  | { t: 'var'; name: string }
  | { t: 'op'; op: '+' | '-' | '*' | '/' | '^' | '=' }
  | { t: 'open'; close: string }
  | { t: 'close'; ch: string }
  | { t: 'sup'; n: number };

type Positioned = Token & { start: number; end: number; spaced: boolean };

const OPS: Record<string, '+' | '-' | '*' | '/' | '^' | '='> = {
  '+': '+',
  '-': '-',
  '−': '-', // − minus sign
  '–': '-', // – en dash, as an LLM writes a minus
  '*': '*',
  '×': '*', // ×
  '·': '*', // ·
  '⋅': '*', // ⋅
  '∙': '*', // ∙
  '∗': '*', // ∗
  '/': '/',
  '÷': '/', // ÷
  '^': '^',
  '=': '=',
};
const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function tokenize(src: string): Positioned[] {
  const out: Positioned[] = [];
  let spaced = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      spaced = true;
      i++;
      continue;
    }
    const start = i;
    let tok: Token;
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) {
      tok = { t: 'num', value: parseDecimal(num[0])! };
      i += num[0].length;
    } else if (c >= 'a' && c <= 'z') {
      tok = { t: 'var', name: c };
      i++;
    } else if (c in OPS) {
      tok = { t: 'op', op: OPS[c] };
      i++;
    } else if (c in OPEN) {
      tok = { t: 'open', close: OPEN[c] };
      i++;
    } else if (c === ')' || c === ']' || c === '}') {
      tok = { t: 'close', ch: c };
      i++;
    } else if (SUPERSCRIPT.includes(c) || c === '⁻') {
      let j = i;
      let text = '';
      while (j < src.length && (SUPERSCRIPT.includes(src[j]) || src[j] === '⁻')) {
        text += src[j] === '⁻' ? '-' : String(SUPERSCRIPT.indexOf(src[j]));
        j++;
      }
      if (!/^-?\d+$/.test(text)) throw new ParseError(`"${src.slice(i, j)}" is not a power`);
      tok = { t: 'sup', n: Number(text) };
      i = j;
    } else if (c >= 'A' && c <= 'Z') {
      throw new ParseError(`capital "${c}" — only single lowercase letters are read as variables`);
    } else {
      throw new ParseError(`"${c}" is not something this checker does arithmetic with`);
    }
    out.push({ ...tok, start, end: i, spaced } as Positioned);
    spaced = false;
  }
  return out;
}

// ---------------------------------------------------------------- parser --

/**
 * Recursive descent, loosest binding first: sum, product (explicit and
 * implicit), unary minus, power, primary. Plain fields rather than
 * constructor parameter properties, so Node can run this file with its
 * type-stripping alone.
 */
class Parser {
  private i = 0;
  private readonly toks: Positioned[];
  private readonly src: string;

  constructor(toks: Positioned[], src: string) {
    this.toks = toks;
    this.src = src;
  }

  private peek(): Positioned | undefined {
    return this.toks[this.i];
  }

  private isOp(op: string): boolean {
    const t = this.peek();
    return t !== undefined && t.t === 'op' && t.op === op;
  }

  atEnd(): boolean {
    return this.i >= this.toks.length;
  }

  /** `side (= side)+`, to the end of the input. */
  chain(): Side[] {
    const sides = [this.side()];
    while (this.isOp('=')) {
      this.i++;
      sides.push(this.side());
    }
    if (!this.atEnd()) throw this.unexpected();
    if (sides.length < 2) throw new ParseError('no "=" in it');
    return sides;
  }

  /** One whole expression, to the end of the input. */
  whole(): Expr {
    const e = this.sum();
    if (!this.atEnd()) throw this.unexpected();
    return e;
  }

  private side(): Side {
    const from = this.peek()?.start ?? this.src.length;
    const expr = this.sum();
    const to = this.toks[this.i - 1]?.end ?? from;
    return { expr, source: this.src.slice(from, to).trim() };
  }

  private unexpected(): ParseError {
    const t = this.peek();
    if (!t) return new ParseError('it ends in the middle of an expression');
    if (t.t === 'op' && t.op === '=') return new ParseError('an "=" with no expression on one side of it');
    if (t.t === 'num' || t.t === 'var' || t.t === 'open') {
      const what = this.src.slice(t.start, t.end);
      return new ParseError(`"${what}" follows the term before it with no sign between them, which is read two ways`);
    }
    return new ParseError(`"${this.src.slice(t.start, t.end)}" is out of place`);
  }

  private sum(): Expr {
    let left = this.product();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.toks[this.i++] as { op: '+' | '-' }).op;
      const right = this.product();
      left = { k: op === '+' ? 'add' : 'sub', a: left, b: right };
    }
    return left;
  }

  /** Can the next token multiply what came before it with no sign? See the file header. */
  private implicitNext(): boolean {
    const next = this.peek();
    const prev = this.toks[this.i - 1];
    if (!next || !prev || next.spaced) return false;
    if (next.t !== 'var' && next.t !== 'open') return false;
    return prev.t === 'num' || prev.t === 'var' || prev.t === 'close' || prev.t === 'sup';
  }

  private product(): Expr {
    let left = this.unary();
    let afterDivide = false;
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = (this.toks[this.i++] as { op: '*' | '/' }).op;
        const right = this.unary();
        left = { k: op === '*' ? 'mul' : 'div', a: left, b: right };
        afterDivide = op === '/';
      } else if (this.implicitNext()) {
        if (afterDivide) {
          throw new ParseError('a product straight after "/" (like 1/2x) is read two ways');
        }
        left = { k: 'mul', a: left, b: this.power() };
      } else {
        return left;
      }
    }
  }

  private unary(): Expr {
    if (this.isOp('-')) {
      this.i++;
      return { k: 'neg', a: this.unary() };
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.primary();
    const next = this.peek();
    let out = base;
    if (next && next.t === 'sup' && !next.spaced) {
      this.i++;
      out = { k: 'pow', a: base, n: this.checkPower(next.n) };
    } else if (this.isOp('^')) {
      this.i++;
      out = { k: 'pow', a: base, n: this.checkPower(this.exponent()) };
      // 2^3x: (2^3)x or 2^(3x)? See the file header.
      const factor = this.peek();
      if (factor && !factor.spaced && (factor.t === 'var' || factor.t === 'open')) {
        throw new ParseError('a product straight after a power written with "^" (like 2^3x) is read two ways');
      }
    } else {
      return out;
    }
    const after = this.peek();
    if (after && ((after.t === 'op' && after.op === '^') || after.t === 'sup')) {
      throw new ParseError('a power of a power is read two ways');
    }
    return out;
  }

  private checkPower(n: number): number {
    if (Math.abs(n) > MAX_POWER) throw new ParseError(`a power of ${n} is past what this checker expands`);
    return n;
  }

  /** The power after `^`: a signed whole number, or a bracket that works out to one. */
  private exponent(): number {
    let sign = 1;
    while (this.isOp('-') || this.isOp('+')) {
      if ((this.toks[this.i] as { op: string }).op === '-') sign = -sign;
      this.i++;
    }
    const value = valueOf(this.primary());
    if (value === null || value.d !== 1n) throw new ParseError('a power that is not a whole number');
    return sign * Number(value.n);
  }

  private primary(): Expr {
    const t = this.peek();
    if (!t) throw new ParseError('it ends in the middle of an expression');
    if (t.t === 'num') {
      this.i++;
      return { k: 'num', value: t.value };
    }
    if (t.t === 'var') {
      this.i++;
      return { k: 'var', name: t.name };
    }
    if (t.t === 'open') {
      this.i++;
      const inner = this.sum();
      const close = this.peek();
      if (close && close.t === 'op' && close.op === '=') throw new ParseError('an "=" inside brackets');
      if (!close || close.t !== 'close' || close.ch !== t.close) {
        throw new ParseError('brackets that do not pair up');
      }
      this.i++;
      return inner;
    }
    throw this.unexpected();
  }
}

// ------------------------------------------------------------------- API --

/**
 * Read one board line into statements, or refuse it with a reason.
 *
 * A refusal is not a failure: the checker SKIPS a line it cannot read.
 */
export function parseLine(text: string): LineParse {
  const stripped = stripLabels(text);
  if (!stripped.ok) return stripped;
  const { body, final, practice } = stripped;
  if (!body.includes('=')) return { ok: false, reason: 'no "=" in it' };
  if (/[a-z]{4,}/i.test(body)) return { ok: false, reason: 'it reads as a sentence, not an equation' };
  try {
    const statements = splitStatements(body).map((piece) => {
      const p = new Parser(tokenize(piece.text), piece.text);
      return { sides: p.chain(), implied: piece.implied };
    });
    return { ok: true, line: { statements, final, practice } };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, reason: e.message };
    throw e;
  }
}

/** Read one expression (no `=`). Throws `ParseError` when it cannot. */
export function parseExpression(text: string): Expr {
  const src = text.trim();
  return new Parser(tokenize(src), src).whole();
}
