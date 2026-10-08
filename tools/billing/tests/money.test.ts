// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MoneyError, paiseFromRupees, rupeesFromPaise } from '../src/money.ts';

/**
 * RUPEES AT THE EDGE, PAISE EVERYWHERE ELSE. Written first.
 *
 * Cashfree speaks rupees with two decimals, as strings in its webhooks and as
 * numbers in its API answers. The database speaks whole paise. This is the one
 * place the two meet.
 */

describe('paise from rupees', () => {
  it('reads Cashfree\'s amounts as paise', () => {
    expect(paiseFromRupees('200.12')).toBe(20012);
    expect(paiseFromRupees('55.00')).toBe(5500);
    expect(paiseFromRupees(22)).toBe(2200);
    expect(paiseFromRupees(100.81)).toBe(10081);
    expect(paiseFromRupees('0.1')).toBe(10);
    expect(paiseFromRupees('7')).toBe(700);
  });

  it('refuses negatives, three decimals, NaN, Infinity, empty strings and amounts past a safe integer', () => {
    for (const bad of ['-1', -1, '1.234', 1.234, Number.NaN, Number.POSITIVE_INFINITY, '', '   ', 'abc', '1e5', '90071992547410'] as const) {
      expect(() => paiseFromRupees(bad as string | number), String(bad)).toThrow(MoneyError);
    }
    expect(paiseFromRupees('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('rupees from paise', () => {
  it('writes paise as rupees with at most two decimals', () => {
    expect(rupeesFromPaise(2_360_000)).toBe(23600);
    expect(rupeesFromPaise(12345)).toBe(123.45);
    expect(rupeesFromPaise(1)).toBe(0.01);
    expect(rupeesFromPaise(0)).toBe(0);
    for (let p = 0; p <= 10_000; p++) expect(paiseFromRupees(rupeesFromPaise(p))).toBe(p);
    expect(() => rupeesFromPaise(-1)).toThrow(MoneyError);
    expect(() => rupeesFromPaise(1.5)).toThrow(MoneyError);
  });
});
