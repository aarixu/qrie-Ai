/**
 * The synthesis boundary: text in, audio out, nothing about playback.
 *
 * Splitting this from the TtsAdapter is what makes caching possible at all. An
 * adapter's speak() plays a sound and returns nothing, so there is nothing to
 * cache; a synthesizer returns bytes, so the same sentence in the same voice is
 * paid for once and reused by every student who ever hears that beat.
 */

export interface SynthesisRequest {
  /** The words to be spoken. Director's notes are added by the synthesizer. */
  text: string;
  /** Prebuilt voice name, e.g. "Sulafat". */
  voice: string;
  /** TTS model id. */
  model: string;
}

export interface SynthesizedSpeech {
  /** Base64 PCM exactly as the API returned it — no re-encoding on the way through. */
  base64: string;
  /** e.g. "audio/l16; rate=24000; channels=1". Parsed, never assumed. */
  mimeType: string;
}

export interface SpeechSynthesizer {
  /** Rejects only when the audio genuinely cannot be produced; retries live inside. */
  synthesize(request: SynthesisRequest): Promise<SynthesizedSpeech>;
}

/**
 * Bytes for a cache to hold. Async because the only storage worth having in a
 * browser (IndexedDB) is async, and a synchronous interface would have forced
 * every caller to grow a second code path later.
 */
export interface SpeechStore {
  /** Undefined for a miss AND for a store that is unavailable — never throws. */
  get(key: string): Promise<SynthesizedSpeech | undefined>;
  /** Best effort. A full disk is not a reason to stop the class. */
  set(key: string, value: SynthesizedSpeech): Promise<void>;
}

/** Sample rate out of "audio/l16; rate=24000; channels=1". Null when absent. */
export function parseSampleRate(mimeType: string): number | null {
  const match = /rate=(\d+)/.exec(mimeType);
  if (match === null) return null;
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * How long the audio runs, from the base64 length alone.
 *
 * Counting characters rather than decoding: this is asked on every beat purely
 * to know when the sentence ends, and decoding a minute of speech twice — once
 * here and once in the player — is real work for an answer that is arithmetic.
 * 16-bit mono, so two bytes per sample.
 */
export function pcmDurationMs(base64: string, sampleRate: number): number {
  const clean = base64.trim();
  if (clean.length === 0 || sampleRate <= 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const bytes = Math.max(0, Math.floor(clean.length / 4) * 3 - padding);
  return Math.round((Math.floor(bytes / 2) / sampleRate) * 1000);
}
