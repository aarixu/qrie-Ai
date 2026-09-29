import { describe, expect, it } from 'vitest';
import { checkLines, formatRational, type CheckResult, type Line } from '../src/index.ts';

/**
 * THE CHECK OVER A LIST OF BOARD LINES.
 *
 * `checkLines` finds the answer the board claims and holds every other line
 * to it. These tests are the behaviours a lesson author would trip over: a
 * chained step that is wrong in the middle, an answer that disagrees with the
 * working, two worked examples with different answers, an identity that needs
 * no answer at all — and the lines it must SKIP rather than fail.
 */

const lines = (...texts: string[]): Line[] => texts.map((text, i) => ({ id: `l${i + 1}`, text }));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const answers = (res: CheckResult) =>
  Object.fromEntries(Object.entries(res.solutions).map(([k, v]) => [k, formatRational(v)]));

describe('checkLines', () => {
  it('passes a correct derivation and reports the answer it found', () => {
    const res = checkLines(lines('2x + 3 = 11', '2x = 11 - 3 = 8', 'x = 8/2 = 4'));
    expect(res.ok).toBe(true);
    expect(res.failures).toEqual([]);
    expect(ids(res.passed)).toEqual(['l1', 'l2', 'l3']);
    expect(answers(res)).toEqual({ x: '4' });
  });

  it('fails a wrong numeric step inside a chain, naming its line', () => {
    const res = checkLines(lines('2x + 3 = 11', '2x = 11 - 3 = 8', 'x = 8/2 = 5'));
    expect(res.ok).toBe(false);
    expect(ids(res.failures)).toEqual(['l3']);
    expect(res.failures[0].reason).toContain('8/2');
  });

  it('holds the statement to the answer: a transposition slip fails the first line', () => {
    // 2x + 3 = 11 moved the 3 across without changing its sign.
    const res = checkLines(lines('2x + 3 = 11', '2x = 11 + 3 = 14', 'x = 7'));
    expect(res.ok).toBe(false);
    expect(ids(res.failures)).toEqual(['l1']);
    expect(res.failures[0].reason).toMatch(/x = 7/);
  });

  it('when two answers disagree, keeps the one the working supports and fails the other', () => {
    const res = checkLines(lines('2x + 3 = 11', '2x = 8', 'x = 5', 'Answer: x = 4'));
    expect(ids(res.failures)).toEqual(['l3']);
    expect(answers(res)).toEqual({ x: '4' });
  });

  it('a wrong labelled answer loses to the answer the working agrees with', () => {
    // The label only breaks ties; it does not outvote the working.
    const res = checkLines(lines('x + 2y = 3', 'y = 1', 'x = 1', 'Answer: x = 1, y = 2'));
    expect(ids(res.failures)).toEqual(['l4']);
    expect(answers(res)).toEqual({ x: '1', y: '1' });
  });

  it('breaks a tie between answers in favour of the one labelled as the answer', () => {
    expect(ids(checkLines(lines('Answer: x = 3', 'x = 4')).failures)).toEqual(['l2']);
    // With no label, the last one written is kept.
    expect(ids(checkLines(lines('x = 3', 'x = 4')).failures)).toEqual(['l1']);
  });

  it('keeps a wrong middle answer inside its problem even when working follows it', () => {
    // "x = 3 - 2y" after the wrong y would otherwise start a new problem.
    const res = checkLines(
      lines('7x - 15y = 2', 'x + 2y = 3', '21 - 29y = 2', 'y = 19/28', 'x = 3 - 2y', 'x = 49/29', 'Solution: x = 49/29, y = 19/29'),
    );
    expect(ids(res.failures)).toEqual(['l4']);
    expect(res.failures[0].reason).toBe(
      'this line gives y = 19/28, but the answer kept for this problem is y = 19/29',
    );
  });

  it('checks the working inside an answer line as well as the answer', () => {
    const ok = checkLines(lines('x + 2y = 3', 'y = 1/2', 'x = 3 - 2y = 3 - 2(1/2) = 2'));
    expect(ok.ok).toBe(true);
    expect(ids(ok.passed)).toEqual(['l1', 'l2', 'l3']);
    const bad = checkLines(lines('x + 2y = 3', 'y = 1/2', 'x = 3 - 2y = 3 - 2(1/2) = 1'));
    expect(ids(bad.failures)).toEqual(['l3']);
  });

  it('checks two worked examples each against its own answer', () => {
    const res = checkLines(
      lines('2x + 3 = 7', '2x = 4', 'x = 2', '3x - 1 = 8', '3x = 9', 'x = 3'),
    );
    expect(res.ok).toBe(true);
    expect(ids(res.passed)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
    expect(res.problems.map((p) => ({ ids: p.ids, x: formatRational(p.solutions.x) }))).toEqual([
      { ids: ['l1', 'l2', 'l3'], x: '2' },
      { ids: ['l4', 'l5', 'l6'], x: '3' },
    ]);
    // The top-level answers are the last problem's.
    expect(answers(res)).toEqual({ x: '3' });
  });

  it('still fails a slip in the second of two examples', () => {
    const res = checkLines(
      lines('2x + 3 = 7', '2x = 4', 'x = 2', '3x - 1 = 8', '3x = 7', 'x = 3'),
    );
    expect(ids(res.failures)).toEqual(['l5']);
  });

  it('passes an identity with no answer at all, and fails a false one only when values exist', () => {
    const res = checkLines(lines('(a + b)^2 = a^2 + 2ab + b^2', '7(3 - 2y) - 15y = 21 - 14y - 15y'));
    expect(res.ok).toBe(true);
    expect(ids(res.passed)).toEqual(['l1', 'l2']);

    // A wrong expansion is not an identity. With no value for y it cannot be
    // told apart from an equation to solve, so it is skipped...
    const open = checkLines(lines('7(3 - 2y) = 21 - 2y'));
    expect(open.failures).toEqual([]);
    expect(ids(open.skipped)).toEqual(['l1']);
    // ...and with the board's answer for y it fails.
    const held = checkLines(lines('7(3 - 2y) = 21 - 2y', 'y = 1'));
    expect(ids(held.failures)).toEqual(['l1']);
  });

  it('skips — never fails — prose, unknown symbols and unanswered variables', () => {
    const res = checkLines(
      lines('How can we use y = x + 30 to solve for x?', 'A = πr²', 'p + q = 10', '3 + 4 = 7'),
    );
    expect(res.ok).toBe(true);
    expect(ids(res.skipped)).toEqual(['l1', 'l2', 'l3']);
    expect(ids(res.passed)).toEqual(['l4']);
    for (const s of res.skipped) expect(s.reason.length).toBeGreaterThan(0);
  });

  it('fails a line that divides by zero at the answer', () => {
    const res = checkLines(lines('1/(x - 2) = 1', 'x = 2'));
    expect(ids(res.failures)).toEqual(['l1']);
    expect(res.failures[0].reason).toMatch(/zero/);
  });

  it('fails plain wrong arithmetic even with no variables anywhere', () => {
    const res = checkLines(lines('12 × 3 = 36', '48 ÷ 6 = 9'));
    expect(ids(res.passed)).toEqual(['l1']);
    expect(ids(res.failures)).toEqual(['l2']);
  });

  it('does not check lines after the last answer against it: a practice problem is skipped', () => {
    const res = checkLines(lines('2x = 8', 'x = 4', 'Try: 5x + 1 = 11'));
    expect(res.ok).toBe(true);
    expect(ids(res.skipped)).toEqual(['l3']);
  });

  it('holds a practice question between two worked examples to neither answer', () => {
    // With no line of working between them, "Try:" would otherwise open the
    // second example's problem and be held to x = 3 (15, not 20).
    const texts = ['2x = 4', 'x = 2', 'Try: 5x = 20', '3x = 9', 'x = 3'];
    const flat = checkLines(lines(...texts));
    const paged = checkLines(
      texts.map((text, i) => ({ id: `l${i + 1}`, text, section: i < 2 ? 'example-1' : 'example-2' })),
    );
    for (const res of [flat, paged]) {
      expect(res.failures).toEqual([]);
      expect(ids(res.skipped)).toEqual(['l3']);
      expect(res.skipped[0].reason).toMatch(/practice/);
      expect(res.problems.map((p) => formatRational(p.solutions.x))).toEqual(['2', '3']);
    }
    // A practice question is still arithmetic: a wrong sum in it fails.
    expect(ids(checkLines(lines('x = 2', 'Try: 3 + 4 = 8')).failures)).toEqual(['l2']);
  });

  it('skips — never fails — a line the board labels as a wrong step', () => {
    const res = checkLines(lines('2x + 3 = 11', 'Incorrect: 2x = 14', '2x = 8', 'x = 4'));
    expect(res.ok).toBe(true);
    expect(ids(res.skipped)).toEqual(['l2']);
    expect(res.skipped[0].reason).toMatch(/wrong step/);
    const mistake = checkLines(lines('Common mistake: 2 - 21 = -23', '2 - 21 = -19'));
    expect(mistake.ok).toBe(true);
    expect(ids(mistake.skipped)).toEqual(['l1']);
  });

  it('skips a recurring or rounded decimal rather than reading it as an exact number', () => {
    const res = checkLines(lines('1/3 = 0.333...', '2/3 = 0.666…', '29x = 49', 'x = 49/29 = 1.689...'));
    expect(res.failures).toEqual([]);
    expect(ids(res.skipped)).toEqual(['l1', 'l2', 'l3', 'l4']);
    // It never adopts the rounded value as the answer.
    expect(answers(res)).toEqual({});
  });

  it('without pages, an unsolved puzzle before the worked problem FAILS', () => {
    // checkLines has no page structure to tell a separate problem apart, so a
    // system that does not hold under the answer is a failure. checkLesson
    // passes page (title) boundaries; see lesson.test.ts.
    const res = checkLines(lines('x + y = 50', 'y = x + 30', 'x + 2y = 3', 'x - y = 0', 'x = 1', 'y = 1'));
    expect(ids(res.failures)).toEqual(['l1', 'l2']);
  });

  it('with pages, an unsolved system on its own earlier page is a separate problem, skipped', () => {
    const input: Line[] = [
      { id: 'p1', text: 'x + y = 50', section: 'hook' },
      { id: 'p2', text: 'y = x + 30', section: 'hook' },
      { id: 'w1', text: 'x + 2y = 3', section: 'work' },
      { id: 'w2', text: 'x - y = 0', section: 'work' },
      { id: 'w3', text: 'x = 1', section: 'work' },
      { id: 'w4', text: 'y = 1', section: 'work' },
    ];
    const res = checkLines(input);
    expect(res.ok).toBe(true);
    expect(ids(res.skipped)).toEqual(['p1', 'p2']);
    expect(res.skipped[0].reason).toMatch(/separate problem/);
    expect(ids(res.passed)).toEqual(['w1', 'w2', 'w3', 'w4']);
  });

  it('never excuses a numeric slip on the puzzle page', () => {
    const input: Line[] = [
      { id: 'p1', text: 'x + y = 50', section: 'hook' },
      { id: 'p2', text: 'y = x + 30', section: 'hook' },
      { id: 'p3', text: '50 - 30 = 25', section: 'hook' },
      { id: 'w1', text: 'x + 2y = 3', section: 'work' },
      { id: 'w2', text: 'x - y = 0', section: 'work' },
      { id: 'w3', text: 'x = 1', section: 'work' },
      { id: 'w4', text: 'y = 1', section: 'work' },
    ];
    const res = checkLines(input);
    expect(ids(res.failures)).toEqual(['p3']);
    expect(ids(res.skipped)).toEqual(['p1', 'p2']);
  });

  it('never excuses the statement of a one-variable problem: a slip in its first step still fails', () => {
    // "3x + 5 = 20" alone on its page, then 3x = 20 + 5: the 5 moved across
    // without changing sign. The wrong answer must not pass.
    const oneLine: Line[] = [
      { id: 'p1', text: '3x + 5 = 20', section: 'statement' },
      { id: 'w1', text: '3x = 20 + 5 = 25', section: 'work' },
      { id: 'w2', text: 'x = 25/3', section: 'work' },
    ];
    const res = checkLines(oneLine);
    expect(res.ok).toBe(false);
    expect(ids(res.failures)).toEqual(['p1']);
    // Two lines in one variable on that page pin x as well — still not a
    // puzzle, even when the next page's working pins an answer of its own.
    const twoLines: Line[] = [
      { id: 'p1', text: '3x + 5 = 20', section: 'statement' },
      { id: 'p2', text: '3x = 15', section: 'statement' },
      { id: 'w1', text: '3x = 12', section: 'work' },
      { id: 'w2', text: 'x = 4', section: 'work' },
    ];
    expect(ids(checkLines(twoLines).failures)).toEqual(['p1', 'p2']);
  });

  it('never excuses a stated system when the later pages only write an answer', () => {
    // The later page states no equations of its own, so the earlier page is
    // the problem, not a puzzle beside it: the wrong answer fails it.
    const input: Line[] = [
      { id: 'p1', text: 'x + y = 5', section: 'statement' },
      { id: 'p2', text: 'x - y = 1', section: 'statement' },
      { id: 'w1', text: 'x = 1', section: 'answer' },
      { id: 'w2', text: 'y = 1', section: 'answer' },
    ];
    expect(ids(checkLines(input).failures)).toEqual(['p1', 'p2']);
  });

  it('but a single wrong line alone on an earlier page still fails — it states no problem of its own', () => {
    const input: Line[] = [
      { id: 'p1', text: '7x - 15y = 3', section: 'statement' },
      { id: 'w1', text: 'x + 2y = 3', section: 'work' },
      { id: 'w2', text: 'x = 49/29', section: 'work' },
      { id: 'w3', text: 'y = 19/29', section: 'work' },
    ];
    expect(ids(checkLines(input).failures)).toEqual(['p1']);
  });

  it('an earlier page with any line that holds is part of the problem, and its wrong line fails', () => {
    const input: Line[] = [
      { id: 'p1', text: '7x - 15y = 2', section: 'statement' },
      { id: 'p2', text: 'x + 2y = 4', section: 'statement' },
      { id: 'w1', text: 'x = 49/29', section: 'work' },
      { id: 'w2', text: 'y = 19/29', section: 'work' },
    ];
    expect(ids(checkLines(input).failures)).toEqual(['p2']);
  });
});

describe('checkLines — a variable with several roots', () => {
  /**
   * A quadratic has two answers for one variable. They are not two claims
   * fighting over x: they are a root SET. Every line that uses x at degree 2
   * or more must hold for each root; any other line must hold for at least
   * one; a claimed root that solves nothing fails.
   */
  const rootsOf = (res: CheckResult) =>
    Object.fromEntries(Object.entries(res.roots).map(([k, vs]) => [k, vs.map(formatRational)]));

  it('passes a correct quadratic whose roots are written together', () => {
    for (const written of ['Roots: x = 2, x = 3', 'x = 2 and x = 3']) {
      const res = checkLines(lines('x² - 5x + 6 = 0', '(x - 2)(x - 3) = 0', written));
      expect(res.failures, written).toEqual([]);
      expect(ids(res.passed), written).toEqual(['l1', 'l2', 'l3']);
      expect(rootsOf(res), written).toEqual({ x: ['2', '3'] });
      // A variable with several roots has no single value to report.
      expect(answers(res), written).toEqual({});
    }
  });

  it('passes roots found one factor at a time', () => {
    const res = checkLines(
      lines('x² - 5x + 6 = 0', '(x - 2)(x - 3) = 0', 'x - 2 = 0 ⇒ x = 2', 'x - 3 = 0 ⇒ x = 3'),
    );
    expect(res.failures).toEqual([]);
    expect(ids(res.passed)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(res.problems.map((p) => p.ids)).toEqual([['l1', 'l2', 'l3', 'l4']]);
  });

  it('passes a square with a positive and a negative root', () => {
    const res = checkLines(lines('x² = 9', 'x = 3, x = -3'));
    expect(res.failures).toEqual([]);
    expect(rootsOf(res)).toEqual({ x: ['3', '-3'] });
  });

  it('fails a claimed root that does not solve the equation', () => {
    const res = checkLines(lines('x² - 5x + 6 = 0', '(x - 2)(x - 3) = 0', 'x = 2, x = 4'));
    expect(ids(res.failures)).toEqual(['l3']);
    expect(res.failures[0].reason).toMatch(/x = 4/);
    // With only the factored form to go on, it still fails.
    expect(checkLines(lines('(x - 2)(x - 3) = 0', 'x = 2, x = 4')).ok).toBe(false);
  });

  it('fails a factor step whose two halves do not follow from each other', () => {
    // "x - 2 = 0 ⇒ x = 3": each half is true for SOME root, but not the same one.
    const res = checkLines(lines('x² - 5x + 6 = 0', 'x - 2 = 0 ⇒ x = 3', 'x - 3 = 0 ⇒ x = 2'));
    expect(ids(res.failures)).toEqual(['l2', 'l3']);
  });

  it('still fails a numeric slip inside a root line', () => {
    const res = checkLines(lines('x² - 5x + 6 = 0', 'x = (5 + 1)/2 = 4', 'x = (5 - 1)/2 = 2'));
    expect(ids(res.failures)).toEqual(['l2']);
    expect(res.failures[0].reason).toContain('(5 + 1)/2');
  });

  it('holds a squared variable with one answer to that answer, as before', () => {
    // A length: only the positive root is meant, and only one is written.
    const ok = checkLines(lines('x² = 49', 'x = 7'));
    expect(ok.failures).toEqual([]);
    expect(answers(ok)).toEqual({ x: '7' });
    expect(ok.roots).toEqual({});
    expect(ids(checkLines(lines('x² = 49', 'x = 8')).failures)).toEqual(['l1']);
  });

  it('keeps two quadratics with different roots as two problems', () => {
    const res = checkLines(
      lines('x² - 5x + 6 = 0', 'x = 2, x = 3', 'x² - 7x + 12 = 0', 'x = 3, x = 4'),
    );
    expect(res.failures).toEqual([]);
    expect(res.problems.map((p) => p.ids)).toEqual([
      ['l1', 'l2'],
      ['l3', 'l4'],
    ]);
  });
});

/**
 * TWO EXAMPLES, A TABLE OF VALUES, "AT x = 4, THEN AT x = 5" (review,
 * 2026-09-29). The most ordinary shapes in Class 6-10 maths; each was failed
 * as correct maths, and a failed class is refused before the room opens.
 */
describe('several worked cases on one board are each their own problem', () => {
  const lines = (...t: string[]): Line[] => t.map((text, i) => ({ id: `l${i}`, text }));
  const ok = (...t: string[]) => {
    const r = checkLines(lines(...t));
    expect(r.failures, JSON.stringify(r.failures)).toEqual([]);
  };

  it('evaluates at x = 4, then at x = 5', () => ok('x = 4', '2x + 3 = 2(4) + 3 = 11', 'x = 5', '2x + 3 = 2(5) + 3 = 13'));
  it('works two speed examples', () =>
    ok('d = 100, t = 20', 's = d/t = 100/20 = 5', 'd = 60, t = 10', 's = d/t = 60/10 = 6'));
  it('reads a table of values', () => ok('y = 2x + 3', 'x = 0', 'y = 3', 'x = 1', 'y = 5', 'x = 2', 'y = 7'));
  it('works two AP examples', () =>
    ok('a = 3', 'd = 4', 'a + 9d = 3 + 36 = 39', 'a = 5', 'd = 2', 'a + 4d = 5 + 8 = 13'));

  it('still catches a wrong step inside a second example', () => {
    const r = checkLines(lines('x = 4', '2x + 3 = 2(4) + 3 = 11', 'x = 5', '2x + 3 = 2(5) + 3 = 14'));
    expect(r.failures.map((f) => f.id)).toContain('l3');
  });

  /**
   * THE SECOND REVIEW (2026-09-29): the givens rule let "find x, then use it"
   * through with a wrong x — the commonest multi-part shape there is — and a
   * table checked only its first row.
   */
  const fails = (...t: string[]) => {
    const r = checkLines(lines(...t));
    expect(r.failures.length, JSON.stringify(r.failures)).toBeGreaterThan(0);
    return r;
  };
  it('fails a wrong answer that the next line goes on to use', () => {
    fails('5x = 15', 'x = 4', '2x + 1 = 2(4) + 1 = 9');
    fails('x + 2x = 180', '3x = 180', 'x = 50', '2x = 2(50) = 100');
    fails('x + y = 10', 'x - y = 2', 'x = 7', 'y = 3', 'xy = 7(3) = 21');
  });
  it('passes the same shape when the answer is right', () => {
    ok('5x = 15', 'x = 3', '2x + 1 = 2(3) + 1 = 7');
    ok('x + y = 10', 'x - y = 2', 'x = 6', 'y = 4', 'xy = 6(4) = 24');
  });
  it('checks every row of a table against its equation, and blames the row', () => {
    const r = fails('y = 2x + 3', 'x = 0', 'y = 3', 'x = 1', 'y = 6');
    expect(r.failures.map((f) => f.id)).toEqual(['l4']);
  });
  it('reads a second example that does not write the value out', () => {
    ok('a = 4', 'P = 4a = 16', 'a = 5', 'P = 4a = 20');
    ok('a = 4', 'p = 4a = 16', 'a = 5', 'p = 4a = 20');
    ok('x = 4', '2x + 3 = 11', 'x = 5', '2x + 3 = 13');
    fails('a = 4', 'p = 4a = 16', 'a = 5', 'p = 4a = 21');
  });

  /** THE THIRD REVIEW (2026-09-29): a result on its own line, a restated answer, trials. */
  it('fails a wrong result written on its own line after the substitution', () => {
    fails('d = st', 's = 40', 't = 3', 'd = 40(3)', 'd = 130');
    fails('i = prt/100', 'p = 5000', 'r = 8', 't = 2', 'i = 5000(8)(2)/100', 'i = 700');
    fails('p = 2(l + b)', 'l = 8', 'b = 5', 'p = 2(8 + 5)', 'p = 24');
    fails('x + y = 10', 'x - y = 2', '2x = 12', 'x = 6', 'y = 10 - 6', 'y = 5');
    fails('3x + 2y = 12', 'x + 2y = 8', '2x = 4', 'x = 2', 'y = (8 - 2)/2', 'y = 4');
    fails('y = 2x + 3', 'x = 1', 'y = 2(1) + 3', 'y = 6');
  });
  it('passes the same boards when the result is right', () => {
    ok('d = st', 's = 40', 't = 3', 'd = 40(3)', 'd = 120');
    ok('x + y = 10', 'x - y = 2', '2x = 12', 'x = 6', 'y = 10 - 6', 'y = 4');
    ok('y = 2x + 3', 'x = 1', 'y = 2(1) + 3', 'y = 5');
  });
  it('fails a wrong answer restated after a check line', () => {
    fails('2x + 3 = 11', '2x = 8', 'x = 4', '2(4) + 3 = 11', 'So x = 5');
    fails('x^2 - 5x + 6 = 0', '(x - 2)(x - 3) = 0', 'x = 2', '2^2 - 5(2) + 6 = 0', 'x = 4');
  });
  it('passes trial and error, where each try is checked and only the last one fits', () => {
    ok('4x + 5 = 17', 'x = 1', '4x + 5 = 4(1) + 5 = 9', 'x = 2', '4x + 5 = 4(2) + 5 = 13', 'x = 3', '4x + 5 = 4(3) + 5 = 17');
  });
  it('passes two tables of values for the graphical method', () => {
    ok('x + y = 5', 'x = 0', 'y = 5', 'x = 1', 'y = 4', 'x - y = 1', 'x = 1', 'y = 0', 'x = 2', 'y = 1');
  });

  /** THE FOURTH REVIEW (2026-09-29): tries, tables with fixed givens, checks in letters. */
  it('fails a wrong pair of answers whose check line follows', () => {
    fails('x + y = 14', 'x - y = 4', 'x = 10', 'y = 4', 'x + y = 10 + 4 = 14');
    fails('x + y = 10', 'x - y = 2', '2x = 12', 'x = 7', 'x + y = 7 + y = 10', 'y = 3', '2x + 1 = 7', 'x = 3');
  });
  it('reads tables whose first letter is a fixed given', () => {
    ok('d = st', 's = 40', 't = 1', 'd = 40', 't = 2', 'd = 80', 't = 3', 'd = 120');
    ok('y = kx', 'k = 3', 'x = 1', 'y = 3', 'x = 2', 'y = 6', 'x = 3', 'y = 9');
    ok('s = 40', 't = 3', 'd = 40(3) = 120', 't = 5', 'd = 40(5) = 200');
    ok('a = lb', 'l = 8', 'b = 5', 'a = 8(5) = 40', 'b = 6', 'a = 8(6) = 48');
    fails('d = st', 's = 40', 't = 1', 'd = 40', 't = 2', 'd = 90');
  });
  it('reads the graphical method when the second equation is in y = form', () => {
    ok('y = 5 - x', 'x = 0', 'y = 5', 'x = 1', 'y = 4', 'y = 2x - 2', 'x = 1', 'y = 0', 'x = 2', 'y = 2');
  });
  it('fails a wrong answer restated after a check written with letters', () => {
    fails('2x + 3 = 11', '2x = 8', 'x = 4', '2x + 3 = 2(4) + 3 = 11', 'So x = 5');
  });
  it('reads examples substituted in numbers alone', () => {
    ok('x = 1', '3(1) + 2 = 5', 'x = 2', '3(2) + 2 = 8');
    ok('y = 2x + 3', 'x = 1', '2(1) + 3 = 5', 'x = 2', '2(2) + 3 = 7');
  });

  it('refuses a runaway nested power instead of freezing the thread', () => {
    const t0 = Date.now();
    const r = checkLines(lines('(((9^64)^64)^64)^64 = 1', '((9^64)^64)^64 = 1'));
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.failures).toEqual([]);
    expect(r.skipped.length).toBe(2);
  });
});
