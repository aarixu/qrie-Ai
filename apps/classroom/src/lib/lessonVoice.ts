import { useEffect, useState } from 'react';
import { createBrowserTts, type TtsAdapter } from '@ai-tutor/player';
import {
  MANIFEST_FILE,
  createStreamingTts,
  createRecordedTts,
  parseManifest,
} from '@ai-tutor/voice';
import type { Lesson } from '@ai-tutor/lesson-format';
import { lessonAudioUrl, type CatalogEntry } from './content';

/**
 * The voice a lesson is narrated in — three layers, best first.
 *
 *   1. the recorded take   — rendered once by tools/record-class and committed
 *                            with the lesson. Free, instant, works offline.
 *   2. live synthesis      — her real voice, made on demand and cached, for a
 *                            lesson nobody has recorded yet.
 *   3. the browser's voice  — the operating system robot. Never chosen, only
 *                            fallen back to, so a class is never silent.
 *
 * Wiring only: which layer speaks a given line is decided inside
 * @ai-tutor/voice, from the manifest and from what the API returns.
 */
/**
 * WHO MEERA SOUNDS LIKE. One place, so changing her is one line.
 *
 * Deepgram's Aura will not speak without a named voice, and that is exactly
 * why it is here: Fish S2.1 with no reference voice picks a new speaker on
 * every call — the same sentence, sent three times, came back as three
 * different people — and every line of a class is its own call.
 *
 * `thalia` is Deepgram's "clear, confident, energetic, enthusiastic", chosen
 * because clarity on a phone speaker matters more than warmth, and a tutor who
 * asks questions needs some energy. `helena` and `cordelia` are the warmer
 * ones if that turns out to be the wrong trade.
 *
 * The honest gap: Aura-2 has no INDIAN English voice at all — American,
 * British, Australian, Irish and several others, but not ours. That is what
 * cloning Meera's own voice through Fish is meant to fix, once the rest of the
 * framework stands.
 */
const TUTOR_VOICE = { model: 'deepgram/aura-2', voice: 'aura-2-thalia-en' } as const;

export function useLessonVoice(
  entry: CatalogEntry | null,
  lesson: Lesson | null,
  opts: { enabled: boolean },
): TtsAdapter | null {
  const [tts, setTts] = useState<TtsAdapter | null>(null);
  // Null means there is no recording to look for, not that we do not know yet.
  // A class prepared live a moment ago has no catalogue entry and never will
  // have a recorded take, so waiting for one leaves it silent forever — the
  // room sat on "Loading…" because this hook never resolved.
  const audioUrl = entry ? lessonAudioUrl(entry) : null;
  const title = lesson?.title;
  const enabled = opts.enabled;

  useEffect(() => {
    if (title === undefined) return;

    // Voice off is not the browser voice at low volume — it is no voice. The
    // player still needs an adapter to time the beats, and the timer adapter
    // inside createBrowserTts does exactly that when speech is unavailable.
    if (!enabled) {
      setTts(createSilentTts());
      return;
    }

    let cancelled = false;
    let live: TtsAdapter | null = null;

    (async () => {
      const browser = createBrowserTts({ lang: 'en-IN' });
      /**
       * Streamed through our own relay, so the key stays on the server and the
       * first sound arrives while the rest is still being made — 0.36 s to the
       * first byte against 2.5 s for a whole spoken line, measured.
       *
       * This replaced Google's own TTS, which returns 403 "project has been
       * denied access" on this account and left every class speaking in the
       * browser's robot voice. `createGeminiTts` is still in @ai-tutor/voice
       * for whenever that access comes back.
       */
      live = createStreamingTts({
        endpoint: '/api/speech',
        ...TUTOR_VOICE,
        fallback: browser,
      });

      // A lesson with no recording is not an error — most are not recorded
      // yet, and a class made thirty seconds ago never can be.
      const manifest = audioUrl
        ? await fetch(`${audioUrl}/${MANIFEST_FILE}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((raw) => (raw === null ? null : parseManifest(raw)))
            .catch(() => null)
        : null;

      if (cancelled) return;
      setTts(
        manifest && audioUrl
          ? createRecordedTts({ manifest, baseUrl: audioUrl, fallback: live })
          : live,
      );
    })().catch(() => {
      if (!cancelled) setTts(createBrowserTts({ lang: 'en-IN' }));
    });

    return () => {
      cancelled = true;
      live?.cancel();
    };
  }, [audioUrl, title, enabled]);

  return tts;
}

/** Silence that still advances the class: no sound, no waiting on a voice. */
function createSilentTts(): TtsAdapter {
  return {
    speak: () => Promise.resolve(),
    cancel: () => undefined,
  };
}
