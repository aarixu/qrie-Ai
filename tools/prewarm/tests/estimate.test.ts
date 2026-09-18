import { describe, expect, it } from 'vitest';
import { PER_TOPIC_INR, estimate } from '../lib/estimate.mjs';

/**
 * The dry-run arithmetic. The numbers are PRD-6's: Rs 30 a topic as the
 * planning number, Rs 26 to Rs 40 as the uncertainty band — a dry run that
 * printed a different band would be a second opinion nobody asked for.
 */
describe('dry-run estimate', () => {
  it('carries the PRD-6 planning number and band', () => {
    expect(PER_TOPIC_INR).toEqual({ low: 26, plan: 30, high: 40 });
  });

  it('multiplies the band by the topic count', () => {
    const e = estimate(274);
    expect(e.count).toBe(274);
    expect(e.low).toBe(274 * 26);
    expect(e.plan).toBe(274 * 30);
    expect(e.high).toBe(274 * 40);
  });

  it('zero topics is zero rupees, never NaN', () => {
    const e = estimate(0);
    expect(e).toEqual({ count: 0, low: 0, plan: 0, high: 0 });
  });
});
