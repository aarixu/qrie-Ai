/**
 * A FUNCTION OF x, READ SAFELY (canvas C3, `plot`).
 *
 * A graph on the board is drawn from a formula the planner wrote — "2x + 1",
 * "x^2 - 4", "sin(x)" — and its points are COMPUTED here, so the line on the
 * board is the line the formula makes. A model-drawn graph's numbers are
 * never checked (canvas audit, 2026-10-01, item 5).
 *
 * Safe by construction: a small recursive-descent reader that knows `x`,
 * numbers, + - * / ^, brackets, implicit multiplication ("2x", "3(x + 1)"),
 * the functions below and the constants pi and e — and nothing else. No
 * `eval`, no `Function`, no property access; anything it does not know is a
 * refusal (null), never a guess.
 */

const FUNCTIONS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Past this, a formula is not a board line. */
const MAX_LENGTH = 80;

type Node = (x: number) => number;

/** `text` as a function of x, or null when it is not a formula this reads. */
export function compileFunction(text: string): ((x: number) => number) | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_LENGTH) return null;
  // "y = 2x + 1" and "f(x) = 2x + 1" are the same line as "2x + 1".
  const src = text
    .replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '')
    .replace(/\s+/g, '')
    .replace(/×|·/g, '*')
    .replace(/−/g, '-')
    .toLowerCase();
  let i = 0;
  const peek = (): string => src[i] ?? '';
  const fail = (): never => {
    throw new Error('unreadable');
  };

  // expression := term (('+'|'-') term)*
  const expression = (): Node => {
    let left = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const right = term();
      const l = left;
      left = op === '+' ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
    }
    return left;
  };
  // term := power (('*'|'/'|implicit) power)*
  const term = (): Node => {
    let left = unary();
    for (;;) {
      const c = peek();
      if (c === '*' || c === '/') {
        i += 1;
        const right = unary();
        const l = left;
        left = c === '*' ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
      } else if (c === '(' || c === 'x' || /[a-z]/.test(c) || /[0-9.]/.test(c)) {
        // Implicit multiplication: "2x", "3(x+1)", "x sin(x)".
        const right = unary();
        const l = left;
        left = (x) => l(x) * right(x);
      } else return left;
    }
  };
  // unary := '-' unary | power
  const unary = (): Node => {
    if (peek() === '-') {
      i += 1;
      const inner = unary();
      return (x) => -inner(x);
    }
    if (peek() === '+') {
      i += 1;
      return unary();
    }
    return power();
  };
  // power := atom ('^' unary)?   — right-associative, so 2^-x reads as 2^(-x)
  const power = (): Node => {
    const base = atom();
    if (peek() === '^') {
      i += 1;
      const exp = unary();
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  };
  const atom = (): Node => {
    const c = peek();
    if (c === '(') {
      i += 1;
      const inner = expression();
      if (peek() !== ')') fail();
      i += 1;
      return inner;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?/.exec(src.slice(i)) ?? /^\d+\.?/.exec(src.slice(i));
      if (!m) fail();
      i += m![0].length;
      const v = Number(m![0]);
      if (!Number.isFinite(v)) fail();
      return () => v;
    }
    if (c === 'x') {
      i += 1;
      return (x) => x;
    }
    const word = /^[a-z]+/.exec(src.slice(i))?.[0];
    if (!word) return fail();
    // The longest known name at this point: "sinx" is sin(x), "pix" is pi·x.
    const fn = Object.keys(FUNCTIONS).sort((a, b) => b.length - a.length).find((f) => word.startsWith(f));
    if (fn) {
      i += fn.length;
      const arg = peek() === '(' ? atom() : power();
      const f = FUNCTIONS[fn];
      return (x) => f(arg(x));
    }
    const k = Object.keys(CONSTANTS).sort((a, b) => b.length - a.length).find((name) => word.startsWith(name));
    if (k) {
      i += k.length;
      const v = CONSTANTS[k];
      return () => v;
    }
    return fail();
  };

  try {
    const node = expression();
    if (i !== src.length) return null;
    return node;
  } catch {
    return null;
  }
}

/**
 * The points of `fn` over [from, to], `samples` of them, with the ones that
 * are not finite (a division by zero, a root of a negative) left out — a gap
 * in the line rather than a spike to infinity.
 */
export function samplePoints(
  fn: (x: number) => number,
  from: number,
  to: number,
  samples = 81,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const n = Math.max(2, Math.min(400, Math.floor(samples)));
  for (let k = 0; k < n; k += 1) {
    const x = from + ((to - from) * k) / (n - 1);
    const y = fn(x);
    if (Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}
