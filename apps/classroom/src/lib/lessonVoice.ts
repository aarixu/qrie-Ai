import { useEffect, useState } from 'react';
import { relayFetch, relayUrl } from './relay';
import { createBrowserTts, type TtsAdapter } from '@ai-tutor/player';
import { MANIFEST_FILE, createPcmStreamTts, createRecordedTts, parseManifest } from '@ai-tutor/voice';
import { tutorLanguage } from './workspace';
import type { Lesson } from '@ai-tutor/lesson-format';
import { lessonAudioUrl, type CatalogEntry } from './content';
import { announceLine, avatarPcmOutput } from '../avatar/avatarBus';
import { announceStart, withStartOnSpeak } from './voiceStart';

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
 * WHO MEERA SOUNDS LIKE: Gemini TTS's Sulafat on Vertex, the persona's own
 * voice (TUTOR.speechVoiceName), chosen server-side in the relay
 * (packages/relay/src/vertexSpeech.ts). Until 2026-09-28 it was Deepgram's
 * aura-2 Thalia, which had no Indian English voice and no Hinglish.
 */

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
  const lessonLanguage = lesson?.language;
  const enabled = opts.enabled;

  useEffect(() => {
    if (title === undefined) return;

    // Voice off is not the browser voice at low volume — it is no voice. The
    // player still needs an adapter to time the beats, and the timer adapter
    // inside createBrowserTts does exactly that when speech is unavailable.
    if (!enabled) {
      // Announces each line as it is asked for, so the board's ink still
      // appears with its sentence when the voice is switched off.
      setTts(withStartOnSpeak(createSilentTts()));
      return;
    }

    let cancelled = false;
    let live: TtsAdapter | null = null;

    (async () => {
      // Reveal-on-speak: the browser's voice cannot say when its sound starts
      // (lib/voiceStart.ts), so it announces a line when asked to speak it.
      const browser = withStartOnSpeak(createBrowserTts({ lang: 'en-IN' }));
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
      /**
       * HER VOICE IS GEMINI ON VERTEX, STREAMED AS PCM (Aarav, 2026-09-28).
       *
       * Deepgram's aura-2 had no Indian voice and could not speak Hinglish.
       * The relay now streams Gemini TTS's raw PCM and this plays each chunk
       * as it lands (first audio 1.2-2.1 s measured on Vertex), through the
       * avatar's analyser so the mouth moves to what the student hears. The
       * language is the child's onboarding choice, or the lesson's own when
       * it was prepared in Hinglish.
       *
       * `onStart` fires when a line's first sample reaches the speaker. It is
       * what the live board waits for before revealing that sentence's ink
       * (lib/voiceStart.ts, T2.4).
       *
       * Each line is POSTed through `relayFetch` — identity and sitting in
       * headers, her words in the body (overnight review #2): a GET put the
       * greeting with the child's name, and their own answer read back, into
       * the gateway's request logs as a query string. A relay older than this
       * answers the POST 400, and the line falls back to the browser voice.
       */
      live = createPcmStreamTts({
        endpoint: relayUrl('/api/speech'),
        request: (text, lang, signal) =>
          relayFetch('/api/speech', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, format: 'pcm', ...(lang ? { lang } : {}) }),
            signal,
          }),
        lang: () => (tutorLanguage() === 'hi-en' || lessonLanguage === 'hi-en' ? 'hi-en' : 'en'),
        output: avatarPcmOutput,
        fallback: browser,
        onStart: announceStart,
      });

      // A lesson with no recording is not an error — most are not recorded
      // yet, and a class made thirty seconds ago never can be.
      const manifest = audioUrl
        ? await fetch(`${audioUrl}/${MANIFEST_FILE}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((raw) => (raw === null ? null : parseManifest(raw)))
            .catch(() => null)
        : null;

      /**
       * NO ON-DEVICE LAYER (2026-09-28). Supertonic was never shipped — there
       * is no `public/models`, so every line 404'd there first and its prime
       * never reached the cloud voice, which put the whole fetch time between
       * sentences — and it speaks English only, which a Hinglish tutor cannot
       * use. The recorded take (class10-blood) stays on top.
       */
      if (cancelled) return;
      setTts(
        withFace(
          manifest && audioUrl
            ? createRecordedTts({ manifest, baseUrl: audioUrl, fallback: live })
            : live,
        ),
      );
    })().catch(() => {
      if (!cancelled) setTts(withStartOnSpeak(createBrowserTts({ lang: 'en-IN' })));
    });

    return () => {
      cancelled = true;
      live?.cancel();
    };
  }, [audioUrl, title, enabled, lessonLanguage]);

  return tts;
}

/** Silence that still advances the class: no sound, no waiting on a voice. */
function createSilentTts(): TtsAdapter {
  return {
    speak: () => Promise.resolve(),
    cancel: () => undefined,
  };
}

/**
 * The face is told every line the voice speaks, whichever voice it is.
 *
 * For the streamed voice the avatar also hears the real audio (avatarAudio);
 * for the recorded take and the browser robot this announcement is all it
 * gets, and the mouth runs shape-only on wall time — quieter, never wrong.
 *
 * `prime` and `drop` pass straight through when the voice underneath has
 * them. `drop` is how a halted class (lib/sessionHalt.ts) reaches the line
 * the streamed voice primed for the next beat; without it here, the halt's
 * call would stop at this wrapper. Exported for that test.
 */
export function withFace(inner: TtsAdapter): TtsAdapter {
  // Which line the face is on. A line cancelled and replaced in the same tick
  // (a halt's support line, a tap over her line) used to finish AFTER the new
  // one was announced and blank it (overnight review #17): only the newest
  // line may clear the face.
  let newest = 0;
  return {
    speak: (text: string) => {
      const mine = ++newest;
      announceLine(text);
      return inner.speak(text).finally(() => {
        if (mine === newest) announceLine('');
      });
    },
    cancel: () => {
      newest += 1;
      announceLine('');
      inner.cancel();
    },
    ...(inner.prime ? { prime: inner.prime.bind(inner) } : {}),
    ...(inner.drop ? { drop: inner.drop.bind(inner) } : {}),
  };
}
