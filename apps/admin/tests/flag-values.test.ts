import { describe, expect, it } from 'vitest';
import { flagValueProblem } from '../src/lib/flag-values.ts';

/**
 * A switch's new value, checked in the console with admin.flag_valid's rules
 * (0062) before it is sent. Written first.
 */

describe('a value the database would refuse is refused in the editor first', () => {
  it('flagValueProblem says what is wrong, or nothing', () => {
    expect(flagValueProblem('version', '0.1.0')).toBeNull();
    expect(flagValueProblem('count', 500)).toBeNull();
    expect(flagValueProblem('text', 'hi')).toBeNull();
    expect(flagValueProblem('tone', 'info')).toBeNull();
    expect(flagValueProblem('bool', true)).toBeNull();

    expect(flagValueProblem('version', '0.1')).toBe('Write three numbers, such as 0.1.0.');
    expect(flagValueProblem('version', '1.0.0-beta')).toBe('Write three numbers, such as 0.1.0.');

    expect(flagValueProblem('count', 0)).toBe('A whole number from 1 to 100000.');
    expect(flagValueProblem('count', 2.5)).toBe('A whole number from 1 to 100000.');
    expect(flagValueProblem('count', 100001)).toBe('A whole number from 1 to 100000.');

    expect(flagValueProblem('text', 'x'.repeat(281))).toBe('At most 280 characters.');
    expect(flagValueProblem('text', 'x'.repeat(280))).toBeNull();
  });
});
