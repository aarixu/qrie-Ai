import { describe, expect, it } from 'vitest';
import { evaluate, formatRational, parseLine, rational, type Rational } from '../src/index.ts';

/**
 * THE READER, ON ITS OWN.
 *
 * Everything the checker decides rests on reading a board line the way a
 * Class 6-10 teacher means it. These tests pin the readings that matter —
 * implicit multiplication, unary minus, brackets, exact fractions — and,
 * just as much, the lines it must REFUSE to read, because a misread line is
 * worse than a skipped one: it produces a confident wrong verdict.
 */

const r = (n: number, d = 1): Rational => rational(n, d);
const show = (x: Rational | null) => (x === null ? null : formatRational(x));

describe('evaluate — exact arithmetic', () => {
  it('reads the substitution back-step exactly', () => {
    expect(show(evaluate('3 - 2(19/29)'))).toBe('49/29');
    expect(show(evaluate('(87 - 38)/29'))).toBe('49/29');
    expect(show(evaluate('49 / 29'))).toBe('49/29');
    expect(show(evaluate('2 - 21'))).toBe('-19');
  });

  it('never goes through a float: 0.1 + 0.2 is exactly 3/10', () => {
    expect(show(evaluate('0.1 + 0.2'))).toBe('3/10');
    expect(evaluate('0.1 + 0.2')).toEqual(r(3, 10));
  });

  it('substitutes given values, with implicit multiplication and unary minus', () => {
    const y = r(19, 29);
    expect(show(evaluate('-29y', { y }))).toBe('-19');
    expect(show(evaluate('7(3 - 2y) - 15y', { y }))).toBe('2');
    expect(show(evaluate('21 - 14y - 15y', { y }))).toBe('2');
    expect(show(evaluate('2xy', { x: r(3), y: r(5) }))).toBe('30');
    expect(show(evaluate('(x + 1)(x - 1)', { x: r(4) }))).toBe('15');
  });

  it('gives no number for a free variable, a zero divisor, or no expression at all', () => {
    expect(evaluate('2x')).toBeNull();
    expect(evaluate('1/0')).toBeNull();
    expect(evaluate('1/(x - 2)', { x: r(2) })).toBeNull();
    expect(evaluate('')).toBeNull();
    expect(evaluate('how many')).toBeNull();
  });

  it('reads powers: caret, superscripts, and minus binding looser than a power', () => {
    expect(show(evaluate('2^10'))).toBe('1024');
    expect(show(evaluate('x²', { x: r(3) }))).toBe('9');
    expect(show(evaluate('x²y', { x: r(3), y: r(2) }))).toBe('18');
    expect(show(evaluate('(a + b)^2', { a: r(1), b: r(2) }))).toBe('9');
    expect(show(evaluate('-2^2'))).toBe('-4');
    expect(show(evaluate('2^-1'))).toBe('1/2');
    expect(show(evaluate('10⁻²'))).toBe('1/100');
    expect(show(evaluate('2^(1 + 2)'))).toBe('8');
    // A power that is not a whole number is refused, not approximated.
    expect(evaluate('4^(1/2)')).toBeNull();
    expect(evaluate('2^x', { x: r(3) })).toBeNull();
  });

  it('reads the typographic symbols an LLM writes', () => {
    expect(show(evaluate('−3 × 4 ÷ 2'))).toBe('-6');
    expect(show(evaluate('2 · 3 – 1'))).toBe('5');
    expect(show(evaluate('[2 + 3] × {4 - 1}'))).toBe('15');
  });

  it('refuses readings a teacher could mean two ways', () => {
    // 1/(2x) or (1/2)x? Board convention differs, so it is not guessed.
    expect(evaluate('1/2x', { x: r(4) })).toBeNull();
    expect(evaluate('6/2(1 + 2)')).toBeNull();
    // A mixed number "two and a half", or 2 times 1/2? Not guessed.
    expect(evaluate('2 1/2')).toBeNull();
    // x times 4, or a subscript? Not guessed.
    expect(evaluate('x4', { x: r(1) })).toBeNull();
    // A space breaks implicit multiplication.
    expect(evaluate('2 x', { x: r(1) })).toBeNull();
    // A power of a power.
    expect(evaluate('2^3^2')).toBeNull();
    // (2^3)x or 2^(3x)? A product straight after a caret power is not guessed...
    expect(evaluate('2^3x', { x: r(1) })).toBeNull();
    expect(parseLine('2^3x = 8').ok).toBe(false);
    expect(evaluate('x^2y', { x: r(3), y: r(2) })).toBeNull();
    expect(evaluate('2^2(x + 1)', { x: r(1) })).toBeNull();
    // ...while a superscript, a spaced sign or a written sign leaves no doubt.
    expect(show(evaluate('x²y', { x: r(3), y: r(2) }))).toBe('18');
    expect(show(evaluate('2^3 × x', { x: r(2) }))).toBe('16');
    // Brackets that do not pair up.
    expect(evaluate('(2 + 3')).toBeNull();
    expect(evaluate('(2 + 3]')).toBeNull();
  });
});

