import { fail, type RelayResponse } from './relays.ts';
import { HOST, LOCATION, type VertexOptions } from './vertex.ts';

/**
 * HER VOICE, FROM VERTEX.
 *
 * Aarav, 2026-09-28: speech moves to Gemini TTS on Vertex, and OpenRouter
 * and Deepgram stop being used for it — Deepgram's aura-2 has no Indian voice
 * and cannot speak Hinglish, and Gemini can. With `deps.vertex` set, every
 * spoken line comes from here (handler.ts); OpenRouter is left only for a
 * laptop that has no service-account file.
 *
 * TWO SHAPES OF THE SAME LINE:
 *
 * - `format=pcm` (the app since 2026-09-28): the Vertex SSE stream is turned
 *   into raw 16-bit PCM AS IT ARRIVES (`sseToPcm`, run by the host) and the
 *   browser schedules it through Web Audio, so she starts speaking on the
 *   first chunk. Measured 2026-09-28 against project-dd876d44 at `global`,
 *   one 85-character line: first audio 1.38-1.48 s, whole 5.5-5.8 s line
 *   generated in 3.0-3.6 s (three runs, direct, not through the relay).
 * - anything else (an old bundle's `<audio src>`): the stream is collected and
 *   answered as one WAV. An `<audio>` element cannot start a WAV early —
 *   measured in Chromium 2026-09-28, a streamed WAV of unknown length did not
 *   reach `canplay` until ~240 KB had arrived — so this shape is only for
 *   clients that predate the PCM player.
 *
 * COST: $1/M input tokens, $20/M audio output tokens; the three runs billed
 * 169-187 audio tokens for 5.5-5.8 s, ~32 tokens a second, about Rs 0.06 per
 * second of speech (roughly 1.4x aura-2). Aarav has set the Rs 5 ceiling aside
 * until the tutor is built (2026-09-28).
 */

/** The model record-class and `@ai-tutor/voice` already use. */
export const VERTEX_SPEECH_MODEL = 'gemini-3.1-flash-tts-preview';

/**
 * The persona's own voice (`TUTOR.speechVoiceName` in packages/persona) —
 * the voice `class10-blood` was recorded in. Copied, not imported, because
 * the Edge Function resolves this package by relative path and cannot reach
 * a workspace alias; tests/vertexSpeech.test.ts fails the day they differ.
 */
export const VERTEX_SPEECH_VOICE = 'Sulafat';

/** What `format=pcm` answers with: the model's own PCM, untouched. */
export const PCM_CONTENT_TYPE = 'audio/L16;rate=24000;channels=1';

/** A student is waiting on this line; past this the browser's voice is better than more waiting. */
const SPEECH_TIMEOUT_MS = 20_000;

export type SpeechLanguage = 'en' | 'hi-en';

/**
 * The text part of the call — the same shape `buildSpeechPrompt` in
 * packages/voice gives the recorded class (preamble, profile, notes, labelled
 * transcript), so the live line and the recording are one teacher. Copied in
 * short because this file cannot import that package (see VERTEX_SPEECH_VOICE);
 * the preamble and the label are tested equal to the voice package's.
 *
 * The preamble and the transcript label are load-bearing: Google documents
 * that without them the model can read the director's notes aloud.
 */
const PREAMBLE = 'Synthesize speech for the transcript below. Do not read these instructions aloud.';
const LABEL = '### TRANSCRIPT';

const ACCENT: Record<SpeechLanguage, string> = {
  en: 'Indian English as spoken by an educated schoolteacher in Delhi - clear, natural Indian English, not anglicised and not a caricature.',
  'hi-en':
    'Hinglish, the way a Delhi schoolteacher really talks to a student: Hindi words said as a native Hindi speaker says them, English and science terms in clear Indian English, switching between the two naturally mid-sentence.',
};

export function speechPrompt(text: string, lang: SpeechLanguage = 'en'): string {
  return [
    PREAMBLE,
    '# AUDIO PROFILE: Meera',
    '## a warm, patient school teacher who explains rather than lectures, and who is glad you asked',
    '## THE SCENE',
    'A quiet room. She is at the board with one student, talking to them directly. There is no hurry.',
    "### DIRECTOR'S NOTES",
    'Style: Warm and encouraging, with a vocal smile. Patient, never condescending. Conversational, like a real tutor sitting beside the student.',
    'Pacing: Natural and unhurried, with a small pause after a new idea.',
    `Accent: ${ACCENT[lang]}`,
    LABEL,
    text.trim(),
  ].join('\n');
}

