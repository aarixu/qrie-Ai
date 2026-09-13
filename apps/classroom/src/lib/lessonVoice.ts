import { useEffect, useState } from 'react';
import { currentSpeechTicket, relayUrl, speechTicket } from './relay';
import { currentSessionId } from '../stores/ledger';
import { createBrowserTts, type TtsAdapter } from '@ai-tutor/player';
import {
  MANIFEST_FILE,
  createOnDeviceTts,
  createStreamingTts,
  createRecordedTts,
  parseManifest,
} from '@ai-tutor/voice';
import { onDeviceSynth } from './onDeviceSpeech';
import type { Lesson } from '@ai-tutor/lesson-format';
import { lessonAudioUrl, type CatalogEntry } from './content';
import { announceLine, avatarAudio } from '../avatar/avatarBus';

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
      /**
       * THE PASS FOR HER VOICE — started, NOT awaited.
       *
       * The pass has to be asked for before the first line — a round trip
       * mid-sentence is the one thing the streaming relay exists to avoid —
       * but awaiting it here would hang the whole classroom on a request with
       * no timeout: a half-open connection would leave the room on its
       * skeleton for good, and this path never sets an error, so the Try again
       * button could not appear. It also has to be started AFTER `live` is
       * assigned, or the cleanup below can run against a null and leave a
       * cancelled class still speaking.
       *
       * Fired here, in an effect that runs when the route mounts, it has the
       * whole join screen to finish in. A line that still arrives without one
       * falls back to the browser's own voice, which is what the fallback is
       * for — a class that keeps its lesson and loses its voice, not silence.
       */
      live = createStreamingTts({
        endpoint: relayUrl('/api/speech'),
        ticket: currentSpeechTicket,
        session: currentSessionId,
        ...TUTOR_VOICE,
        // Her face listens in: the avatar builds the audio elements, taps
        // their loudness, and lipsyncs to the same clock the student hears.
        audio: avatarAudio,
        fallback: browser,
      });
      void speechTicket();

      // A lesson with no recording is not an error — most are not recorded
      // yet, and a class made thirty seconds ago never can be.
      const manifest = audioUrl
        ? await fetch(`${audioUrl}/${MANIFEST_FILE}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((raw) => (raw === null ? null : parseManifest(raw)))
            .catch(() => null)
        : null;

      /**
       * HER OWN VOICE, ON THE PHONE, ABOVE THE CLOUD ONE.
       *
       * Free, private, and it works with no network at all — which for a
       * student in India is most of the ways a class gets taken. The cloud
       * voice stays UNDER it rather than beside it: three hundred megabytes
       * arrive once, and the first class on a cold install must not open with
       * a minute of silence while they do.
       *
       * The avatar's own audio factory, so the mouth still moves to the clock
       * the student hears rather than to ours.
       */
      const onDevice = createOnDeviceTts({
        synth: onDeviceSynth(),
        audio: avatarAudio,
        fallback: live,
      });

      if (cancelled) return;
      setTts(
        withFace(
          manifest && audioUrl
            ? createRecordedTts({ manifest, baseUrl: audioUrl, fallback: onDevice })
            : onDevice,
        ),
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

/**
 * The face is told every line the voice speaks, whichever voice it is.
 *
 * For the streamed voice the avatar also hears the real audio (avatarAudio);
 * for the recorded take and the browser robot this announcement is all it
 * gets, and the mouth runs shape-only on wall time — quieter, never wrong.
 */
function withFace(inner: TtsAdapter): TtsAdapter {
  return {
    speak: (text: string) => {
      announceLine(text);
      return inner.speak(text).finally(() => announceLine(''));
    },
    cancel: () => {
      announceLine('');
      inner.cancel();
    },
    ...(inner.prime ? { prime: inner.prime.bind(inner) } : {}),
  };
}
