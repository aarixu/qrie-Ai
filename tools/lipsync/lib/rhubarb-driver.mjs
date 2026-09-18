// DRIVER: rhubarb — the good one, when it is installed and when the language
// is English.
//
// rhubarb-lip-sync-wasm@0.1.8 (MIT, Daniel Oquelis; a WASM port of Daniel S.
// Wolf's Rhubarb, also MIT; bundled CMU Sphinx acoustic model under a 2-clause
// BSD variant). It installs with no native build and no compiler — VERIFIED,
// `npm install` of this exact version added one package in 19 seconds on the
// machine this tool was written on.
//
// ============================================================================
// WHY IT IS AN OPTIONAL, EXPLICITLY RESOLVED DEPENDENCY AND NOT AN `npm i`
// IN THE ROOT package.json:
//
//   The package is 41.9 MB unpacked, of which 37.0 MB is rhubarb.data. Read
//   out of the Emscripten packer's own manifest, that file is exactly ten
//   files and every one of them is English-only:
//     8 acoustic-model files          6,609,647 B
//     cmudict-en-us.dict              3,272,051 B   (125,945 words)
//     en-us.lm.bin                   27,114,385 B   — 73 % of the payload
//   The largest item is an English n-gram LANGUAGE model, which is worth
//   naming here because it is the plainest evidence that there is no
//   language-independent recogniser in this build to fall back to. It never
//   leaves the laptop and never enters the app bundle, so its size costs the
//   student nothing. But it is a heavy download to force on everyone who clones this
//   repo to fix a CSS bug, and the tool it serves is a research spike.
//
//   So: install it where you want it, tell this file where that is.
//     npm install --prefix tools/lipsync/vendor rhubarb-lip-sync-wasm@0.1.8
//   node_modules/ is already gitignored at every level, so the 37 MB never
//   becomes a commit.
// ============================================================================
//
// THE LIMIT THAT MATTERS FOR THIS PRODUCT, found by reading the package
// rather than the research doc: the WASM port exposes ONE recogniser and no
// way to choose another. Its whole API surface is
// `getLipSync(pcmBuffer, dialogText)` — there is no `-r phonetic`. Native
// Rhubarb's language-independent fallback, which avatar-3.md:1A names as THE
// Hinglish mitigation, is not reachable from this package at all. Anything
// depending on that fallback needs the native binary, not this.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normaliseCues } from './format.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where to look, in order. CURIE_RHUBARB_DIR wins so a CI box can point anywhere. */
function candidates() {
  const list = [];
  if (process.env.CURIE_RHUBARB_DIR) list.push(process.env.CURIE_RHUBARB_DIR);
  list.push(join(HERE, '..', 'vendor', 'node_modules', 'rhubarb-lip-sync-wasm'));
  list.push(join(HERE, '..', '..', '..', 'node_modules', 'rhubarb-lip-sync-wasm'));
  return list;
}

/**
 * Resolve the package without throwing.
 * @returns {Promise<{ok: true, Rhubarb: any, from: string} | {ok: false, tried: string[]}>}
 */
export async function loadRhubarb() {
  const tried = [];
  for (const dir of candidates()) {
    tried.push(dir);
    try {
      const require = createRequire(join(dir, 'package.json'));
      const entry = require.resolve('./dist/index.js');
      // @vite-ignore for the same reason as the bare specifier below: a path
      // computed at run time is not an edge in anybody's module graph.
      const mod = await import(/* @vite-ignore */ `file://${entry.replace(/\\/g, '/')}`);
      if (mod?.Rhubarb) return { ok: true, Rhubarb: mod.Rhubarb, from: dir };
    } catch {
      // keep looking
    }
  }
  try {
    // The specifier is held in a variable ON PURPOSE. A literal here is a
    // static import as far as any bundler is concerned, and Vite — which is
    // what runs this repo's tests — fails to RESOLVE the module at transform
    // time when the optional package is absent. That turned "the aligner is
    // not installed" into "the test file will not load", which is the wrong
    // failure: coverage() in dictionary.mjs is pure arithmetic and must be
    // testable on a machine that has never downloaded 37 MB of acoustic model.
    const bare = 'rhubarb-lip-sync-wasm';
    const mod = await import(/* @vite-ignore */ bare);
    if (mod?.Rhubarb) return { ok: true, Rhubarb: mod.Rhubarb, from: 'node resolution' };
  } catch {
    // fall through
  }
  return { ok: false, tried };
}

export const INSTALL_HINT =
  'npm install --prefix tools/lipsync/vendor rhubarb-lip-sync-wasm@0.1.8   (37 MB of model data; node_modules is gitignored)';

/**
 * Align a clip with Rhubarb.
 *
 * @param {Buffer} pcm 16 kHz mono s16le, as decodePcm16k produces
 * @param {{dialogText?:string, duration?:number}} [options]
 *   dialogText — the narration script. Rhubarb biases recognition toward
 *     words it expects, and this repo HAS the script, so withholding it would
 *     be measuring the tool with one hand tied. The comparison harness runs
 *     it both ways on purpose, because the gap between them is the closest
 *     observable proxy this repo has for what happens to an out-of-dictionary
 *     Hinglish word.
 * @returns {Promise<{cues: Array, raw: Array, elapsedMs: number}>}
 */
export async function alignByRhubarb(pcm, options = {}) {
  const loaded = await loadRhubarb();
  if (!loaded.ok) {
    throw new Error(
      `rhubarb-lip-sync-wasm not found. Tried:\n  ${loaded.tried.join('\n  ')}\nInstall it with:\n  ${INSTALL_HINT}`,
    );
  }
  const started = Date.now();
  const result = await loaded.Rhubarb.getLipSync(pcm, { dialogText: options.dialogText ?? '' });
  const elapsedMs = Date.now() - started;
  const raw = result?.mouthCues ?? [];
  return { cues: normaliseCues(raw, { duration: options.duration }), raw, elapsedMs };
}
