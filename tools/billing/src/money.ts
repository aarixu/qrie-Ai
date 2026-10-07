/**
 * RUPEES AT THE EDGE, PAISE EVERYWHERE ELSE.
 *
 * Cashfree's amounts are rupees with at most two decimals: strings in its
 * webhooks ("200.12"), numbers in its API answers (23600, 100.81). The database
 * keeps whole paise. These two functions are the only conversion, and both read
 * and write decimal text rather than multiplying floats, so 100.81 is 10081.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

const RUPEES = /^(\d+)(?:\.(\d{1,2}))?$/;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

/** "200.12", "55.00", 22, 100.81 -> paise. Refuses negatives, more than two decimals, NaN, non-finite, above MAX_SAFE_INTEGER. */
export function paiseFromRupees(v: string | number): number {
  const text = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : typeof v === 'string' ? v.trim() : '';
  const m = RUPEES.exec(text);
  if (!m) throw new MoneyError(`not an amount in rupees with at most two decimals: ${JSON.stringify(v)}`);
  const paise = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
  if (paise > MAX) throw new MoneyError('the amount is larger than this system counts');
  return Number(paise);
}

/** 2360000 -> 23600, 12345 -> 123.45 (a number with at most two decimals). */
export function rupeesFromPaise(p: number): number {
  if (!Number.isSafeInteger(p) || p < 0) throw new MoneyError(`not a whole, non-negative number of paise: ${p}`);
  // An integer divided by 100 is the double nearest the two-decimal value, so
  // it prints (and serialises to JSON) as that value.
  return p / 100;
}
