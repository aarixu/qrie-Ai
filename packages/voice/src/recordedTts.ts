/**
 * THE RECORDING — the first class, played back.
 *
 * The product's claim is that the tutor really taught this class once and every
 * later student watches that take. `tools/record-class` renders one audio file
 * per beat plus a manifest; this adapter is the other half of that contract.
 *
 * The manifest type and `hashNarration` live HERE, on the runtime side, because
 * the runtime is read by more people than the CLI is, and because two copies of
 * a hash function is two voices waiting to happen. The recorder imports them.
 *
 * WHAT THE HASH IS FOR. Nothing stops someone fixing a sentence in lesson.json
 * and committing it without re-rendering. If this adapter matched on beat id it
 * would then play the old take: the student would hear words the lesson no
 * longer says, and nothing anywhere would look wrong. So a take is played only
 * when the hash of the narration about to be spoken equals the hash recorded at
 * render time; anything else falls through to the fallback adapter and is
 * synthesised live. Slower, correct, and self-healing on the next render.
 */

import type { TtsAdapter } from '@ai-tutor/player';
import { hashNarration } from './hash';
import { createUtteranceQueue, defaultSchedule, type Schedule, type Utterance } from './utterance';

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
  /** Prebuilt voice name. The live agent must use this voice or the seam is audible. */
  voice: string;
  /** TTS model id the takes came from. */
  model: string;
  /** Keyed by beat id, written in lesson order so a diff reads top to bottom. */
  beats: Record<string, NarrationEntry>;
}

export function audioFileName(beatId: string): string {
  return `${beatId}.m4a`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEntry = (value: unknown): value is NarrationEntry =>
  isObject(value) &&
  typeof value.file === 'string' &&
  typeof value.hash === 'string' &&
  typeof value.durationMs === 'number' &&
  Number.isFinite(value.durationMs);

/**
 * Returns null for anything that is not a manifest we wrote — a half-written
 * file, an older format, a 404 page that arrived as JSON. Callers carry on
 * without a recording rather than failing to open the lesson.
 */
export function parseManifest(json: unknown): NarrationManifest | null {
  if (!isObject(json)) return null;
  if (json.formatVersion !== 1) return null;
  if (typeof json.lessonId !== 'string' || typeof json.voice !== 'string') return null;
  if (typeof json.model !== 'string' || !isObject(json.beats)) return null;

  const beats: Record<string, NarrationEntry> = {};
  for (const [beatId, entry] of Object.entries(json.beats)) {
    if (!isEntry(entry)) return null;
    beats[beatId] = { file: entry.file, durationMs: entry.durationMs, hash: entry.hash };
  }
  return { formatVersion: 1, lessonId: json.lessonId, voice: json.voice, model: json.model, beats };
}

/** How a take ended. `stopped` means the student interrupted; both are fine. */
export type PlaybackResult = 'played' | 'stopped' | 'failed';

export interface FilePlayback {
  /** Never rejects. Resolves once, however the take ended. */
  readonly finished: Promise<PlaybackResult>;
  stop(): void;
}

export interface FilePlayer {
  /** `durationMs` comes from the manifest and is used as a watchdog, not a timer. */
  play(url: string, durationMs: number): FilePlayback;
}

/** Why a beat was not served from the recording. Feed it to the render report. */
export type FallthroughReason = 'not-recorded' | 'unsafe-file' | 'playback-failed';

export interface RecordedTtsOptions {
  manifest: NarrationManifest;
  /** Where the files sit, e.g. "/content/blood-and-its-components/audio". */
  baseUrl: string;
  /** Speaks every line the recording cannot vouch for. Usually the Gemini adapter. */
  fallback: TtsAdapter;
  /** Injected so tests never touch a media element. */
  filePlayer?: FilePlayer;
  schedule?: Schedule;
  onFallthrough?: (info: { text: string; reason: FallthroughReason }) => void;
}

/**
 * If a take runs long past its measured length, something is wrong with the
 * file and `ended` is never coming. Advance anyway — a stuck beat is a dead
 * class, and the manifest already told us how long this take should be.
 */
const PLAYBACK_GUARD_MS = 1_500;

/**
 * A file name becomes a URL, so it may not be able to walk out of the lesson's
 * audio folder. Checked here rather than trusted, because a manifest is content
 * and content is the part of this system a stranger edits.
 */
function isSafeAudioFile(file: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) && !file.includes('..');
}

