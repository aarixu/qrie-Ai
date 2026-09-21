import { defineConfig } from 'vitest/config';
import root from '../../../vitest.config';

/**
 * THE BENCH RUNS ONLY WHEN IT IS NAMED.
 *
 * The root config includes `tools/*\/tests/**`, and this deliberately does not
 * live there: the bench reads a cached answer set and writes a result file, so
 * it is a measurement rather than a test and has no business going red in the
 * suite.
 *
 *   npx vitest run --config tools/measure/f-bench/vitest.config.ts
 *
 * NOT `mergeConfig`. That concatenates arrays, so the root's `include` survived
 * alongside this one and the first run of this bench also ran all 3,490 tests —
 * four minutes to measure something that takes three seconds. The aliases are
 * spread across explicitly instead: without them `@ai-tutor/tutor-judge` does
 * not resolve and the thing under measurement is not the thing that ships.
 */
export default defineConfig({
  resolve: root.resolve,
  test: {
    environment: 'jsdom',
    testTimeout: 30_000,
    include: ['tools/measure/f-bench/**/*.bench.test.ts'],
  },
});
