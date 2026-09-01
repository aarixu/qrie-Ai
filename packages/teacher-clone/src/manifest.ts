/**
 * THE LIP-DUBBED TAKE — indexed exactly like the recorded voice.
 *
 * Deliberately a mirror of `NarrationManifest` in @ai-tutor/voice: one entry
 * per beat, each carrying the hash of the narration it was rendered FOR.
 *
 * WHY THE HASH IS HERE TOO. Nothing stops someone fixing a sentence in
 * lesson.json and committing it without re-rendering the video. A clip that
 * plays anyway is worse than no clip: a real teacher's lips, mouthing words
 * the class is not speaking, under their own face. So a take plays only when
 * the hashes agree, and anything else falls back to the idle loop — which
 * reads as the teacher listening, and is honest.
 */

/** Folder inside a lesson that holds the rendered clips. */
export const CLIP_DIR = 'clips';

/** The index file inside that folder's lesson. */
export const CLIP_MANIFEST_FILE = 'clips.json';

export interface ClipEntry {
  /** File name inside the lesson's clips folder, e.g. "b1.mp4". */
  file: string;
  /** Length of the take, so a caller can tell how long the mouth moves. */
  durationMs: number;
  /** `hashNarration(beat.narration)` at the moment this clip was rendered. */
  hash: string;
}

export interface ClipManifest {
  formatVersion: 1;
  /** Must equal the lesson's own id; a mismatch means the folder was copied in. */
  lessonId: string;
  /**
   * WHICH teacher this take is of.
   *
   * Two clones are being built from one pipeline, and a class that mixed a
   * take of one teacher into a class taught by the other would be the single
   * most damaging bug this feature can have. Named here so it can be checked.
   */
  teacher: string;
  /**
   * The between-lines loop, and the fallback for any beat without an honest
   * take. Required: without it there is nothing to show but a frozen frame.
   */
  idle: string;
  /** Keyed by beat id, written in lesson order so a diff reads top to bottom. */
  beats: Record<string, ClipEntry>;
}

export function clipFileName(beatId: string): string {
  return `${beatId}.mp4`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEntry = (value: unknown): value is ClipEntry =>
  isObject(value) &&
  typeof value.file === 'string' &&
  value.file !== '' &&
  typeof value.hash === 'string' &&
  value.hash !== '' &&
  typeof value.durationMs === 'number' &&
  Number.isFinite(value.durationMs);

/**
 * Returns null for anything that is not a manifest we wrote — a half-written
 * file, an older format, a 404 page that arrived as JSON. Callers carry on
 * with the penguin, or with no clone at all, rather than failing to open the
 * lesson.
 */
export function parseClipManifest(json: unknown): ClipManifest | null {
  if (!isObject(json) || json.formatVersion !== 1) return null;
  if (typeof json.lessonId !== 'string' || json.lessonId === '') return null;
  if (typeof json.teacher !== 'string' || json.teacher === '') return null;
  if (typeof json.idle !== 'string' || json.idle === '') return null;
  if (!isObject(json.beats)) return null;

  const beats: Record<string, ClipEntry> = {};
  for (const [beatId, entry] of Object.entries(json.beats)) {
    if (!isEntry(entry)) return null;
    beats[beatId] = { file: entry.file, durationMs: entry.durationMs, hash: entry.hash };
  }

  return {
    formatVersion: 1,
    lessonId: json.lessonId,
    teacher: json.teacher,
    idle: json.idle,
    beats,
  };
}