/**
 * THE MOST AUDIO ONE LINE MAY COME BACK AS (overnight review #1).
 *
 * The meter charges a line by its characters, and Vertex bills the audio
 * that comes OUT — with no cap, a prompt that got the model to keep talking
 * would be billed far past what the meter took. `maxOutputTokens` is the
 * obvious lever and the TTS model REFUSES it: every value from 100 to 16,384
 * answered 400 "Request contains an invalid argument" (measured 2026-09-29,
 * and it took her voice down in production for five minutes). So the cap is
 * on the stream instead: `sseToPcm` ends the line once it has carried this
 * much audio, which also ends the upstream request, and `speakOnVertex`'s
 * collected path stops reading at the same budget.
 *
 * A teacher speaks about 14 characters a second (a measured 56-character
 * Hinglish line came back as 4.4 s). The budget is five characters a second,
 * with each digit counted three times — "240" is said "two hundred forty" —
 * and a four-second floor, so a short line with a number in it is never cut
 * mid-number (third review). And never more than MAX_LINE_SECONDS whatever the
 * text: a line of 2,000 digits would otherwise be allowed twenty minutes of
 * audio against a meter that charged it for 2,000 characters (fifth review,
 * 2026-09-29). Raw 24 kHz 16-bit mono is 48,000 bytes a second.
 */
export const MAX_LINE_SECONDS = 120;

export function maxSpeechBytes(text: string): number {
  const chars = [...text].length;
  const digits = (text.match(/[0-9]/g) ?? []).length;
  const seconds = Math.min(MAX_LINE_SECONDS, Math.max(4, (chars + 2 * digits) / 5));
  return Math.ceil(seconds * 48_000);
}

/**
 * Audio tokens for audio Vertex sent, when its own count never arrived: a
 * line the cap or the student ended stops before the final event that
 * carries `usageMetadata`. ~32 audio tokens a second (measured, and the
 * price row's note in tools/sql/model_price.sql). An ESTIMATE, so a report
 * can tell it apart only by the missing prompt count.
 */
export const estimatedSpeechTokens = (audioBytes: number): number => Math.round((audioBytes / 48_000) * 32);

export function speechRequestBody(text: string, lang: SpeechLanguage): string {
  return JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: speechPrompt(text, lang) }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VERTEX_SPEECH_VOICE } },
        // A hint, not the lever: the accent note above carries it.
        languageCode: lang === 'hi-en' ? 'hi-IN' : 'en-IN',
      },
    },
  });
}

export function vertexSpeechStreamUrl(projectId: string, location: string = LOCATION): string {
  return (
    `${HOST}/v1/projects/${projectId}/locations/${location}` +
    `/publishers/google/models/${VERTEX_SPEECH_MODEL}:streamGenerateContent?alt=sse`
  );
}

/** Everything the host needs to stream one line: where, with what, and how to read it. */
export interface SpeechCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Mints the Google token and builds the streamed request. Throws only on auth. */
export async function vertexSpeechCall(text: string, lang: SpeechLanguage, options: VertexOptions): Promise<SpeechCall> {
  const token = await options.tokens.token();
  return {
    url: vertexSpeechStreamUrl(options.tokens.projectId, options.location ?? LOCATION),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: speechRequestBody(text, lang),
  };
}

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/** What the TTS model returns today: `audio/l16; rate=24000; channels=1`. */
const DEFAULT_PCM: PcmFormat = { sampleRate: 24_000, channels: 1, bitsPerSample: 16 };

/** Read from the mime type rather than assumed, so a 16 kHz reply is not played at 1.5x. */
function pcmFormatOf(mimeType: string): PcmFormat {
  const lower = mimeType.toLowerCase();
  const rate = /rate=(\d+)/.exec(lower);
  const channels = /channels=(\d+)/.exec(lower);
  return {
    sampleRate: rate ? Number(rate[1]) : DEFAULT_PCM.sampleRate,
    channels: channels ? Number(channels[1]) : DEFAULT_PCM.channels,
    bitsPerSample: 16,
  };
}

/** Raw little-endian PCM in the 44-byte header an `<audio>` element needs. */
export function pcmToWav(pcm: Uint8Array, format: PcmFormat): Uint8Array {
  const wav = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(wav.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) wav[at + i] = s.charCodeAt(i);
  };
  const blockAlign = (format.bitsPerSample / 8) * format.channels;
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, format.bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  wav.set(pcm, 44);
  return wav;
}

const fromBase64 = (data: string): Uint8Array => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

interface SpeechEvent {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
}

const count = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);

/** What a finished stream billed, and how much audio it carried. */
export interface SpeechUsage {
  promptTokens?: number;
  outputTokens?: number;
  audioBytes: number;
}

/**
 * One SSE event's text to its audio bytes, its mime type and its usage.
 * Unparseable events are skipped rather than fatal: one bad event must not
 * cost the rest of the line.
 */
