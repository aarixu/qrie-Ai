import { describe, expect, it } from 'vitest';
import { expectedEquation, isFinalValue, restates, solvesAsExpected, workStartOf } from '../src/lib/workAnswer';

const x = (n: bigint, d = 1n) => ({ name: 'x', value: { n, d } });

describe('what "Work it out" can check, and what its answer is (eighth review)', () => {
  it('starts only from one linear equation in one unknown, read as it means', () => {
    expect(workStartOf('Solve $3(x + 4) = 21$')).toBe('3(x + 4) = 21');
    expect(workStartOf(String.raw`Solve $\frac{x-2}{4} = 3$`)).toBe('(x-2)/(4) = 3');
    expect(workStartOf(String.raw`Find $x$: $2^{x} = 32$`)).toBeNull();
    expect(workStartOf('Is $x = 5$ a solution of $2x + 3 = 11$?')).toBeNull();
    expect(workStartOf('If $x = 3$, find the value of $2x + 5$')).toBeNull();
    expect(workStartOf(undefined)).toBeNull();
  });

  it('takes the last solved form in the expected answer, full stop and all', () => {
    expect(solvesAsExpected('Subtract 3 from both sides: 2x = 8, so x = 4.', x(4n))).toBe(true);
    expect(solvesAsExpected('Subtract 3 from both sides: 2x = 8, so x = 4.', x(8n))).toBe(false);
    expect(solvesAsExpected('x = 0.5', x(1n, 2n))).toBe(true);
    expect(solvesAsExpected('The value of x is 14', x(14n))).toBe(true);
    // The answer asked for is not x.
    expect(solvesAsExpected('2x + 5 = 11', x(3n))).toBe(false);
    expect(solvesAsExpected(undefined, x(3n))).toBe(true);
  });

  it('names an equation as the answer only when it is the only one, and not the question', () => {
    expect(expectedEquation('What remains is x + 3 = 7.', '2x + 3 = x + 7')).toBe('x + 3 = 7');
    expect(expectedEquation('Subtract 3: 2x = 8, so x = 4.', '2x + 3 = 11')).toBeNull();
    expect(expectedEquation('Since 2x + 3 = 11', '2x + 3 = 11')).toBeNull();
  });

  it('tells the question restated from a step, and a final value from working', () => {
    expect(restates('3(x + 4) = 21', '21 = 3(x+4)')).toBe(true);
    expect(restates('3(x + 4) = 21', '3x + 12 = 21')).toBe(false);
    expect(isFinalValue('x = -3/4')).toBe(true);
    expect(isFinalValue('3x = 9')).toBe(false);
  });
});
