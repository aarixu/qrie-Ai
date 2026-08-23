/**
 * THE TUTOR'S ACTUAL VOICE — Gemini TTS behind the player's TtsAdapter.
 *
 * This is what replaces the operating system's robot narrator. It synthesises
 * one beat's narration, plays it through the same gapless PCM player the live
 * doubt agent uses, and resolves speak() when the last syllable has been heard.
 *
 * TWO RULES SHAPE EVERYTHING HERE.
 *
 * 1. A TTS failure must never stall the class. PlayerController advances on the
 *    speak() promise, so every path out of this file — a 500, a dead network, a
 *    cancelled utterance, a model that answers with text instead of audio —
 *    ends in a RESOLVED promise. Where a fallback adapter is supplied, a
 *    permanent failure speaks through it: the browser voice is a poor teacher
 *    but a better one than silence.
 *
 * 2. The recorded class and the live doubt agent must be the same person. Same
 *    voice name, same director's notes, one prompt builder. If those two drift,
 *    the seam this product is built on becomes audible.
 */

import type { TtsAdapter } from '@ai-tutor/player';
import { TUTOR } from '@ai-tutor/persona';
import { TUTOR_SAMPLE_RATE, createAudioPlayer, type AudioPlayer } from './audio';
import { createCachedTts } from './cachedTts';
import { buildSpeechPrompt, type SpeechStyle } from './speechPrompt';
import {
  parseSampleRate,
  pcmDurationMs,
  type SpeechStore,
  type SpeechSynthesizer,
  type SynthesisRequest,
  type SynthesizedSpeech,
} from './synthesis';
import { createUtteranceQueue, defaultSchedule, type Schedule, type Utterance } from './utterance';

/**
 * The tutor's voice name.
 *
 * Re-exported from the persona rather than declared here: the live doubt agent
 * has to name the same voice, and a voice living in two packages is a seam
 * waiting to be heard. Change it in packages/persona, not here — and note that
 * changing it re-records nothing, so committed narration audio must be
 * regenerated or the recording and the live tutor become two people.
 */
export const DEFAULT_TUTOR_VOICE = TUTOR.speechVoiceName;

/** The 2.5 TTS models can neither stream nor batch; this one does both. */
export const DEFAULT_TTS_MODEL = 'gemini-3.1-flash-tts-preview';

const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * How far ahead the player schedules a buffer (SCHEDULE_LEAD_SEC in audio.ts),
 * added to the wait so the class never advances a hair before the last syllable
 * has left the speaker.
 */
const PLAYBACK_LEAD_MS = 60;

/** Total attempts, not retries. A student is waiting; three is the whole budget. */
const DEFAULT_ATTEMPTS = 3;

/** First backoff step, doubling. 400 + 800 ms is a pause, not a dead class. */
const DEFAULT_BASE_DELAY_MS = 400;

/** Only the parts of Response this file uses, so a fake needs nothing else. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<HttpResponse>;

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  error: Error;
}

export interface GeminiSynthesizerOptions {
  apiKey: string;
  /** Director's notes. The defaults produce the tutor as the persona describes her. */
  style?: SpeechStyle;
  /**
   * Sent as speechConfig.languageCode. A hint only: Google's own docs say the
   * TTS models detect the language from the input, so the accent is carried by
   * the director's notes. Pass null to omit the field entirely.
   */
  languageCode?: string | null;
  fetch?: FetchLike;
  endpoint?: string;
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** First backoff step in ms, doubling each retry. Default 400. */
  baseDelayMs?: number;
  /** Injected so tests have no clock. */
  schedule?: Schedule;
  onRetry?: (info: RetryInfo) => void;
}

export interface GeminiTtsOptions extends GeminiSynthesizerOptions {
  /** Prebuilt voice name. Must be the voice the live agent uses. */
  voice?: string;
  model?: string;
  /** Wraps synthesis in a cache, so the same sentence is paid for once. */
  cache?: SpeechStore;
  /** Injected so tests never touch Web Audio. */
  createPlayer?: () => AudioPlayer;
  /** Speaks lines synthesis could not produce. Without it such a line is silent. */
  fallback?: TtsAdapter;
  /** Called once per utterance that could not be synthesised. */
  onError?: (error: Error) => void;
}

/** A failure worth another take: the documented 500s, a 429, a dead socket. */
class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

/**
 * Pulls the audio out of a reply, and names a text-only reply for what it is.
 *
 * Google documents that the model "occasionally returns text tokens instead of
 * audio tokens". That is a bad take rather than a bad request, so it is
 * transient and the next attempt usually succeeds.
 */
export function extractAudio(json: unknown): SynthesizedSpeech {
  const doc = json as {
    error?: { message?: string; status?: string };
    promptFeedback?: { blockReason?: string };
    candidates?: { content?: { parts?: GeminiPart[] } }[];
  };

  if (doc.error) {
    throw new Error(`TTS API error ${doc.error.status ?? ''}: ${doc.error.message ?? ''}`);
  }
  // A blocked prompt is a verdict on the words themselves, and the next
  // identical attempt earns the same verdict. Go straight to the fallback.
  if (doc.promptFeedback?.blockReason) {
    throw new Error(`TTS request blocked: ${doc.promptFeedback.blockReason}`);
  }

  const parts = doc.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const data = part.inlineData?.data;
    if (typeof data === 'string' && data.length > 0) {
      return { base64: data, mimeType: part.inlineData?.mimeType ?? '' };
    }
  }

  const spoken = parts.map((part) => part.text ?? '').join('').trim();
  if (spoken.length > 0) throw new TransientError('TTS returned text instead of audio');
  throw new TransientError('TTS returned no audio');
}