function readEvent(block: string): { audio: Uint8Array[]; mime: string; usage?: SpeechEvent['usageMetadata'] } {
  const out: { audio: Uint8Array[]; mime: string; usage?: SpeechEvent['usageMetadata'] } = { audio: [], mime: '' };
  const line = block.split('\n').find((l) => l.startsWith('data:'));
  if (!line) return out;
  let event: SpeechEvent;
  try {
    event = JSON.parse(line.slice(5)) as SpeechEvent;
  } catch {
    return out;
  }
  for (const part of event.candidates?.[0]?.content?.parts ?? []) {
    if (!part.inlineData?.data) continue;
    out.audio.push(fromBase64(part.inlineData.data));
    out.mime ||= part.inlineData.mimeType ?? '';
  }
  if (event.usageMetadata) out.usage = event.usageMetadata;
  return out;
}

/**
 * Vertex's SSE in, the line's raw PCM out, as it arrives.
 *
 * The network cuts the stream wherever it likes — mid-event, mid-base64,
 * between a CR and its LF — so text is buffered to the next blank line before
 * an event is read. Output is kept to whole 16-bit samples: an odd byte is
 * held for the next chunk, because a half sample shifts every sample after it
 * and the student hears static instead of a voice.
 *
 * USAGE IS BOOKED HOWEVER THE STREAM ENDS (overnight review #4/#18/#37). It
 * used to be booked only in `flush`, which never runs when the browser walks
 * away — and the classroom cancels constantly: every next line, a primed line
 * dropped, a pause, a raised hand, a halt. Vertex had still generated and
 * billed that audio. `cancel` (the reader cancelled, or the writer aborted)
 * books what was sent so far; a flag keeps it to one booking.
 */
