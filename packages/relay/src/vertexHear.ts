import { fail, type RelayResponse } from './relays.ts';
import { HOST, LOCATION, type VertexOptions } from './vertex.ts';

/**
 * HER EAR, ON VERTEX (Aarav, 2026-09-28: no OpenRouter and no Deepgram).
 *
 * The student's spoken answer goes to Gemini with an instruction to write it
 * down exactly — Hinglish in ROMAN script, never Devanagari, nothing
 * translated, corrected or answered — and comes back in the same `{text}`
 * shape the OpenRouter transcriber answered, so nothing in the app changes.
 *
 * MEASURED 2026-09-29 on three TTS-made answers (two Hinglish, one English):
 * gemini-3.1-flash-lite returned all three exactly, in Roman script, in
 * 1.7-2.4 s; gemini-3.7-flash also exact, slower, 2.3-4.6 s. Clean
 * synthetic audio, so accuracy on a real phone in a real room is
 * UNVERIFIED.
 *
 * Roman script is load-bearing beyond reading: the distress screen's word
 * lists are Latin-script, so a Devanagari transcript would pass them unseen.
 */

export const VERTEX_HEAR_MODEL = 'gemini-3.1-flash-lite';

const INSTRUCTION =
  "Transcribe the student's speech in this audio exactly as spoken. The student is an Indian school student and may speak English, Hindi, or a mix (Hinglish). " +
  'Write Hindi words in Roman script as Hinglish, never in Devanagari. ' +
  'Do not translate, correct, summarise or answer. If there is no speech, output nothing. Output only the transcript.';

const HEAR_TIMEOUT_MS = 15_000;

export interface VertexHeard {
  response: RelayResponse;
  status: number;
  promptTokens?: number;
  outputTokens?: number;
}

/** Bytes to base64 without a Node Buffer, in slices so a long answer cannot blow the call stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const count = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);

/** One answer, transcribed. Never throws; a failure is a status and an error body. */
export async function hearOnVertex(
  audio: Uint8Array,
  contentType: string,
  options: VertexOptions,
): Promise<VertexHeard> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const failed = (status: number, message: string): VertexHeard => ({ status, response: fail(status, message) });

  let token: string;
  try {
    token = await options.tokens.token();
  } catch (e) {
    return failed(502, `Google auth failed: ${(e as Error).message}`);
  }

  const url =
    `${HOST}/v1/projects/${options.tokens.projectId}/locations/${options.location ?? LOCATION}` +
    `/publishers/google/models/${VERTEX_HEAR_MODEL}:generateContent`;
  let reply: {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
    error?: { message?: string };
  };
  let status: number;
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: INSTRUCTION },
              { inlineData: { mimeType: contentType.split(';')[0].trim() || 'audio/wav', data: toBase64(audio) } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 300, thinkingConfig: { thinkingLevel: 'LOW' } },
      }),
      ...(typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? { signal: AbortSignal.timeout(HEAR_TIMEOUT_MS) }
        : {}),
    });
    status = res.status;
    reply = (await res.json().catch(() => ({}))) as typeof reply;
  } catch (e) {
    return failed(502, `Vertex could not be reached: ${(e as Error).message}`);
  }
  if (status !== 200) return failed(status, reply.error?.message ?? `Vertex ${status}`);

  const text = (reply.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
  const promptTokens = count(reply.usageMetadata?.promptTokenCount);
  const outputTokens = count(reply.usageMetadata?.candidatesTokenCount);
  return {
    status: 200,
    response: { status: 200, headers: { 'content-type': 'application/json' }, body: { kind: 'json', value: { text } } },
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}
