#!/usr/bin/env node
/**
 * THE PRE-WARM RUNNER — prep as one-time CAPEX instead of per-student cost.
 *
 * A cold topic at S=1 is Rs 496.5/student-hour (0017's arithmetic); the same
 * topic warmed is a download. This CLI drives the SAME pipeline the app uses
 * (packages/class-prep, imported by path, never copied) against a deployed
 * relay, and KEEPS each class via POST /api/class — so the catalogue is paid
 * for once, deliberately, by an operator, rather than by whichever child
 * reaches each topic first.
 *
 * IT SPENDS REAL MONEY when run without --dry-run, which is why a live run
 * demands --spend on top of a relay URL and a bearer token. See README.md.
 *
 * This entry file does exactly two things, in order: register the resolve
 * hook (lib/register.mjs — Node needs it to run the app's TypeScript), then
 * load the actual runner. Everything else lives in lib/main.mjs.
 */
import './lib/register.mjs';

const { main } = await import('./lib/main.mjs');
main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
