/**
 * TTS adapter boundary. Browser speechSynthesis today; cloud TTS later — the
 * player only ever sees this interface.
 */
export interface TtsAdapter {
  /** Resolves when the utterance finishes (or is cancelled). */
  speak(text: string): Promise<void>;
  /** Must make any pending speak() resolve promptly. */
  cancel(): void;
  /**
   * Get a line ready that is about to be spoken, without speaking it.
   *
   * Optional, because a voice that is already instant has nothing to gain. For
   * one that fetches, this is the difference between a class and a class with
   * a pause in it: every line is its own request, so with nothing started
   * ahead you hear the whole time-to-first-byte as silence between sentences.
   */
  prime?(text: string): void;
  /**
   * Throw away whatever `prime` got ready, and stop fetching it.
   *
   * Separate from `cancel` on purpose: cancel runs on every pause and seek,
   * where the primed line is still the next one wanted. This is for a class
   * that will not speak that line at all — one that has halted — so a request
   * nobody will hear is not left running and being paid for. Optional, like
   * `prime`: a voice that primes nothing has nothing to drop.
   */
  drop?(): void;
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

/**
 * Names that mean "a woman's voice" across the engines students actually have.
 * The Web Speech API has no gender field, so this list of shipped voice names
 * is the only handle there is: Heera/Neerja/Swara are Windows' Indian-English
 * women, Zira/Aria/Jenny the US ones, and the generic words catch Android and
 * macOS. The tutor is Meera — left to the OS default she speaks as David.
 */
const FEMALE_VOICE = /heera|neerja|swara|aditi|raveena|kajal|zira|aria|jenny|sonia|libby|hazel|susan|samantha|veena|tessa|female|woman/i;

/**
 * The best voice for her: a woman speaking the requested language, Indian
 * English first. Null (engine still loading its list, or nothing matched)
 * leaves the utterance's `lang` to pick the platform default, as before.
 */
function pickVoice(synth: SpeechSynthesis, lang: string): SpeechSynthesisVoice | null {
  // Test stubs and old WebViews may not implement getVoices at all.
  const voices = typeof synth.getVoices === 'function' ? synth.getVoices() : [];
  const base = lang.split('-')[0];
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = 0;
  for (const voice of voices) {
    let score = 0;
    if (FEMALE_VOICE.test(voice.name)) score += 8;
    if (voice.lang === lang) score += 4;
    else if (voice.lang.startsWith(base)) score += 2;
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

function createSynthTts(synth: SpeechSynthesis, lang: string, rate: number): TtsAdapter {
  // Resolver of the in-flight speak(). Each utterance settles through its OWN
  // finish() closure, so a late `end` event from a cancelled utterance can
  // never resolve a newer speak()'s promise.
  let pendingFinish: (() => void) | null = null;

  // Chrome delivers the voice list asynchronously; until it lands, utterances
  // go out on `lang` alone and re-resolve per speak() once it has.
  let voice = pickVoice(synth, lang);
  synth.addEventListener?.('voiceschanged', () => {
    voice = pickVoice(synth, lang);
  });

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
        if (!voice) voice = pickVoice(synth, lang); // the list may have arrived since
        if (voice) utterance.voice = voice;
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
