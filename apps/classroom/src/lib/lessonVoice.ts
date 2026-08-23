import { useEffect, useState } from 'react';
import { createBrowserTts, type TtsAdapter } from '@ai-tutor/player';
import {
  MANIFEST_FILE,
  createGeminiTts,
  createIndexedDbSpeechStore,
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
export function useLessonVoice(
  entry: CatalogEntry | null,
  lesson: Lesson | null,
  opts: { enabled: boolean },
): TtsAdapter | null {
  const [tts, setTts] = useState<TtsAdapter | null>(null);
  const audioUrl = entry ? lessonAudioUrl(entry) : null;
  const title = lesson?.title;
  const enabled = opts.enabled;

  useEffect(() => {
    if (audioUrl === null || title === undefined) return;

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
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
      const browser = createBrowserTts({ lang: 'en-IN' });
      live = apiKey
        ? createGeminiTts({
            apiKey,
            style: { lessonTitle: title },
            cache: createIndexedDbSpeechStore(),
            fallback: browser,
            onError: (error) => console.warn('[voice]', error.message),
          })
        : browser;

      // A lesson with no recording is not an error — most are not recorded yet.
      const manifest = await fetch(`${audioUrl}/${MANIFEST_FILE}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((raw) => (raw === null ? null : parseManifest(raw)))
        .catch(() => null);

      if (cancelled) return;
      setTts(manifest ? createRecordedTts({ manifest, baseUrl: audioUrl, fallback: live }) : live);
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
