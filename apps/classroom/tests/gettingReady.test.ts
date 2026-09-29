import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => ({ supabase: () => null }));

const { readiness } = await import('../src/screens/LiveClass');

/** Overnight review #32: the wait's bar used to crawl to 27% and vanish. */
describe('readiness', () => {
  it('fills the whole bar across the part of prep before the room opens', () => {
    expect(readiness(0.3, 0)).toBeCloseTo(0.95);
    expect(readiness(0.15, 0)).toBeCloseTo(0.5);
  });

  it('keeps moving on the clock between reports, and never claims it is done', () => {
    expect(readiness(0.05, 30)).toBeGreaterThan(0.45);
    expect(readiness(0.05, 60)).toBeGreaterThan(readiness(0.05, 30));
    expect(readiness(0.05, 600)).toBeLessThanOrEqual(0.9);
  });
});
