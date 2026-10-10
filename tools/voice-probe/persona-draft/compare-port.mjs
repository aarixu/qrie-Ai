/**
 * IS THE PORT THE DRAFT? Compares packages/persona (v3, ported 2026-10-11) with
 * the draft it came from, block by block. Free, no network.
 *
 *   node tools/voice-probe/persona-draft/compare-port.mjs
 *
 * Prints one line per block; any difference is printed in full.
 */
import '../../prewarm/lib/register.mjs';

const draft = await import('./meera.mjs');
const port = await import('../../../packages/persona/src/index.ts');

const pairs = [
  ['CORE', draft.CORE, port.CORE],
  ['likesBlock', draft.likesBlock(), port.likesBlock()],
  ['safety en voice', draft.safetyBlock('en', 'IN', 'voice'), port.safetyBlock('en', 'IN', 'voice')],
  ['safety hi-en voice', draft.safetyBlock('hi-en', 'IN', 'voice'), port.safetyBlock('hi-en', 'IN', 'voice')],
  ['safety en text', draft.safetyBlock('en', 'IN', 'text'), port.safetyBlock('en', 'IN', 'text')],
  ['safety hi-en text', draft.safetyBlock('hi-en', 'IN', 'text'), port.safetyBlock('hi-en', 'IN', 'text')],
  ['LANGUAGE en', draft.LANGUAGE.en, `LANGUAGE\n${port.REGISTER.en}`],
  ['LANGUAGE hi-en', draft.LANGUAGE['hi-en'], `LANGUAGE\n${port.REGISTER['hi-en']}`],
  ['SPEAKING voice', draft.SPEAKING.voice, port.SPEAKING.voice],
  ['SPEAKING text', draft.SPEAKING.text, port.SPEAKING.text],
  ['MOVES keys', Object.keys(draft.MOVES).join(','), Object.keys(port.MOVES).join(',')],
  ...Object.keys(draft.MOVES).map((k) => [`MOVE ${k}`, draft.MOVES[k], port.MOVES[k]]),
];

let same = 0;
for (const [name, a, b] of pairs) {
  if (a === b) {
    same += 1;
    console.log('same     ', name);
  } else {
    console.log('DIFFERENT', name, '\n  draft:', JSON.stringify(a), '\n  port: ', JSON.stringify(b));
  }
}
console.log(`${same} of ${pairs.length} blocks identical`);