describe('parseLine — labels and statements', () => {
  it('strips a trailing "... (Equation 1)" label', () => {
    const p = parseLine('7x - 15y = 2  ... (Equation 1)');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.line.statements).toHaveLength(1);
    expect(p.line.statements[0].sides.map((s) => s.source)).toEqual(['7x - 15y', '2']);
  });

  it('strips a leading "From (2):" and a trailing label together', () => {
    const p = parseLine('From (2): x = 3 - 2y  ... (Equation 3)');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.line.statements[0].sides.map((s) => s.source)).toEqual(['x', '3 - 2y']);
  });

  it('strips a bare "(Eq. 2)" and a spaced "(2)" label, but never a real bracket', () => {
    const a = parseLine('x + 2y = 3 (Eq. 2)');
    const b = parseLine('x + 2y = 3   (2)');
    const c = parseLine('x = 3 - 2(19)');
    for (const p of [a, b]) {
      expect(p.ok).toBe(true);
      if (p.ok) expect(p.line.statements[0].sides[1].source).toBe('3');
    }
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.line.statements[0].sides[1].source).toBe('3 - 2(19)');
  });

  it('keeps every side of a chained equality', () => {
    const p = parseLine('x = 3 - 2(19/29) = (87 - 38)/29 = 49 / 29');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.line.statements[0].sides).toHaveLength(4);
  });

  it('splits a "Solution:" line into one statement per variable and marks it final', () => {
    const p = parseLine('Solution: x = 49/29, y = 19/29');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.line.final).toBe(true);
    expect(p.line.statements.map((s) => s.sides.map((x) => x.source))).toEqual([
      ['x', '49/29'],
      ['y', '19/29'],
    ]);
  });

  it('splits on "⇒", "=>" and "and"', () => {
    for (const text of ['2x = 4 ⇒ x = 2', '2x = 4 => x = 2', '2x = 4 and x = 2']) {
      const p = parseLine(text);
      expect(p.ok, text).toBe(true);
      if (p.ok) expect(p.line.statements).toHaveLength(2);
    }
  });

  it('refuses prose that merely contains an equation', () => {
    expect(parseLine('How can we use y = x + 30 to solve for x?').ok).toBe(false);
    expect(parseLine('How do we find the value of x now that we know y = 19/29?').ok).toBe(false);
    expect(parseLine('we know y = 19/29').ok).toBe(false);
  });

  it('refuses the second half of an equation wrapped across two lines', () => {
    const p = parseLine('= 49 / 29');
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/nothing|no expression/);
    expect(parseLine('(x = 2)').ok).toBe(false);
  });

  it('refuses a line with no equals sign, and a comma it cannot place', () => {
    expect(parseLine('21 - 29y').ok).toBe(false);
    // "1,000" is a thousand or two values — not guessed.
    expect(parseLine('x = 1,000').ok).toBe(false);
    expect(parseLine('x = 1, 2').ok).toBe(false);
  });

  it('refuses a number trailing off in "..." — a recurring or rounded decimal is not exact', () => {
    // 0.333... is 1/3, not 333/1000: stripping the dots would misread it.
    for (const text of ['1/3 = 0.333...', '2/3 = 0.666…', 'x = 49/29 = 1.689...']) {
      const p = parseLine(text);
      expect(p.ok, text).toBe(false);
      if (!p.ok) expect(p.reason, text).toMatch(/recurring or rounded decimal/);
    }
    // Dots after anything else are not guessed away either...
    expect(parseLine('y = 2x...').ok).toBe(false);
    // ...but dots that lead into an equation label still are.
    expect(parseLine('x = 0.5 ... (Equation 4)').ok).toBe(true);
  });

  it('refuses a line labelled as a wrong step: it is on the board to be avoided', () => {
    for (const text of [
      'Incorrect: 2x = 14',
      'Wrong: 2 - 21 = -23',
      'Common mistake: 7(3 - 2y) = 21 - 2y',
      'Galat: x = 5',
    ]) {
      const p = parseLine(text);
      expect(p.ok, text).toBe(false);
      if (!p.ok) expect(p.reason, text).toMatch(/wrong step/);
    }
  });

  it('marks a line labelled as a practice question', () => {
    for (const text of ['Try: 5x = 20', 'Your turn: 3x - 1 = 8', 'Practice: 2y = 6', 'Now you try: x + 4 = 9']) {
      const p = parseLine(text);
      expect(p.ok, text).toBe(true);
      if (p.ok) expect(p.line.practice, text).toBe(true);
    }
    for (const text of ['2x = 4', 'Solution: x = 2', 'From (2): x = 3 - 2y']) {
      const p = parseLine(text);
      expect(p.ok, text).toBe(true);
      if (p.ok) expect(p.line.practice, text).toBe(false);
    }
  });

  it('records which statements follow from the one before by "⇒", and which stand side by side', () => {
    const implied = (text: string) => {
      const p = parseLine(text);
      return p.ok ? p.line.statements.map((s) => s.implied) : null;
    };
    expect(implied('x - 2 = 0 ⇒ x = 2')).toEqual([false, true]);
    expect(implied('2x = 4 => x = 2 and y = 3')).toEqual([false, true, false]);
    expect(implied('x = 2, x = 3')).toEqual([false, false]);
    expect(implied('x = 2 and x = 3')).toEqual([false, false]);
    expect(implied('2x = 4')).toEqual([false]);
  });

  it('refuses symbols it does not do arithmetic with', () => {
    expect(parseLine('A = πr²').ok).toBe(false);
    expect(parseLine('x ≠ 2').ok).toBe(false);
    expect(parseLine('√16 = 4').ok).toBe(false);
    expect(parseLine('ratio 2 : 3 = 4 : 6').ok).toBe(false);
  });
});