/**
 * Text in, PCM out. Retries the failures Google documents as expected, then
 * gives up rather than holding a class open indefinitely.
 */
export function createGeminiSynthesizer(options: GeminiSynthesizerOptions): SpeechSynthesizer {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const schedule = options.schedule ?? defaultSchedule;
  const languageCode = options.languageCode === undefined ? 'en-IN' : options.languageCode;

  const delay = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      schedule(resolve, ms);
    });

  const once = async (request: SynthesisRequest): Promise<SynthesizedSpeech> => {
    const speechConfig: Record<string, unknown> = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: request.voice } },
    };
    if (languageCode !== null) speechConfig.languageCode = languageCode;

    let response: HttpResponse;
    try {
      response = await doFetch(`${endpoint}/models/${request.model}:generateContent`, {
        method: 'POST',
        // The key travels in a header, never the query string: query strings
        // end up in proxy logs and browser history.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildSpeechPrompt(request.text, options.style) }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig },
        }),
      });
    } catch (e) {
      // A socket dying as a phone changes cell is the most ordinary failure
      // there is, and the one most worth another attempt.
      throw new TransientError(`TTS request failed: ${asError(e).message}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const message = `TTS HTTP ${response.status} ${body.slice(0, 200)}`.trim();
      // 429 is a scheduling fact — there is no published rate limit for this
      // model — and 5xx covers the documented text-instead-of-audio failure.
      if (response.status === 429 || response.status >= 500) throw new TransientError(message);
      throw new Error(message);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (e) {
      throw new TransientError(`TTS response was not JSON: ${asError(e).message}`);
    }
    return extractAudio(json);
  };

  return {
    async synthesize(request: SynthesisRequest): Promise<SynthesizedSpeech> {
      let last: Error = new Error('TTS made no attempt');
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return await once(request);
        } catch (e) {
          last = asError(e);
          if (attempt === attempts || !(e instanceof TransientError)) throw last;
          const delayMs = baseDelayMs * 2 ** (attempt - 1);
          options.onRetry?.({ attempt, delayMs, error: last });
          await delay(delayMs);
        }
      }
      throw last;
    },
  };
}

/** A TtsAdapter that also owns an AudioContext, so a screen can release it. */
export interface SpeakingTts extends TtsAdapter {
  /** Releases the audio context. The adapter still works — it makes a new one. */
  close(): void;
}

export function createGeminiTts(options: GeminiTtsOptions): SpeakingTts {
  const voice = options.voice ?? DEFAULT_TUTOR_VOICE;
  const model = options.model ?? DEFAULT_TTS_MODEL;
  const schedule = options.schedule ?? defaultSchedule;
  const createPlayer = options.createPlayer ?? createAudioPlayer;
  const base = createGeminiSynthesizer(options);
  const synthesizer = options.cache ? createCachedTts(base, options.cache) : base;
  const { fallback } = options;
  const queue = createUtteranceQueue();

  // The context is built on the first line she speaks rather than at wiring
  // time: browsers suspend contexts created outside a user gesture.
  let player: AudioPlayer | null = null;
  let cancelTimer: (() => void) | null = null;

  const clearTimer = (): void => {
    cancelTimer?.();
    cancelTimer = null;
  };

  /** Every dead end lands here: report it, say the line some other way, resolve. */
  const failOver = (utterance: Utterance, text: string, error: Error): void => {
    options.onError?.(error);
    if (!utterance.current) return;
    if (!fallback) {
      utterance.done();
      return;
    }
    const settle = (): void => {
      utterance.done();
    };
    fallback.speak(text).then(settle, settle);
  };

  return {
    speak(text: string): Promise<void> {
      return queue.speak((utterance) => {
        clearTimer();
        if (text.trim().length === 0) {
          utterance.done(); // nothing to say, and an empty prompt is a rejected request
          return;
        }

        void (async (): Promise<void> => {
          let speech: SynthesizedSpeech;
          try {
            speech = await synthesizer.synthesize({ text, voice, model });
          } catch (e) {
            failOver(utterance, text, asError(e));
            return;
          }
          // A hand may have gone up, or the student may have seeked, while the
          // request was in flight. Playing now would be a voice from the past.
          if (!utterance.current) return;

          const rate = parseSampleRate(speech.mimeType) ?? TUTOR_SAMPLE_RATE;
          if (rate !== TUTOR_SAMPLE_RATE) {
            // The player builds its buffers at 24 kHz. Pushing 16 kHz PCM
            // through it turns the tutor into a chipmunk, which is worse for
            // the student than hearing the fallback voice.
            failOver(
              utterance,
              text,
              new Error(`TTS returned ${rate} Hz audio, expected ${TUTOR_SAMPLE_RATE}`),
            );
            return;
          }

          player ??= createPlayer();
          player.enqueue(speech.base64);
          cancelTimer = schedule(() => {
            cancelTimer = null;
            utterance.done();
          }, pcmDurationMs(speech.base64, rate) + PLAYBACK_LEAD_MS);
        })();
      });
    },

    cancel(): void {
      clearTimer();
      player?.stop();
      fallback?.cancel();
      queue.cancel();
    },

    close(): void {
      clearTimer();
      queue.cancel();
      player?.close();
      player = null;
    },
  };
}