function joinUrl(baseUrl: string, file: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${file}`;
}

/**
 * Plays a take through an HTMLAudioElement.
 *
 * An element rather than Web Audio: the recorder ships AAC in m4a precisely
 * because it decodes everywhere including iOS Safari, and an element streams it
 * without holding the whole lesson in memory.
 */
export function createElementFilePlayer(schedule: Schedule = defaultSchedule): FilePlayer {
  return {
    play(url: string, durationMs: number): FilePlayback {
      if (typeof Audio === 'undefined') {
        return { finished: Promise.resolve<PlaybackResult>('failed'), stop: () => undefined };
      }

      let settle: (result: PlaybackResult) => void = () => undefined;
      const finished = new Promise<PlaybackResult>((resolve) => {
        settle = resolve;
      });

      const audio = new Audio(url);
      let done = false;
      let cancelGuard: (() => void) | null = null;
      const end = (result: PlaybackResult): void => {
        if (done) return;
        done = true;
        cancelGuard?.();
        audio.onended = null;
        audio.onerror = null;
        settle(result);
      };

      audio.onended = (): void => end('played');
      audio.onerror = (): void => end('failed');
      cancelGuard = schedule(() => end('played'), Math.max(0, durationMs) + PLAYBACK_GUARD_MS);

      try {
        // Older WebViews return nothing from play() instead of a promise, and
        // a missing rejection there is not a reason to skip the take.
        const started: Promise<void> | undefined = audio.play();
        void started?.catch(() => end('failed'));
      } catch {
        end('failed');
      }

      return {
        finished,
        stop(): void {
          audio.pause();
          end('stopped');
        },
      };
    },
  };
}

export function createRecordedTts(options: RecordedTtsOptions): TtsAdapter {
  const { manifest, baseUrl, fallback } = options;
  const filePlayer = options.filePlayer ?? createElementFilePlayer(options.schedule);
  const queue = createUtteranceQueue();

  // Keyed by hash, not by beat id, because this adapter is handed words and
  // never learns which beat they came from. Two beats narrating the same
  // sentence share a take, which is correct: it is the same take.
  const takes = new Map<string, NarrationEntry>();
  for (const entry of Object.values(manifest.beats)) takes.set(entry.hash, entry);

  let playing: FilePlayback | null = null;

  const fallThrough = (utterance: Utterance, text: string, reason: FallthroughReason): void => {
    options.onFallthrough?.({ text, reason });
    if (!utterance.current) return;
    const settle = (): void => {
      utterance.done();
    };
    fallback.speak(text).then(settle, settle);
  };

  return {
    speak(text: string): Promise<void> {
      return queue.speak((utterance) => {
        // Media elements do not queue themselves the way the PCM player does:
        // starting a second take without stopping the first plays both at once.
        playing?.stop();

        const entry = takes.get(hashNarration(text));
        if (!entry) {
          // Either this beat was never rendered, or its narration has been
          // edited since. Indistinguishable from here, and the answer is the
          // same: say the words the lesson says now.
          fallThrough(utterance, text, 'not-recorded');
          return;
        }
        if (!isSafeAudioFile(entry.file)) {
          fallThrough(utterance, text, 'unsafe-file');
          return;
        }

        const playback = filePlayer.play(joinUrl(baseUrl, entry.file), entry.durationMs);
        playing = playback;
        playback.finished.then(
          (result) => {
            if (playing === playback) playing = null;
            if (!utterance.current) return;
            // A missing or undecodable file must not silently swallow a beat.
            if (result === 'failed') fallThrough(utterance, text, 'playback-failed');
            else utterance.done();
          },
          () => {
            if (playing === playback) playing = null;
            fallThrough(utterance, text, 'playback-failed');
          },
        );
      });
    },

    cancel(): void {
      playing?.stop();
      playing = null;
      fallback.cancel();
      queue.cancel();
    },
  };
}
