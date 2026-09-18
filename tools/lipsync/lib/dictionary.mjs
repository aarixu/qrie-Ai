// DICTIONARY COVERAGE — the one HARD number this spike can produce about
// Hinglish without any hand-labelled ground truth.
//
// ============================================================================
// WHY THIS IS THE MEASUREMENT THAT MATTERS.
//
// The question the phase exists to answer is whether the cheap build-step
// pipeline survives Hinglish. Every other signal in this tool is a comparison
// of two outputs with no truth behind either. This one is not a comparison:
// it reads the actual English dictionary that ships inside
// rhubarb-lip-sync-wasm and asks, word by word, how much of a Hinglish
// narration line the recogniser has ever heard of.
//
// A word that is not in the dictionary cannot be biased toward by the
// `dialogText` argument, because the argument works by making expected words
// more likely and an unknown word has no entry to make more likely. So the
// out-of-vocabulary rate is a direct, checkable bound on how much of
// Rhubarb's advantage survives the language switch.
//
// THE TRAP IN THIS NUMBER, named so nobody quotes it flatter than it is: a
// hit is not the same as a correct pronunciation. "beta" is IN the dictionary
// — as the Greek letter, B EY T AH. The Hindi word a tutor says to a child is
// /beː.ʈaː/. The dictionary scores that as covered and the recogniser will
// still be listening for the wrong sounds. So the true OOV rate is a FLOOR on
// the damage, never a ceiling.
// ============================================================================

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { loadRhubarb } from './rhubarb-driver.mjs';

// The dictionary is one of ten files packed into rhubarb.data by Emscripten's
// file packager. The packer writes a plain JSON manifest of {filename, start,
// end} byte ranges into rhubarb.js, so the range is READ rather than guessed —
// a hard-coded offset would rot silently at the next version bump.
const DICT_NAME = '/res/sphinx/cmudict-en-us.dict';

/**
 * Pull the packed CMU dictionary out of an installed rhubarb-lip-sync-wasm.
 * @returns {Promise<{ok:true, words:Set<string>, entries:number, from:string} | {ok:false, reason:string}>}
 */
export async function loadDictionary() {
  const loaded = await loadRhubarb();
  if (!loaded.ok) return { ok: false, reason: 'rhubarb-lip-sync-wasm is not installed' };
  if (loaded.from === 'node resolution') {
    return { ok: false, reason: 'resolved rhubarb by bare specifier; cannot locate its wasm directory' };
  }

  let js;
  let data;
  try {
    const require = createRequire(join(loaded.from, 'package.json'));
    const wasmDir = join(require.resolve('./dist/index.js'), '..', 'wasm');
    js = readFileSync(join(wasmDir, 'rhubarb.js'), 'utf8');
    data = readFileSync(join(wasmDir, 'rhubarb.data'));
  } catch (err) {
    return { ok: false, reason: `could not read the packed wasm data: ${err.message}` };
  }

  const manifest = js.match(/"files":\s*(\[[^\]]*\])/);
  if (!manifest) return { ok: false, reason: 'rhubarb.js has no file-packager manifest in the expected shape' };

  let files;
  try {
    files = JSON.parse(manifest[1]);
  } catch (err) {
    return { ok: false, reason: `file-packager manifest did not parse: ${err.message}` };
  }

  const entry = files.find((f) => f.filename === DICT_NAME);
  if (!entry) return { ok: false, reason: `${DICT_NAME} is not in this build's packed files` };

  const text = data.subarray(entry.start, entry.end).toString('utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const words = new Set();
  for (const line of lines) {
    // "word(2) PHONE PHONE" — the (2) marks an alternative pronunciation of
    // the same word, so it is stripped rather than counted as a second word.
    const head = line.split(/\s+/)[0];
    if (head) words.add(head.replace(/\(\d+\)$/, '').toLowerCase());
  }
  return { ok: true, words, entries: lines.length, from: loaded.from };
}

/**
 * What fraction of a line's word tokens the dictionary has never heard of.
 *
 * Tokens, not types: a line that says "hai" five times is five chances for
 * the recogniser to be lost, and the mouth is driven by tokens.
 *
 * WHAT THE TOKENISER COUNTS, because it sets the denominator of the most
 * quoted number in this spike: runs of a-z and apostrophes, after lowercasing.
 * So "iron-rich" is TWO tokens, "5.5" is none at all, and "don't" is one. The
 * first two both move the rate, and neither is obviously the right choice —
 * CMUdict has no hyphenated compounds and no digits, so counting them as
 * single tokens would report a miss for a word the dictionary was never asked
 * about. This is the convention; it is not the only defensible one.
 *
 * @param {string} text
 * @param {Set<string>} words
 */
export function coverage(text, words) {
  const tokens = (text ?? '').toLowerCase().match(/[a-z']+/g) ?? [];
  const missing = [];
  let hits = 0;
  for (const token of tokens) {
    if (words.has(token)) hits++;
    else missing.push(token);
  }
  return {
    tokens: tokens.length,
    inDictionary: hits,
    outOfVocabulary: missing.length,
    oovRate: tokens.length === 0 ? 0 : missing.length / tokens.length,
    missingTypes: [...new Set(missing)].sort(),
  };
}
