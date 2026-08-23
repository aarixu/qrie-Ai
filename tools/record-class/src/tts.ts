/**
 * The synthesis boundary. Gemini today; anything else behind the same interface
 * tomorrow. Authoring time only — nothing here ever runs in the student app.
 *
 * Which voice and which model are NOT decided here: they are
 * `DEFAULT_TUTOR_VOICE` and `DEFAULT_TTS_MODEL` from `@ai-tutor/voice`, where
 * the first is the persona's `speechVoiceName` and the live doubt agent reads
 * the very same constants. The list below is only the set of names Google will
 * accept, so a typo fails in a millisecond instead of after a round trip.
 */

export interface SpeechRequest {
  /** The whole text part: director's notes plus transcript, from buildSpeechPrompt. */
  prompt: string;
  voice: string;
  model: string;
}

export interface SpeechAudio {
  /** Base64 PCM exactly as the API returned it. */
  base64: string;
  /** e.g. "audio/l16; rate=24000; channels=1" — parsed, never assumed. */
  mimeType: string;
}

export interface TtsTransport {
  synthesize(request: SpeechRequest): Promise<SpeechAudio>;
}

/**
 * The 30 prebuilt voices. Checked locally so a typo fails in a millisecond
 * rather than after a round trip, and so --voice can name the alternatives.
 * The names carry no ethnicity — they are timbre only, and the accent comes
 * from the director's notes.
 */
export const VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const;

export function isKnownVoice(name: string): boolean {
  return (VOICES as readonly string[]).includes(name);
}

/**
 * A failure worth another take rather than a dead run. Google documents that
 * the model "occasionally returns text tokens instead of audio tokens, causing
 * the server to fail the request with a 500", and there is no published rate
 * limit for this model, so a 429 is a scheduling fact rather than an error.
 */
export class TransientTtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientTtsError';
  }
}

const TRANSIENT_TEXT =
  /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|quota|rate.?limit|timed ?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i;

/**
 * A transport we did not write can only signal through its message, so the text
 * is matched as well as the type.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof TransientTtsError) return true;
  return TRANSIENT_TEXT.test(error instanceof Error ? error.message : String(error));
}

/** Daily quota is the one transient failure that will not clear inside a run. */
export function isQuotaExhausted(error: unknown): boolean {
  return /RESOURCE_EXHAUSTED|quota/i.test(error instanceof Error ? error.message : String(error));
}

export interface RetryOptions {
  /** Total attempts, not retries. Default 3. */
  attempts?: number;
  /** First backoff step; doubles each time. Default 1000ms. */
  baseDelayMs?: number;
  /** Injected so tests have no clock. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff over transient failures. Anything else throws on the first try. */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const sleep = opts.sleep ?? wait;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === attempts || !isTransient(e)) throw e;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      opts.onRetry?.({ attempt, delayMs, error: e });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

/** Pulls the audio out of a reply, and names a text-only reply for what it is. */
export function extractAudio(json: unknown): SpeechAudio {
  const doc = json as {
    error?: { message?: string; status?: string };
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  };

  if (doc.error) {
    throw new Error(`TTS API error: ${doc.error.status ?? ''} ${doc.error.message ?? ''}`.trim());
  }

  const candidate = doc.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const audio = parts.find((p) => p.inlineData?.data);

  if (!audio?.inlineData) {
    const said = parts.map((p) => p.text ?? '').join(' ').trim();
    const reason = candidate?.finishReason ? ` (finishReason: ${candidate.finishReason})` : '';
    // Text where audio should be is Google's own documented flake, so it earns
    // another take rather than killing the beat.
    throw new TransientTtsError(
      `Model returned no audio${reason}${said ? `. It said: "${said.slice(0, 200)}"` : '.'}`,
    );
  }
  return { base64: audio.inlineData.data, mimeType: audio.inlineData.mimeType };
}

export interface GeminiTtsOptions {
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected in tests; defaults to global fetch (Node 24). */
  fetchImpl?: typeof fetch;
}

function resolveKey(opts: GeminiTtsOptions): string {
  const env = opts.env ?? process.env;
  const key = opts.apiKey ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      'No API key. Set GEMINI_API_KEY (or GOOGLE_API_KEY) — get one free at https://aistudio.google.com/apikey',
    );
  }
  return key;
}

/**
 * The key is resolved when the transport is built, not per call: a run that
 * cannot possibly work should fail before the first beat rather than halfway
 * through one.
 */
export function createGeminiTts(opts: GeminiTtsOptions = {}): TtsTransport {
  const key = resolveKey(opts);
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    async synthesize({ prompt, voice, model }: SpeechRequest): Promise<SpeechAudio> {
      const res = await doFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
                // A hint, not the lever: the accent is carried by the director's
                // notes. Harmless if the model ignores it.
                languageCode: 'en-IN',
              },
            },
          }),
        },
      );

      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = (json as { error?: { message?: string } }).error?.message ?? res.statusText;
        const text = `TTS API ${res.status}: ${message}`;
        if (res.status === 429 || res.status >= 500) throw new TransientTtsError(text);
        throw new Error(text);
      }
      return extractAudio(json);
    },
  };
}
