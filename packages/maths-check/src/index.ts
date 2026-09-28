/**
 * @ai-tutor/maths-check — does the board's maths hold?
 *
 * A pure, deterministic checker for the equation lines a Class 6-10 maths
 * lesson writes: exact rational arithmetic (bigint over bigint, never a
 * float), 0 model calls, no runtime dependencies. It finds the answers the
 * board claims and holds every other line to them; see check.ts for the
 * exact rules, including what it skips and the one shape it excuses.
 *
 * T1.4 of the tutor build plan: run at prep, where a failure feeds the
 * repair loop. Wiring it into class-prep is not part of this package.
 */

export {
  checkLines,
  type CheckResult,
  type Failure,
  type Line,
  type Passed,
  type Problem,
  type Skipped,
} from './check.ts';
export { checkLesson, equationLines } from './lesson.ts';
export {
  parseExpression,
  parseLine,
  ParseError,
  type LineParse,
  type ParsedLine,
  type Side,
  type Statement,
} from './parse.ts';
export type { Expr, Values } from './expr.ts';
export {
  DivisionByZero,
  equals,
  formatRational,
  parseDecimal,
  rational,
  type Rational,
} from './rational.ts';

import { valueOf, type Values } from './expr.ts';
import { parseExpression, ParseError } from './parse.ts';
import type { Rational } from './rational.ts';

/**
 * The exact value of one expression (no `=`), with `values` put in for its
 * variables. Null when it cannot be read (see parse.ts for what is refused),
 * when a variable has no value, or when it divides by zero.
 */
export function evaluate(expr: string, values: Values = {}): Rational | null {
  try {
    return valueOf(parseExpression(expr), values);
  } catch (e) {
    if (e instanceof ParseError) return null;
    throw e;
  }
}
