/**
 * TTS adapter boundary. Browser speechSynthesis today; cloud TTS later — the
 * player only ever sees this interface.
 */
export interface TtsAdapter {
  /** Resolves when the utterance finishes (or is cancelled). */
  speak(text: string): Promise<void>;
  /** Must make any pending speak() resolve promptly. */
  cancel(): void;
}

/** Rough speech duration used for fallback timing and progress estimates. */
export function estimateSpeechMs(text: string, wpm = 140): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(600, Math.round((words / wpm) * 60_000));
}

/**
 * STUB — replaced by the player builder. Contract in packages/player/README.md:
 * uses window.speechSynthesis when available, otherwise falls back to a timer
 * of estimateSpeechMs(text).
 */
export function createBrowserTts(_opts?: { lang?: string; rate?: number }): TtsAdapter {
  throw new Error('@ai-tutor/player createBrowserTts: not implemented yet');
}