export function sseToPcm(
  onDone?: (usage: SpeechUsage) => void,
  limits: { maxAudioBytes?: number } = {},
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let text = '';
  let odd: number | null = null;
  let audioBytes = 0;
  let promptTokens: number | undefined;
  let outputTokens: number | undefined;
  let booked = false;
  let capped = false;
  const book = (): void => {
    if (booked) return;
    booked = true;
    onDone?.({
      ...(promptTokens !== undefined ? { promptTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      audioBytes,
    });
  };

  const emit = (chunks: Uint8Array[], controller: TransformStreamDefaultController<Uint8Array>): void => {
    for (const chunk of chunks) {
      if (capped) return;
      let bytes = chunk;
      if (odd !== null) {
        const joined = new Uint8Array(bytes.byteLength + 1);
        joined[0] = odd;
        joined.set(bytes, 1);
        bytes = joined;
        odd = null;
      }
      if (bytes.byteLength % 2 === 1) {
        odd = bytes[bytes.byteLength - 1];
        bytes = bytes.slice(0, bytes.byteLength - 1);
      }
      const room = limits.maxAudioBytes === undefined ? Infinity : limits.maxAudioBytes - audioBytes;
      if (bytes.byteLength > room) {
        // Whole samples only, then the line is over: the rest is not played,
        // and ending the stream ends the request that was making it.
        bytes = bytes.slice(0, Math.max(0, room - (room % 2)));
        capped = true;
      }
      if (bytes.byteLength > 0) {
        audioBytes += bytes.byteLength;
        controller.enqueue(bytes);
      }
      if (capped) {
        book();
        controller.terminate();
        return;
      }
    }
  };

  const drain = (controller: TransformStreamDefaultController<Uint8Array>, final: boolean): void => {
    text = text.replace(/\r/g, '');
    let cut: number;
    while ((cut = text.indexOf('\n\n')) >= 0) {
      const event = readEvent(text.slice(0, cut));
      text = text.slice(cut + 2);
      emit(event.audio, controller);
      if (event.usage) {
        promptTokens = count(event.usage.promptTokenCount) ?? promptTokens;
        outputTokens = count(event.usage.candidatesTokenCount) ?? outputTokens;
      }
    }
    if (final && text.trim() !== '') {
      const event = readEvent(text);
      text = '';
      emit(event.audio, controller);
      if (event.usage) {
        promptTokens = count(event.usage.promptTokenCount) ?? promptTokens;
        outputTokens = count(event.usage.candidatesTokenCount) ?? outputTokens;
      }
    }
  };

  // `cancel` is in the Streams standard and in Deno and Node 22, but not yet
  // in TypeScript's DOM types, hence the widened type.
  const transformer: Transformer<Uint8Array, Uint8Array> & { cancel?: (reason?: unknown) => void } = {
    transform(chunk, controller) {
      text += decoder.decode(chunk, { stream: true });
      drain(controller, false);
    },
    flush(controller) {
      text += decoder.decode();
      drain(controller, true);
      book();
    },
    cancel() {
      book();
    },
  };
  return new TransformStream<Uint8Array, Uint8Array>(transformer);
}

/** What one line cost and what to answer the browser with. */
export interface VertexSpeech {
  response: RelayResponse;
  status: number;
  promptTokens?: number;
  outputTokens?: number;
}

export interface SpeakOptions {
  /** `pcm` answers raw PCM for the Web Audio player; `wav` (default) a playable file. */
  format?: 'pcm' | 'wav';
  lang?: SpeechLanguage;
}

/**
 * One line, spoken on Vertex and COLLECTED before answering — the old-client
 * path, and the one retry when a stream refuses to start.
 *
 * Never throws: every failure is an OpenAI-shaped error body with a status,
 * which is what the other relays answer and what the browser already reads.
 * A 200 carrying no audio is a 502 — Google documents the model sometimes
 * answering text instead, and an empty WAV would play as a silence that looks
 * like success.
 */
export async function speakOnVertex(
  text: string,
  options: VertexOptions,
  speak: SpeakOptions = {},
): Promise<VertexSpeech> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const failed = (status: number, message: string): VertexSpeech => ({ status, response: fail(status, message) });

  let call: SpeechCall;
  try {
    call = await vertexSpeechCall(text, speak.lang ?? 'en', options);
  } catch (e) {
    return failed(502, `Google auth failed: ${(e as Error).message}`);
  }

  const chunks: Uint8Array[] = [];
  let mimeType = '';
  let promptTokens: number | undefined;
  let outputTokens: number | undefined;
  let size = 0;
  const limit = maxSpeechBytes(text);
  const take = (block: string): void => {
    const event = readEvent(block);
    for (const a of event.audio) {
      chunks.push(a);
      size += a.byteLength;
    }
    mimeType ||= event.mime;
    if (event.usage) {
      promptTokens = count(event.usage.promptTokenCount) ?? promptTokens;
      outputTokens = count(event.usage.candidatesTokenCount) ?? outputTokens;
    }
  };

  try {
    const res = await doFetch(call.url, {
      method: 'POST',
      headers: call.headers,
      body: call.body,
      ...(typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? { signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS) }
        : {}),
    });
    const reader = res.ok ? res.body?.getReader() : undefined;
    if (reader) {
      // Read as it comes, and stop once the line has carried its budget
      // (third review #7: this path had no cap at all).
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += decoder.decode(value, { stream: true });
        buf = buf.replace(/\r/g, '');
        let cut: number;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          take(buf.slice(0, cut));
          buf = buf.slice(cut + 2);
        }
        if (size >= limit) {
          void reader.cancel().catch(() => undefined);
          break;
        }
        if (done) {
          if (buf.trim() !== '') take(buf);
          break;
        }
      }
    }
    const raw = reader ? '' : await res.text();
    if (!res.ok) {
      let message = `Vertex speech ${res.status}`;
      try {
        message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        // Not JSON — keep the status line.
      }
      return failed(res.status, message);
    }
    if (!reader) for (const block of raw.replace(/\r/g, '').split('\n\n')) take(block);
  } catch (e) {
    // A stream that failed part-way (the timeout) still sent audio that
    // Vertex billed: book it (fifth review) — but answer 502, so the browser
    // voice says the WHOLE line rather than the child hearing half a
    // sentence (sixth review, 2026-09-29).
    return {
      ...failed(502, `Vertex speech could not be reached: ${(e as Error).message}`),
      ...(promptTokens !== undefined ? { promptTokens } : {}),
      ...(size > 0 ? { outputTokens: outputTokens ?? estimatedSpeechTokens(size) } : {}),
    };
  }

  const kept = Math.min(size, limit);
  const tokens = {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    // Vertex's own count, or an estimate from the audio when a line cut at
    // its budget ended before the event that carries it.
    ...(outputTokens !== undefined ? { outputTokens } : size > 0 ? { outputTokens: estimatedSpeechTokens(size) } : {}),
  };
  if (size === 0) return { ...failed(502, 'Vertex answered without any audio'), ...tokens };

  const pcm = new Uint8Array(kept - (kept % 2));
  let at = 0;
  for (const c of chunks) {
    if (at >= pcm.byteLength) break;
    const part = c.subarray(0, pcm.byteLength - at);
    pcm.set(part, at);
    at += part.byteLength;
  }
  const pcmOnly = speak.format === 'pcm';
  return {
    status: 200,
    response: {
      status: 200,
      headers: { 'content-type': pcmOnly ? PCM_CONTENT_TYPE : 'audio/wav' },
      body: { kind: 'bytes', value: pcmOnly ? pcm.slice(0, pcm.byteLength - (pcm.byteLength % 2)) : pcmToWav(pcm, pcmFormatOf(mimeType)) },
    },
    ...tokens,
  };
}
