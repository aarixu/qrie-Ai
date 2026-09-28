import { fail, type RelayResponse } from './relays.ts';
import { HOST, LOCATION, type VertexOptions } from './vertex.ts';

/**
 * HER VOICE, FROM VERTEX, WHEN THE VENDOR CANNOT GIVE IT.
 *
 * Speech normally goes to Deepgram aura-2 through OpenRouter, which is
 * prepaid. The day its credits run out, or it is down, every spoken line
 * fails and the class falls to the browser's robot voice. Vertex is already
 * paid for and already holds the models, and Gemini speaks — so the relay
 * asks it instead (Aarav, 2026-09-28). This file is only that call; WHEN it is
 * made is decided in handler.ts, and the switch itself happens in the host,
 * which is the only party that sees the vendor's status.
 *
 * MEASURED on 2026-09-28 against project-dd876d44 at location `global`, one
 * 85-character line: streamed, the first audio arrived at 1.38-1.48 s and the
 * whole 5.5-5.8 s of audio at 3.0-3.6 s (three runs); the unstreamed
 * `generateContent` took 4.2-4.9 s. So this collects the stream and answers
 * one WAV: the first sound reaches the student when the whole line is ready,
 * about 0.55x the line's own length. Streaming the WAV out as it arrives would
 * bring that to ~1.4 s, and is left undone because a WAV of unknown length is
 * the one part of this no test here can show every phone will play.
 *
 * COST: $1/M input tokens, $20/M audio output tokens; the three runs billed
 * 169-187 audio tokens for 5.5-5.8 s, ~32 tokens a second. That is about
 * Rs 0.06 per second of speech — roughly 1.4x what aura-2 costs for the same
 * line — which is why this is the fallback and not the voice.
 */

/** The model record-class and `@ai-tutor/voice` already use. */
export const VERTEX_SPEECH_MODEL = 'gemini-3.1-flash-tts-preview';

/**
 * The persona's own voice (`TUTOR.speechVoiceName` in packages/persona) —
 * the voice `class10-blood` was recorded in. Copied, not imported, because
 * the Edge Function resolves this package by relative path and cannot reach
 * a workspace alias; tests/vertexSpeech.test.ts fails the day they differ.
 *
 * NOTE what that means in a class: the vendor's voice is aura-2 Thalia, a
 * different woman. A line that falls back is spoken by Sulafat, so a class
 * whose vendor is failing intermittently changes voice between lines.
 */
export const VERTEX_SPEECH_VOICE = 'Sulafat';

/** A student is waiting on this line; past this the browser's voice is better than more waiting. */
const SPEECH_TIMEOUT_MS = 20_000;

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

/** What one line cost and what to answer the browser with. */
export interface VertexSpeech {
  response: RelayResponse;
  status: number;
  promptTokens?: number;
  outputTokens?: number;
}

const count = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);

/**
 * One line, spoken on Vertex, answered as a WAV.
 *
 * Never throws: every failure is an OpenAI-shaped error body with a status,
 * which is what the other relays answer and what the browser already reads.
 * A 200 carrying no audio is a 502 — Google documents the model sometimes
 * answering text instead, and an empty WAV would play as a silence that looks
 * like success.
 */
export async function speakOnVertex(text: string, options: VertexOptions): Promise<VertexSpeech> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const failed = (status: number, message: string): VertexSpeech => ({ status, response: fail(status, message) });

  let token: string;
  try {
    token = await options.tokens.token();
  } catch (e) {
    return failed(502, `Google auth failed: ${(e as Error).message}`);
  }

  const url =
    `${HOST}/v1/projects/${options.tokens.projectId}/locations/${options.location ?? LOCATION}` +
    `/publishers/google/models/${VERTEX_SPEECH_MODEL}:streamGenerateContent?alt=sse`;

  let raw: string;
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: VERTEX_SPEECH_VOICE } },
            // A hint, not the lever: harmless if the model ignores it.
            languageCode: 'en-IN',
          },
        },
      }),
      ...(typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? { signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS) }
        : {}),
    });
    raw = await res.text();
    if (!res.ok) {
      let message = `Vertex speech ${res.status}`;
      try {
        message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        // Not JSON — keep the status line.
      }
      return failed(res.status, message);
    }
  } catch (e) {
    return failed(502, `Vertex speech could not be reached: ${(e as Error).message}`);
  }

  const chunks: Uint8Array[] = [];
  let mimeType = '';
  let promptTokens: number | undefined;
  let outputTokens: number | undefined;
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const line = block.split(/\r?\n/).find((l) => l.startsWith('data:'));
    if (!line) continue;
    let event: SpeechEvent;
    try {
      event = JSON.parse(line.slice(5)) as SpeechEvent;
    } catch {
      continue;
    }
    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
      if (!part.inlineData?.data) continue;
      chunks.push(fromBase64(part.inlineData.data));
      mimeType ||= part.inlineData.mimeType ?? '';
    }
    if (event.usageMetadata) {
      promptTokens = count(event.usageMetadata.promptTokenCount) ?? promptTokens;
      outputTokens = count(event.usageMetadata.candidatesTokenCount) ?? outputTokens;
    }
  }

  const tokens = {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
  const size = chunks.reduce((n, c) => n + c.byteLength, 0);
  if (size === 0) return { ...failed(502, 'Vertex answered without any audio'), ...tokens };

  const pcm = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    pcm.set(c, at);
    at += c.byteLength;
  }
  return {
    status: 200,
    response: {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
      body: { kind: 'bytes', value: pcmToWav(pcm, pcmFormatOf(mimeType)) },
    },
    ...tokens,
  };
}
