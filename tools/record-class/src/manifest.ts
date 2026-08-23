import fs from 'node:fs';
import path from 'node:path';

/**
 * THE RECORDING'S INDEX.
 *
 * The product's core claim is that the first class was really taught once and
 * every later student watches that take. `narration.json` is what makes the
 * claim checkable: for every beat, which file holds the audio, how long it
 * runs, and the hash of the exact words it was rendered from.
 *
 * The hash is the load-bearing field. It is why re-running the renderer after
 * fixing one sentence costs one beat instead of a lesson, and it is how the
 * player can tell that a committed take no longer matches the committed script.
 *
 * COUPLING: `packages/voice` consumes this file at runtime and must read the
 * same shape and compute the same hash. When `packages/voice/src/recordedTts.ts`
 * exports `NarrationManifest` / `hashNarration`, delete the definitions here and
 * re-export from there — two copies of a hash function is two voices waiting to
 * happen.
 */

/** Folder inside a lesson that holds the rendered class. */
export const AUDIO_DIR = 'audio';

/** The index file inside that folder. */
export const MANIFEST_FILE = 'narration.json';

export interface NarrationEntry {
  /** File name relative to the lesson's audio folder, e.g. "hook.m4a". */
  file: string;
  /** Exact length of the take, measured from the PCM the model returned. */
  durationMs: number;
  /** `hashNarration(beat.narration)` at the moment this file was rendered. */
  hash: string;
}

export interface NarrationManifest {
  formatVersion: 1;
  /** Must equal the lesson's own id; a mismatch means the file was copied in. */
  lessonId: string;
  /** Prebuilt voice name. The live agent must use this same voice or the seam is audible. */
  voice: string;
  /** TTS model id the takes came from. */
  model: string;
  /** Keyed by beat id, written in lesson order so a diff reads top to bottom. */
  beats: Record<string, NarrationEntry>;
}

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

export function audioFileName(beatId: string): string {
  return `${beatId}.m4a`;
}

/**
 * Whitespace-insensitive, so re-wrapping a long narration line in lesson.json
 * does not re-render a beat that says exactly the same words.
 */
export function normaliseNarration(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const FNV_PRIME = 0x01000193;

function fnv1a(text: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h = Math.imul(h ^ (code & 0xff), FNV_PRIME) >>> 0;
    // Em dashes and curly quotes are common in narration; folding the high byte
    // in keeps them from hashing the same as their ASCII neighbours.
    if (code > 0xff) h = Math.imul(h ^ (code >>> 8), FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number): string => n.toString(16).padStart(8, '0');

/**
 * FNV-1a run twice from different bases — 64 bits of hex.
 *
 * Deliberately not node:crypto: the player runs this in a browser to decide
 * whether a committed take still matches the committed script, and it has to be
 * the same function on both sides, synchronous, with nothing to import.
 */
export function hashNarration(text: string): string {
  const t = normaliseNarration(text);
  return hex8(fnv1a(t, 0x811c9dc5)) + hex8(fnv1a(t, FNV_PRIME));
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isEntry = (v: unknown): v is NarrationEntry =>
  isObj(v) &&
  typeof v.file === 'string' &&
  typeof v.hash === 'string' &&
  typeof v.durationMs === 'number' &&
  Number.isFinite(v.durationMs);

/** Returns null for anything that is not a manifest we wrote. Callers warn and carry on. */
export function parseManifest(json: unknown): NarrationManifest | null {
  if (!isObj(json)) return null;
  if (json.formatVersion !== 1) return null;
  if (typeof json.lessonId !== 'string' || typeof json.voice !== 'string') return null;
  if (typeof json.model !== 'string' || !isObj(json.beats)) return null;

  const beats: Record<string, NarrationEntry> = {};
  for (const [beatId, entry] of Object.entries(json.beats)) {
    if (!isEntry(entry)) return null;
    beats[beatId] = { file: entry.file, durationMs: entry.durationMs, hash: entry.hash };
  }
  return { formatVersion: 1, lessonId: json.lessonId, voice: json.voice, model: json.model, beats };
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
