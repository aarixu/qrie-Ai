import fs from 'node:fs';
import path from 'node:path';
import {
  AUDIO_DIR,
  MANIFEST_FILE,
  parseManifest,
  type NarrationEntry,
  type NarrationManifest,
} from '../../../packages/voice/src/index.ts';

/**
 * THE RECORDING'S INDEX — the writing half.
 *
 * The product's core claim is that the first class was really taught once and
 * every later student watches that take. `narration.json` is what makes the
 * claim checkable: for every beat, which file holds the audio, how long it
 * runs, and the hash of the exact words it was rendered from.
 *
 * THE SHAPE, THE HASH AND THE READER ARE NOT HERE. They are `NarrationManifest`,
 * `hashNarration` and `parseManifest` in `@ai-tutor/voice`, because that
 * package is the side that has to trust this file at runtime: it hashes the
 * line it is about to speak and plays the recorded take only if the two agree.
 * A manifest is a contract between a writer and a reader, and a contract with
 * two definitions is a recording that stops being played without anything
 * looking wrong.
 *
 * What is left here is the half a CLI needs and a browser must never have:
 * where the file sits on disk, and how it is read, ordered and written.
 */

export function manifestDir(lessonDir: string): string {
  return path.join(lessonDir, AUDIO_DIR);
}

export function manifestPath(lessonDir: string): string {
  return path.join(manifestDir(lessonDir), MANIFEST_FILE);
}

export function emptyManifest(lessonId: string, voice: string, model: string): NarrationManifest {
  return { formatVersion: 1, lessonId, voice, model, beats: {} };
}

/**
 * A beat id becomes a file name, so it may not contain anything that could walk
 * out of the audio folder. Checked before the first network call: discovering
 * this after paying for ten takes would be a poor trade.
 */
export function isSafeBeatId(beatId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(beatId) && !beatId.includes('..');
}

export interface ManifestLoad {
  manifest: NarrationManifest | null;
  /** Set when a file exists but could not be used, so the CLI can say why. */
  problem?: string;
}

export function loadManifest(lessonDir: string): ManifestLoad {
  const file = manifestPath(lessonDir);
  if (!fs.existsSync(file)) return { manifest: null };

  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { manifest: null, problem: `${MANIFEST_FILE} is not valid JSON (${String(e)})` };
  }

  const manifest = parseManifest(json);
  if (!manifest) return { manifest: null, problem: `${MANIFEST_FILE} is not a narration manifest` };
  return { manifest };
}

/** Rewrites the beats map in `order` so the committed file diffs in lesson order. */
export function orderBeats(manifest: NarrationManifest, order: readonly string[]): NarrationManifest {
  const beats: Record<string, NarrationEntry> = {};
  for (const beatId of order) {
    const entry = manifest.beats[beatId];
    if (entry) beats[beatId] = entry;
  }
  return { ...manifest, beats };
}

export function writeManifest(lessonDir: string, manifest: NarrationManifest): void {
  const dir = manifestDir(lessonDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath(lessonDir), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
