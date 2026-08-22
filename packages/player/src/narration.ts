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
 * Browser TTS via window.speechSynthesis. Where that is missing (tests, old
 * WebViews) the adapter times the words instead — the player keeps advancing,
 * just silently.
 */
export function createBrowserTts(opts?: { lang?: string; rate?: number }): TtsAdapter {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return createTimerTts();
  return createSynthTts(synth, opts?.lang ?? 'en-IN', opts?.rate ?? 1);
}

function createSynthTts(synth: SpeechSynthesis, lang: string, rate: number): TtsAdapter {
  // Resolver of the in-flight speak(). Each utterance settles through its OWN
  // finish() closure, so a late `end` event from a cancelled utterance can
  // never resolve a newer speak()'s promise.
  let pendingFinish: (() => void) | null = null;

  return {
    speak(text: string): Promise<void> {
      pendingFinish?.(); // never leave an older speak() hanging
      return new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return; // `end` can still fire after cancel — resolve once
          settled = true;
          if (pendingFinish === finish) pendingFinish = null;
          resolve();
        };
        pendingFinish = finish;

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = rate;
        // An errored utterance must resolve too, or the class stalls forever.
        utterance.onend = finish;
        utterance.onerror = finish;
        synth.speak(utterance);
      });
    },
    cancel(): void {
      synth.cancel();
      // Engines are inconsistent about firing `end` for cancelled utterances —
      // settle the pending promise ourselves rather than wait on the engine.
      pendingFinish?.();
    },
  };
}

/** Word-count timer standing in for a voice. Same contract, no sound. */
function createTimerTts(): TtsAdapter {
  let pendingFinish: (() => void) | null = null;

  return {
    speak(text: string): Promise<void> {
      pendingFinish?.();
      return new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (pendingFinish === finish) pendingFinish = null;
          resolve();
        };
        pendingFinish = finish;
        timer = setTimeout(finish, estimateSpeechMs(text));
      });
    },
    cancel(): void {
      pendingFinish?.();
    },
  };
}
