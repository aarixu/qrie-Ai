#!/usr/bin/env node
/**
 * WHY A CLASS WAS REFUSED FOR ITS MATHS — one preparation, run the app's way,
 * with the gate's findings printed instead of thrown away.
 *
 * On production a cold Class 8 topic was refused ("the class's working does
 * not add up (lines: b2_10, b3_2, b3_5, b3_7)") and nothing said which lines
 * or why. This prepares the named topic through the deployed relay, exactly
 * as prewarm does, and prints every maths problem with the text of the line
 * it was found on. It KEEPS NOTHING. It spends what one preparation costs
 * (about Rs 30), and demands --spend for that reason.
 *
 *   node tools/prewarm/probe-maths.mjs --spend --relay <url> --token <bearer> \
 *     --klass 8 --topic "Solving Equations having the Variable on both Sides"
 */
import './lib/register.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!args.includes('--spend')) {
  console.error('This prepares a class through the relay and spends about Rs 30. Pass --spend.');
  process.exit(2);
}
const relayUrl = flag('relay');
const token = flag('token');
const topic = flag('topic');
const klass = Number(flag('klass') ?? 8);
if (!relayUrl || !token || !topic) {
  console.error('Needs --relay, --token and --topic.');
  process.exit(2);
}

const { randomUUID } = await import('node:crypto');
const { createRelayClient } = await import('./lib/relayAdapters.mjs');
const { prepareClass, createCommonsSearch } = await import('../../packages/class-prep/src/index.ts');

const client = createRelayClient({ relayUrl, token, prepId: randomUUID() });
const MODEL = 'google/gemini-3.7-flash';
const started = Date.now();
try {
  const made = await prepareClass({
    topic,
    klass,
    minutes: 3,
    planner: client.llm(MODEL, { json: true }),
    artist: client.llm(MODEL),
    reviewer: client.llm(MODEL, { json: true }),
    imageArtist: client.imageArtist('google/gemini-3.1-flash-image'),
    eyes: client.vision(MODEL),
    web: createCommonsSearch(),
    onProgress: (p) => process.stdout.write(`\r  ${p.phase.padEnd(9)} ${p.message.padEnd(60).slice(0, 60)}`),
  });
  process.stdout.write('\n');
  console.log(`PREPARED in ${Math.round((Date.now() - started) / 1000)} s — the maths passed.`);
  const gate = made.report.gate?.problems ?? [];
  console.log(JSON.stringify({ gateProblems: gate }, null, 2));
} catch (e) {
  process.stdout.write('\n');
  console.log(`REFUSED in ${Math.round((Date.now() - started) / 1000)} s: ${e instanceof Error ? e.message : e}`);
  if (!e?.mathsProblems && e instanceof Error) console.log(e.stack);
  const problems = e?.mathsProblems ?? [];
  for (const p of problems) console.log(`  [${p.where}] ${p.message}`);
}
console.log(`${client.calls.length} model calls.`);
