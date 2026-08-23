/**
 * What came back from the model, measured.
 *
 * Two jobs: read the PCM format out of the mime type so a duration can be
 * computed exactly, and decide whether a take is plausible for the words it was
 * asked to say. The second one exists because Google documents two failure
 * modes that both return HTTP 200 — the model reads the director's notes aloud,
 * or it returns a truncated take — and a silent bad recording shipping into a
 * class is worse than a run that fails loudly.
 */

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/** What the TTS models return today: `audio/l16; rate=24000; channels=1`. */
export const DEFAULT_PCM: PcmFormat = { sampleRate: 24_000, channels: 1, bitsPerSample: 16 };

/**
 * Parameters are read rather than assumed: the same code then survives the day
 * a model returns 16 kHz, instead of silently halving every duration.
 */
export function parsePcmFormat(mimeType: string): PcmFormat {
  const lower = mimeType.toLowerCase();
  if (!lower.includes('l16') && !lower.includes('pcm')) {
    throw new Error(`Expected raw 16-bit PCM, got "${mimeType}"`);
  }
  const rate = /rate=(\d+)/.exec(lower);
  const channels = /channels=(\d+)/.exec(lower);
  return {
    sampleRate: rate ? Number(rate[1]) : DEFAULT_PCM.sampleRate,
    channels: channels ? Number(channels[1]) : DEFAULT_PCM.channels,
    bitsPerSample: 16,
  };
}

export function pcmDurationMs(byteLength: number, format: PcmFormat): number {
  const bytesPerFrame = (format.bitsPerSample / 8) * format.channels;
  return Math.round((byteLength / (bytesPerFrame * format.sampleRate)) * 1000);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Unhurried classroom delivery. Used to predict a duration before rendering. */
export const SPEAKING_WPM = 140;

/**
 * Bounds, not a target. Our own measured take ran at ~205 wpm and a deliberately
 * slow one will sit near 90, so the window has to be wide enough that a normal
 * take never fails — it only has to catch takes that are wrong by a lot.
 *
 * Too fast for the word count means the take was truncated; too slow means the
 * model spoke words nobody wrote, which is the director's-notes bug.
 */
export const MAX_PLAUSIBLE_WPM = 320;
export const MIN_PLAUSIBLE_WPM = 45;

/** Lead-in and trailing silence are real and matter most on very short lines. */
const SILENCE_GRACE_MS = 2_500;

/** Anything shorter than this is not a spoken sentence, whatever the arithmetic says. */
const ABSOLUTE_MIN_MS = 250;

export function expectedDurationMs(text: string): number {
  return Math.round((countWords(text) / SPEAKING_WPM) * 60_000);
}

export interface DurationBounds {
  minMs: number;
  maxMs: number;
}

export function plausibleBounds(text: string): DurationBounds {
  const words = countWords(text);
  const atWpm = (wpm: number): number => (words / wpm) * 60_000;
  return {
    minMs: Math.max(ABSOLUTE_MIN_MS, Math.round(atWpm(MAX_PLAUSIBLE_WPM))),
    maxMs: Math.round(atWpm(MIN_PLAUSIBLE_WPM)) + SILENCE_GRACE_MS,
  };
}

export type TakeCheck = { ok: true } | { ok: false; reason: string };

export function checkTake(text: string, durationMs: number): TakeCheck {
  const words = countWords(text);
  if (words === 0) return { ok: false, reason: 'beat narration is empty' };

  const { minMs, maxMs } = plausibleBounds(text);
  const secs = (durationMs / 1000).toFixed(1);
  const wpm = durationMs > 0 ? Math.round(words / (durationMs / 60_000)) : Infinity;

  if (durationMs < minMs) {
    return {
      ok: false,
      reason: `take is ${secs}s for ${words} words (${wpm} wpm) — truncated; expected at least ${(minMs / 1000).toFixed(1)}s`,
    };
  }
  if (durationMs > maxMs) {
    return {
      ok: false,
      reason: `take is ${secs}s for ${words} words (${wpm} wpm) — too long; the model likely read the director's notes aloud`,
    };
  }
  return { ok: true };
}
