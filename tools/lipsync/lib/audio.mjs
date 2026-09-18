// AUDIO IN. ffmpeg only, and only for decoding.
//
// Rhubarb's WASM build takes 16 kHz mono signed-16-bit PCM and nothing else
// (its README: "Input is limited to raw PCM 16KHz audio buffer"). The repo's
// narration ships as .m4a, so something has to decode it, and ffmpeg is
// already a dependency of this machine's content pipeline.
//
// WHY NOT AN npm DECODER: a pure-JS AAC decoder is another package, another
// licence, and another thing to be wrong about, in a build step that already
// assumes a laptop. ffmpeg is on the path or this tool tells you so and
// stops — it does not guess and it does not half-run.

import { execFileSync } from 'node:child_process';

const FFMPEG = process.env.CURIE_FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.CURIE_FFPROBE ?? 'ffprobe';

export const PCM_SAMPLE_RATE = 16000;

/**
 * Decode any audio file to the exact buffer Rhubarb wants.
 * @param {string} path
 * @returns {Buffer} 16 kHz mono s16le PCM
 */
export function decodePcm16k(path) {
  return execFileSync(
    FFMPEG,
    ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(PCM_SAMPLE_RATE), '-f', 's16le', '-acodec', 'pcm_s16le', '-'],
    { maxBuffer: 1024 * 1024 * 512 },
  );
}

/**
 * The clip's duration in seconds, from the container.
 *
 * WHY NOT FROM THE PCM LENGTH: for the rules driver the duration IS the
 * measurement — it is the only thing tying a list of letters to real time —
 * so it is read from the file rather than inferred from a buffer this
 * function may not have been asked to produce.
 */
export function probeDurationSec(path) {
  const out = execFileSync(
    FFPROBE,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
    { encoding: 'utf8' },
  );
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe could not read a duration from ${path}`);
  return seconds;
}

/** Duration implied by a decoded PCM buffer, for cross-checking the probe. */
export function pcmDurationSec(pcm) {
  return pcm.length / 2 / PCM_SAMPLE_RATE;
}

/** Whether ffmpeg and ffprobe are actually reachable, checked before use. */
export function checkFfmpeg() {
  for (const [name, bin] of [
    ['ffmpeg', FFMPEG],
    ['ffprobe', FFPROBE],
  ]) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
    } catch {
      return `${name} is not on PATH (looked for ${bin}). Set CURIE_FFMPEG / CURIE_FFPROBE, or install ffmpeg.`;
    }
  }
  return null;
}
