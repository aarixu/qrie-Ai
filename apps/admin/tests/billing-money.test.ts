import { describe, expect, it } from 'vitest';
import { formatPaise, parseRupees } from '../src/features/billing/money.ts';

/** Rupees as people read and type them; paise as the database keeps them. Written first. */

describe('money on the billing pages', () => {
  it('formats paise with Indian grouping and two decimals', () => {
    expect(formatPaise(12_345_678)).toBe('₹1,23,456.78');
    expect(formatPaise(0)).toBe('₹0.00');
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatPaise(100_000_000)).toBe('₹10,00,000.00');
    expect(formatPaise(2_360_000)).toBe('₹23,600.00');
    expect(formatPaise(99_999)).toBe('₹999.99');
  });

  it('parses typed rupees and refuses the rest', () => {
    expect(parseRupees('1,23,456.7')).toEqual({ ok: true, paise: 12_345_670 });
    expect(parseRupees('50')).toEqual({ ok: true, paise: 5000 });
    expect(parseRupees(' 0.05 ')).toEqual({ ok: true, paise: 5 });
    expect(parseRupees('₹ 1,000')).toEqual({ ok: true, paise: 100_000 });
    for (const bad of ['', '-1', '1.234', 'abc', '0', '0.00', '1e5']) {
      expect(parseRupees(bad), bad).toEqual({ ok: false, error: 'Enter an amount above zero, in rupees, with at most two decimals.' });
    }
  });
});
