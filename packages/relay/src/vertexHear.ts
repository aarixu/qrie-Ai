import { fail, type RelayResponse } from './relays.ts';
import { HOST, LOCATION, type VertexOptions } from './vertex.ts';
import { romaniseDevanagari } from './romanise.ts';

/**
 * HER EAR, ON VERTEX (Aarav, 2026-09-28: no OpenRouter and no Deepgram).
 *
 * The student's spoken answer goes to Gemini with an instruction to write it
 * down exactly — Hinglish in ROMAN script, never Devanagari, nothing
 * translated, corrected or answered — and comes back in the same `{text}`
 * shape the OpenRouter transcriber answered, so nothing in the app changes.
 *
 * MEASURED 2026-09-30 (tools/voice-probe/ear-variants.mjs, 8 synthetic
 * student answers, 3 English and 5 Hinglish, straight to Vertex from India):
 *   - the instruction this file used to send in the user turn, thinking LOW:
 *     median 2.25 s, one answer took 29 s, mean word error 0.40, and 3 of
 *     the 5 Hinglish answers came back in DEVANAGARI ("pata nahi, ek hint do
 *     na" as "अ पता नहीं एक ही तो ना");
 *   - the system instruction below, with worked Roman examples, thinking
 *     off (`thinkingBudget: 0`): median 1.36 s, slowest 1.8 s, mean word
 *     error 0.03, none in Devanagari.
 * Same model. gemini-2.5-flash-lite and 2.5-flash were no faster and
 * misheard "hint"; 3.8-flash heard everything but took 2.9 s. The Mumbai
 * region (asia-south1) does not serve these models (404). Clean synthetic
 * audio: accuracy on a real phone in a real room is still UNVERIFIED.
 *
 * Roman script is load-bearing beyond reading: the distress screen's word
 * lists are Latin-script, so a Devanagari transcript would pass them unseen.
 * That is why any Devanagari that still comes back is spelled out in Roman
 * letters here (romanise.ts) before the transcript leaves the relay.
 *
 * THE SLOW TAIL. One call in eight took 29 s on the old settings. A second,
 * identical call is sent if the first has not answered in HEDGE_AFTER_MS,
 * and whichever answers first is used; the other is aborted. The second
 * call also goes at once when the first fails with a status a retry can
 * fix. Both calls may be billed (a few hundred tokens of audio each); only
 * the one used is counted in the usage row, so a hedged answer is
 * under-counted by at most one call.
 */

export const VERTEX_HEAR_MODEL = 'gemini-3.1-flash-lite';

export const HEAR_INSTRUCTION = [
  'You are a speech-to-text engine for an Indian school tutoring app. You output ONLY the words spoken, nothing else.',
  'The speaker is a student aged 11-18 who speaks English, Hindi, or Hinglish (a mix).',
  'ALWAYS write in the Latin alphabet (a-z). Write every Hindi word the way Indians type it in chats, in Roman letters: "मुझे लगता है" -> "mujhe lagta hai", "पता नहीं" -> "pata nahi", "हां समझ आ गया" -> "haan samajh aa gaya". NEVER output Devanagari characters.',
  'Keep English words in English spelling (hint, energy, oxygen, cramp). Do not translate, correct grammar, summarise or answer the question.',
  'If there is no speech, output nothing.',
].join('\n');

/** How long one call may take before it is given up. */
const HEAR_TIMEOUT_MS = 8_000;
/** How long the first call has before a second, identical one is sent. */
export const HEDGE_AFTER_MS = 2_500;
/** Statuses a second call can reasonably fix. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

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

type Reply = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
  error?: { message?: string };
};

/** One answer, transcribed. Never throws; a failure is a status and an error body. */
export async function hearOnVertex(
  audio: Uint8Array,
  contentType: string,
  options: VertexOptions & { hedgeAfterMs?: number },
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
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: HEAR_INSTRUCTION }] },
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: contentType.split(';')[0].trim() || 'audio/wav', data: toBase64(audio) } }],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } },
  });

  const calls: AbortController[] = [];
  const call = async (): Promise<VertexHeard> => {
    const abort = new AbortController();
    calls.push(abort);
    const timer = setTimeout(() => abort.abort(new Error('timed out')), HEAR_TIMEOUT_MS);
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: payload,
        signal: abort.signal,
      });
      const reply = (await res.json().catch(() => ({}))) as Reply;
      if (res.status !== 200) return failed(res.status, reply.error?.message ?? `Vertex ${res.status}`);
      return heardFrom(reply);
    } catch (e) {
      return failed(502, `Vertex could not be reached: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  };

  const hedgeAfter = options.hedgeAfterMs ?? HEDGE_AFTER_MS;
  const settled = await new Promise<VertexHeard>((resolve) => {
    let pending = 0;
    let done = false;
    let second = false;
    let lastFailure: VertexHeard | null = null;
    let hedge: ReturnType<typeof setTimeout> | undefined;
    const finish = (out: VertexHeard): void => {
      done = true;
      clearTimeout(hedge);
      resolve(out);
    };
    const launch = (): void => {
      pending++;
      void call().then((out) => {
        pending--;
        if (done) return;
        if (out.status === 200) return finish(out);
        lastFailure = out;
        // A first call that failed in a way a second can fix: the second goes now.
        if (!second && RETRYABLE.has(out.status)) {
          second = true;
          clearTimeout(hedge);
          return launch();
        }
        if (pending === 0) finish(lastFailure);
      });
    };
    launch();
    hedge = setTimeout(() => {
      if (done || second) return;
      second = true;
      launch();
    }, hedgeAfter);
  });
  // Whichever call lost is not waited for.
  for (const abort of calls) abort.abort(new Error('answered'));
  return settled;
}

function heardFrom(reply: Reply): VertexHeard {
  const text = romaniseDevanagari(
    (reply.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim(),
  );
  const promptTokens = count(reply.usageMetadata?.promptTokenCount);
  const outputTokens = count(reply.usageMetadata?.candidatesTokenCount);
  return {
    status: 200,
    response: { status: 200, headers: { 'content-type': 'application/json' }, body: { kind: 'json', value: { text } } },
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}
