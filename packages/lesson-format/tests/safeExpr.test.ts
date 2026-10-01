import { describe, expect, it } from 'vitest';
import { compileFunction, samplePoints } from '../src/safeExpr';

describe('reading a function of x safely', () => {
  it('computes the lines a class plots', () => {
    const at = (text: string, x: number) => compileFunction(text)!(x);
    expect(at('2x + 1', 3)).toBe(7);
    expect(at('y = x^2 - 4', 3)).toBe(5);
    expect(at('f(x) = 3(x + 1)', 1)).toBe(6);
    expect(at('-x^2', 2)).toBe(-4);
    expect(at('2^-x', 1)).toBe(0.5);
    expect(at('sin(x)', Math.PI / 2)).toBeCloseTo(1);
    expect(at('sqrt(x) + abs(-2)', 9)).toBe(5);
    expect(at('pi x', 1)).toBeCloseTo(Math.PI);
    expect(at('x / 2', 5)).toBe(2.5);
    expect(at('5 − 2×x', 1)).toBe(3);
  });

  it('refuses anything that is not a formula it reads, never guessing', () => {
    for (const bad of ['', 'alert(1)', 'x.constructor', 'y = ', '2x +', '(x + 1', 'process.exit()', 'x'.repeat(81), 'foo(x)', 'x; 1']) {
      expect(compileFunction(bad), bad).toBeNull();
    }
  });

  it('leaves a gap where the function is not defined', () => {
    const pts = samplePoints(compileFunction('1/x')!, -1, 1, 3);
    expect(pts.map((p) => p.x)).toEqual([-1, 1]);
  });
});
