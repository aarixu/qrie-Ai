// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

/**
 * The PGlite suites build a whole Postgres in `beforeAll` (every migration,
 * then usually a school or two). Alone that takes seconds; in the full suite
 * on 2026-10-07 seven of them ran past a 30-second hook budget and went red
 * without a single real failure (.scratch/baseline-tests.txt: lms-invariants,
 * lms-structure, lms-brain brain, lms-client bank / hand-in-once / new-year,
 * lms-import apply). This pins the budget those hooks get.
 */
describe('the hook budget the PGlite suites run under', () => {
  it('gives a beforeAll two minutes, not thirty seconds', () => {
    expect(config.test?.hookTimeout).toBeGreaterThanOrEqual(120_000);
  });

  it('leaves the per-test budget where it was', () => {
    expect(config.test?.testTimeout).toBe(30_000);
  });
});
