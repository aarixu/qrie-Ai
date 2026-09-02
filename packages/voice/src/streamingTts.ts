import type { TtsAdapter } from '@ai-tutor/player';

/**
 * HER VOICE, STREAMED WHILE IT IS BEING MADE.
 *
 * A line is handed to the browser as a URL, not as a file to wait for. The
 * relay behind that URL asks a speech model for the words and pipes the bytes
 * straight through as they arrive, so the audio element starts playing on the
 * first chunk.
 *
 * Measured against OpenRouter's speech endpoint on a real class line: the first
 * byte lands at 0.36 s, and 8.4 seconds of speech finishes generating in 2.5 —
 * it arrives more than three times faster than it plays. Downloading the whole
 * file first would have made every line start two and a half seconds late, for
 * nothing; streaming it means she begins almost as soon as she is asked.
 *
 * Compare the on-device route measured on a mid-range Android: 30–55 s of
 * cold start, then synthesis at 0.7x realtime — slower than speech itself.
 */

/** The part of an audio element this needs. Injected, so a test can listen. */
export interface SpeechElement {
  src: string;
  play(): Promise<void> | void;
  pause(): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

export interface StreamingTtsOptions {
  /** Where the relay lives. The key never reaches the browser. */
  endpoint: string;
  /** Which speech model the relay should ask for. */
  model?: string;
  /**
   * WHO is speaking. Named, and the same on every line.
   *
   * A model left to choose for itself chooses again each time: the same
   * sentence sent three times to Fish came back as three different speakers,
   * and a seed did not pin it. Every line of a class is its own request, so an
   * unnamed voice is a tutor whose voice changes between sentences.
   */
  voice?: string;
  /** Builds the player. Defaults to a real `Audio`. */
  audio?: (src: string) => SpeechElement;
  /**
   * Who speaks when this cannot.
   *
   * Never chosen, only fallen back to — the browser's own robot voice, so a
   * relay that is down costs the class its voice and not its lesson.
   */
  fallback?: TtsAdapter;
  /**
   * A short-lived pass for the speech relay, added to the query string.
   *
   * The relay demands a caller, and this is the one request in the app that
   * cannot carry an Authorization header: it is fetched by assigning a URL to
   * an audio element, which is exactly what lets a line start on its first
   * chunk off the wire. The pass is speech-only and minute-scale — see
   * @ai-tutor/relay's ticket.ts for why it is not the session token.
   *
   * Returns null when there is none, and the URL is then built without one:
   * the relay refuses, and the class falls back to the browser's own voice
   * rather than falling silent.
   */
  ticket?: () => string | null;
}

const realAudio = (src: string): SpeechElement => new Audio(src) as unknown as SpeechElement;

export function createStreamingTts(opts: StreamingTtsOptions): TtsAdapter {
  const make = opts.audio ?? realAudio;
  let current: SpeechElement | null = null;
  /** The next line, already loading while this one plays. */
  let ready: { text: string; element: SpeechElement } | null = null;
  /** What is being said right now, so it is never fetched twice. */
  let speaking = '';

  const urlFor = (words: string): string => {
    const query = new URLSearchParams({ text: words });
    if (opts.model) query.set('model', opts.model);
    if (opts.voice) query.set('voice', opts.voice);
    // Read per line rather than captured once: a class outlives a ticket, and
    // the holder re-mints before the old one lapses.
    const pass = opts.ticket?.();
    if (pass) query.set('ticket', pass);
    return `${opts.endpoint}?${query}`;
  };
  /** Resolves the line in flight, whatever ends it. */
  let finish: (() => void) | null = null;

  const stop = (): void => {
    if (current) {
      current.onended = null;
      current.onerror = null;
      current.pause();
      current = null;
    }
    // The board advances on this promise. A line left unresolved is a class
    // that stops for good — so ending, failing and being cancelled all resolve.
    finish?.();
    finish = null;
  };

  return {
    async speak(text: string): Promise<void> {
      stop();
      const words = text.trim();
      if (words === '') return;

      // Already loading, because the line before it asked for it.
      const element = ready?.text === words ? ready.element : make(urlFor(words));
      ready = null;
      current = element;
      speaking = words;

      let failed = false;
      await new Promise<void>((resolve) => {
        finish = resolve;
        element.onended = () => stop();
        element.onerror = () => {
          failed = true;
          stop();
        };
        void element.play();
      });

      // Only a FAILURE falls back. A line that simply finished must not be
      // said a second time in the robot voice.
      if (failed && opts.fallback) await opts.fallback.speak(words);
    },

    /**
     * Start the next line loading now, while this one is still being said.
     *
     * Speech arrives about three times faster than it plays, so a line begun
     * at the start of the one before it is buffered long before it is needed —
     * and the pause between sentences disappears. Creating the element is what
     * starts the fetch; it is not played until `speak` asks for it.
     */
    prime(text: string): void {
      const words = text.trim();
      if (words === '' || words === ready?.text) return;
      // Priming the line already in flight would fetch it a second time for
      // nothing.
      if (words === speaking) return;
      ready = { text: words, element: make(urlFor(words)) };
    },

    cancel(): void {
      stop();
    },
  };
}
