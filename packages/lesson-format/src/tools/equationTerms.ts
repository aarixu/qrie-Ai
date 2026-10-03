/**
 * WHICH TERM OF ONE LINE OF WORKING BECAME WHICH TERM OF THE NEXT.
 *
 * By text, and deliberately simple: a line it cannot read is null, and a term
 * it cannot place is simply not moved, so the renderer writes it in place the
 * way `derive` does. A miss costs motion, never correctness — the gate's
 * maths check (class-prep toolChecks) is what holds every step true.
 */

export interface Term {
  side: 0 | 1;
  sign: 1 | -1;
  /** The term without its sign, spaces removed: "2x", "3(x+1)", "8/2". */
  body: string;
}

export type MoveKind = 'same' | 'crossed' | 'divided' | 'merged';

/** Term `to` of the next line came from term `from` of the line above. */
export interface TermMove {
  to: number;
  from: number;
  kind: MoveKind;
}

const tidy = (line: string): string => line.replace(/\s+/g, '').replace(/[−–]/g, '-');

/** A sign is a term break unless it follows something that makes it a factor's sign. */
const FACTOR_BEFORE = new Set(['*', '/', '^', '(']);

function sideTerms(text: string, side: 0 | 1): Term[] | null {
  const terms: Term[] = [];
  let depth = 0;
  let sign: 1 | -1 = 1;
  let start = 0;
  if (text[0] === '+' || text[0] === '-') {
    sign = text[0] === '-' ? -1 : 1;
    start = 1;
  }
  for (let i = start; i <= text.length; i += 1) {
    const c = text[i];
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (depth < 0) return null;
    const breaks = i === text.length || (depth === 0 && (c === '+' || c === '-') && i > start && !FACTOR_BEFORE.has(text[i - 1]));
    if (!breaks) continue;
    const body = text.slice(start, i);
    if (body === '') return null;
    terms.push({ side, sign, body });
    if (i < text.length) {
      sign = c === '-' ? -1 : 1;
      start = i + 1;
    }
  }
  return depth === 0 ? terms : null;
}

/** Every term of a one-equation line, or null when the line is not one equation it can read. */
export function termsOf(line: string): Term[] | null {
  const sides = tidy(line).split('=');
  if (sides.length !== 2 || sides.some((s) => s === '')) return null;
  const left = sideTerms(sides[0], 0);
  const right = sideTerms(sides[1], 1);
  return left && right ? [...left, ...right] : null;
}

const NUMBER = /^\d+(?:\.\d+)?$/;
const VAR_TERM = /^(\d*)([a-z])$/;

/** "3x" -> { coef: 3, v: "x" }, "x" -> { coef: 1, v: "x" }; null for anything else. */
function asVarTerm(body: string): { coef: number; v: string } | null {
  const m = body.match(VAR_TERM);
  return m ? { coef: m[1] === '' ? 1 : Number(m[1]), v: m[2] } : null;
}

export function matchTerms(prev: string, next: string): TermMove[] | null {
  const a = termsOf(prev);
  const b = termsOf(next);
  if (!a || !b) return null;
  const used = new Set<number>();
  const moves: TermMove[] = [];
  const free = (k: number) => !used.has(k);

  b.forEach((t, to) => {
    const take = (from: number, kind: MoveKind) => {
      used.add(from);
      moves.push({ to, from, kind });
    };
    // 1. The same term, same side, same sign.
    let from = a.findIndex((s, k) => free(k) && s.side === t.side && s.sign === t.sign && s.body === t.body);
    if (from >= 0) return take(from, 'same');
    // 2. Across "=", its sign flipped.
    from = a.findIndex((s, k) => free(k) && s.side !== t.side && s.sign === -t.sign && s.body === t.body);
    if (from >= 0) return take(from, 'crossed');
    // 3. Divided: "8" became "8/2" on the same side.
    const over = t.body.match(/^(.+)\/\d+(?:\.\d+)?$/);
    if (over) {
      from = a.findIndex((s, k) => free(k) && s.side === t.side && s.sign === t.sign && s.body === over[1]);
      if (from >= 0) return take(from, 'divided');
    }
    // 4. Worked out: numbers, or like terms, on one side summed into this one.
    const own = t.sign * (NUMBER.test(t.body) ? Number(t.body) : (asVarTerm(t.body)?.coef ?? NaN));
    const kin = a
      .map((s, k) => ({ s, k }))
      .filter(({ s, k }) => {
        if (!free(k) || s.side !== t.side) return false;
        if (NUMBER.test(t.body)) return NUMBER.test(s.body);
        const mine = asVarTerm(t.body);
        const theirs = asVarTerm(s.body);
        return mine !== null && theirs !== null && mine.v === theirs.v;
      });
    if (kin.length >= 2) {
      const sum = kin.reduce((acc, { s }) => acc + s.sign * (NUMBER.test(s.body) ? Number(s.body) : asVarTerm(s.body)!.coef), 0);
      if (Math.abs(sum - own) < 1e-9) {
        kin.forEach(({ k }) => take(k, 'merged'));
        return;
      }
    }
    // 5. The variable left behind when its coefficient went: "2x" became "x".
    const v = asVarTerm(t.body);
    if (v && v.coef === 1) {
      from = a.findIndex((s, k) => free(k) && s.side === t.side && asVarTerm(s.body)?.v === v.v);
      if (from >= 0) return take(from, 'same');
    }
  });
  return moves;
}
