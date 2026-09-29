import { describe, expect, it } from 'vitest';
import { solveOne } from '@ai-tutor/maths-check';
import { solvesAsExpected, workStartOf } from '../src/lib/workAnswer';

/**
 * WHAT "WORK IT OUT" OFFERS, AND WHAT IT TAKES — one rule for both (fifth
 * review, 2026-09-29). Four review rounds each found phrasings the keyword
 * and first-number heuristics got wrong. Now the question's equation is solved,
 * the values `expect` names as its answer are read, and the panel is offered
 * exactly when that solution is among them (or the answer is itself an
 * equation) — so an offered panel can always be finished, and a solved step is
 * taken exactly when it is what was asked.
 *
 * Every row is a phrasing a review found, or the production class's own.
 */
type Row = [written: string, expect: string, offered: boolean];
const ROWS: Row[] = [
  // Asked for the unknown, in every way a planner writes the answer.
  ['Solve $2x + 3 = 11$', 'x = 4', true],
  ['Solve $2x + 3 = 11$', 'Four, since 2 × 4 + 3 = 11', true],
  ['Solve $2x + 3 = 11$', '4, since 2 x 4 + 3 = 11', true],
  ['Solve $2x + 3 = 11$', 'x is 4, since 2x = 8', true],
  ['Solve $2x + 3 = 11$', String.raw`$x = \frac{8}{2}$`, true],
  ['Solve $2x + 3 = 11$', 'The answer is 4 because 2(4) + 3 = 11.', true],
  ['Solve $2x + 3 = 11$', 'Subtract 3 from both sides: 2x = 8, so x = 4.', true],
  ['Solve $2x + 3 = 11$', 'Answer: x = 4 cm', true],
  ['Solve $x - 4 = 8$', 'Add 4 to both sides: x = 8 + 4 = 12.', true],
  ['Solve $x + 7 = 19$', 'The number is 12, as 12 + 7 = 19.', true],
  ['Solve $x + 7 = 19$', 'The number is 12. Check: 12 + 7 = 19.', true],
  ['Solve $5x = 125$', 'Twenty-five.', true],
  ['Solve $5x = 60$ to find the cost of one pen.', 'One pen costs ₹12.', true],
  ['Solve $x + 300 = 1500$', 'The shirt costs ₹1,200.', true],
  ['Solve $x + 3x = 60$ to find their ages', 'The father is 45 years old and the son is 15.', true],
  ['Solve $2x + 3 = 0$', String.raw`$x = \frac{-3}{2}$`, true],
  ['Solve $2x = 5$', 'x = 2½', true],
  ['Solve $2x = 5$', 'x = 2 1/2', true],
  ['Solve $x + 6 = 4$', 'x = – 2', true],
  ['Solve $x + 6 = 4$', 'x = (-2)', true],
  ['Solve $x + 4 = 0$', 'x is minus four', true],
  ['Solve $2x = 400$', 'Two hundred rupees.', true],
  ['What is $x$ if $2x + 3 = 11$?', 'x is 4.', true],
  ['Calculate $x$: $5x = 60$', 'x is 12', true],
  ['If $3y = 15$, find the value of $y$.', 'Five.', true],
  ['Solve $3x = 12$ to share the sweets', 'Each of the three friends gets 4 sweets.', true],
  // The answer is itself an equation: offered, and the equation is the answer.
  ['If you remove one $x$ from both sides of $2x + 3 = x + 7$, what remains?', 'What remains is x + 3 = 7.', true],
  ['What is the first step to solve $3(x + 4) = 21$?', 'Open the bracket: 3x + 12 = 21.', true],
  // Asked for something the working never reaches: not offered.
  ['If we remove $1$ bag ($x$) from both pans of $2x + 3 = x + 7$, what remains on the left side?', 'One mystery bag and three loose coins.', false],
  ['What is the first step to solve $2x + 3 = 11$?', 'Subtract 3 from both sides.', false],
  ['In $2x + 3 = 11$, what is the value of the left side when x = 4?', '11', false],
  ['Solve $3x + 2 = 11$ and find 2x + 1', '7, because 2 × 3 + 1 = 7', false],
  ['Solve $3x + 2 = 11$ and find 2x + 1', 'The value of 2x + 1 is 7', false],
  ['Solve $2(l + 5) = 30$ and find the area', 'Area = 10 × 5 = 50 cm²', false],
  ['Solve $x + 2x = 90$; find the larger angle', 'The larger angle is 2 × 30 = 60°', false],
  ['Solve $x + 5 = 17$ for his age in 3 years', '15 years (12 + 3)', false],
];

describe('Work it out: offered exactly where the working can finish (fifth review)', () => {
  for (const [written, expect_, offered] of ROWS) {
    it(`${offered ? 'offers' : 'does not offer'} "${written}" → "${expect_}"`, () => {
      const start = workStartOf({ question: 'Say it.', written, expect: expect_ });
      expect(start !== null).toBe(offered);
      if (!start) return;
      const solution = solveOne(start)!;
      // An offered panel whose answer is a value takes exactly that value.
      const takesValue = solvesAsExpected(expect_, solution);
      const answerIsEquation = /what remains|first step/i.test(written);
      expect(takesValue).toBe(!answerIsEquation);
      expect(solvesAsExpected(expect_, { ...solution, value: { n: solution.value.n + 1n, d: solution.value.d } })).toBe(false);
    });
  }
});
