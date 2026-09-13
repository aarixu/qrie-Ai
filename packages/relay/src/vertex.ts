import type { TokenSource } from './googleAuth.ts';

/**
 * VERTEX, SPEAKING THE SHAPE THE APP ALREADY SPEAKS.
 *
 * The app posts OpenAI chat completions to /api/llm and reads `choices[0]
 * .message`. Vertex takes `contents` and returns `candidates`. Something has
 * to translate, and the only sane place is HERE — the relay is already the one
 * component that knows which provider is behind the app, and moving the
 * boundary into the browser would mean the phone knows too.
 *
 * So nothing in apps/classroom changes. `createBrowserLlm`, the image artist,
 * the vision adapter and every test around them keep working, and the provider
 * becomes a server-side decision — which is what it always should have been.
 *
 * THE MODELS. The app names them the way OpenRouter does, `google/gemini-3.7
 * -flash`. Vertex wants the bare name, so the prefix is dropped. Measured on
 * the real endpoint, at location `global` — regional hosts return 404 for
 * every one of these:
 *
 *   gemini-3.8-flash        1.5s     gemini-3.1-flash-lite   0.8s
 *   gemini-3.7-flash        2.4s     gemini-3.1-pro-preview  2.6s
 *   gemini-3-pro-image       31s     gemini-3.1-flash-image  9.9s
 *
 * gemini-3.7-flash is worth a note: on AI Studio it never answers at all —
 * three calls aborted at 30 and 45 seconds. On Vertex it replies in 2.4s. The
 * model was never the problem; the free tier was.
 */

/**
 * THE ONLY MODELS A BROWSER MAY NAME.
 *
 * The model comes out of the request body, and the request body comes from a
 * student's phone. Without a list, an identity that costs nothing can name
 * anything Google publishes — gemini-3-pro-image takes thirty-one seconds and
 * bills like it, and a pro model bills several times a flash one. The app
 * names exactly four models, in apps/classroom/src/lib/liveClass.ts; a request
 * for a fifth did not come from the app.
 *
 * Adding one is a deliberate line here, which is the point.
 */
export const ALLOWED_MODELS: ReadonlySet<string> = new Set([
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-image',
]);

/**
 * A CEILING ON WHAT ONE CALL MAY COST.
 *
 * The OpenRouter path has capped max_tokens since a batch of lesson prep died
 * on it — an uncapped call is refused on a low balance even when the reply is
 * three hundred tokens. The Vertex path was written without that cap, which
 * put the regression straight back and pointed it at a credit balance rather
 * than a prepaid one.
 */
export const CAP_OUTPUT_TOKENS = 24_000;

/**
 * And a ceiling on what one call may SEND.
 *
 * Nothing else limited this. A prepared class's planner prompt is a few
 * thousand tokens; a megabyte of text posted three hundred times a day, from
 * as many free anonymous identities as somebody cares to make, is billed
 * input. 256 KB is comfortably above every prompt this app builds, including
 * a vision call carrying a picture.
 */
export const MAX_REQUEST_BYTES = 256 * 1024;

/** Location, not region. Every regional host 404s on these models. */
export const LOCATION = 'global';
export const HOST = 'https://aiplatform.googleapis.com';

/**
 * An image model is told apart by its NAME, because the app cannot say so.
 *
 * `createBrowserImageArtist` posts the same shape as a text completion — one
 * user message and nothing else. Vertex needs `responseModalities: ["IMAGE"]`
 * or it writes a description of the picture instead of drawing it, which is a
 * failure that looks like success all the way to a blank board.
 */
export const isImageModel = (model: string): boolean => /-image(?:-|$)/.test(model);

/** OpenRouter names models `google/x`; Vertex wants `x`. */
export const bareModel = (model: string): string => model.replace(/^[a-z0-9-]+\//, '');

// ------------------------------------------------------------ the shapes --

interface OpenAiPart {
  type?: string;
  text?: string;
  image_url?: { url?: string };
}

interface OpenAiMessage {
  role?: string;
  content?: string | OpenAiPart[];
}

export interface OpenAiChat {
  model?: string;
  messages?: OpenAiMessage[];
  response_format?: { type?: string };
  max_tokens?: number;
  temperature?: number;
}

interface VertexPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

export interface VertexBody {
  systemInstruction?: { parts: VertexPart[] };
  contents: { role: string; parts: VertexPart[] }[];
  generationConfig: Record<string, unknown>;
}

/**
 * A `data:` URL to the inline part Vertex takes.
 *
 * Null for anything else — an http URL among other things, which Vertex will
 * not fetch for us. The vision adapter always sends `data:` because the
 * picture is already in hand, so this is a guard rather than a path.
 */
export function inlineFromDataUrl(url: string): VertexPart | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  if (!match) return null;
  return { inline_data: { mime_type: match[1], data: match[2] } };
}

// ------------------------------------------------------------- translation --

export function toVertexBody(chat: OpenAiChat): VertexBody {
  const system: VertexPart[] = [];
  const contents: VertexBody['contents'] = [];

  for (const message of chat.messages ?? []) {
    const parts: VertexPart[] = [];
    if (typeof message.content === 'string') {
      if (message.content) parts.push({ text: message.content });
    } else {
      for (const part of message.content ?? []) {
        if (part.type === 'image_url' || part.image_url) {
          const inline = part.image_url?.url ? inlineFromDataUrl(part.image_url.url) : null;
          if (inline) parts.push(inline);
        } else if (part.text) {
          parts.push({ text: part.text });
        }
      }
    }
    if (parts.length === 0) continue;

    if (message.role === 'system') {
      system.push(...parts);
      continue;
    }
    // Vertex says "model" where OpenAI says "assistant", and knows no other
    // roles. Anything unexpected is treated as the student talking, which is
    // the safe reading: it gets answered rather than silently dropped.
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }

  const model = bareModel(chat.model ?? '');
  const generationConfig: Record<string, unknown> = {};

  if (chat.response_format?.type === 'json_object') {
    generationConfig.responseMimeType = 'application/json';
  }
  // Capped whether or not the caller asked for one, and a caller asking for
  // more does not get more.
  generationConfig.maxOutputTokens = Math.min(
    typeof chat.max_tokens === 'number' && chat.max_tokens > 0 ? chat.max_tokens : CAP_OUTPUT_TOKENS,
    CAP_OUTPUT_TOKENS,
  );
  if (typeof chat.temperature === 'number') generationConfig.temperature = chat.temperature;
  if (isImageModel(model)) {
    generationConfig.responseModalities = ['IMAGE'];
    // A picture is not JSON, and asking for both gets a refusal.
    delete generationConfig.responseMimeType;
  }

  return {
    ...(system.length > 0 ? { systemInstruction: { parts: system } } : {}),
    contents,
    generationConfig,
  };
}

interface VertexReply {
  candidates?: {
    content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] };
    finishReason?: string;
  }[];
  usageMetadata?: Record<string, number>;
  error?: { message?: string };
}

export interface OpenAiReply {
  choices: {
    message: { role: 'assistant'; content: string; images?: { image_url: { url: string } }[] };
    finish_reason: string;
  }[];
  model: string;
  usage?: Record<string, number>;
}

export function toOpenAiReply(reply: VertexReply, model: string): OpenAiReply {
  const parts = reply.candidates?.[0]?.content?.parts ?? [];

  const text = parts.map((p) => p.text ?? '').join('');
  const images = parts
    .filter((p) => p.inlineData?.data)
    .map((p) => ({
      image_url: {
        url: `data:${p.inlineData!.mimeType ?? 'image/png'};base64,${p.inlineData!.data}`,
      },
    }));

  return {
    model,
    choices: [
      {
        message: {
          role: 'assistant',
          content: text,
          ...(images.length > 0 ? { images } : {}),
        },
        finish_reason: reply.candidates?.[0]?.finishReason?.toLowerCase() ?? 'stop',
      },
    ],
    ...(reply.usageMetadata ? { usage: reply.usageMetadata } : {}),
  };
}

// ------------------------------------------------------------- the call ----

export function vertexUrl(projectId: string, model: string, location = LOCATION): string {
  return (
    `${HOST}/v1/projects/${projectId}/locations/${location}` +
    `/publishers/google/models/${bareModel(model)}:generateContent`
  );
}

export interface VertexOptions {
  tokens: TokenSource;
  fetch?: typeof globalThis.fetch;
  location?: string;
  /** Test seam, so the backoff below can be proven without waiting for it. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * HOW LONG TO WAIT WHEN VERTEX SAYS "NOT NOW".
 *
 * A 429 from Vertex is RESOURCE_EXHAUSTED: the request never reached a model,
 * nothing was charged, and in a second or two it will very likely succeed.
 * Passing it through untouched is what this relay did, and it meant a class
 * prep — about forty calls in two minutes, several of them at once — fell over
 * whenever the project's per-minute quota was busy. That was found by
 * measuring a class, not by a test: the run died 138 seconds in, having
 * already spent the money for everything before it.
 *
 * Three attempts and no more. The caller is a student watching a spinner, and
 * a class that starts four seconds late is very much better than one that does
 * not start — but a class that hangs for a minute is not.
 */
const BUSY = new Set([408, 429, 502, 503, 504]);
const BACKOFF_MS = [1_000, 3_000];

export interface VertexAnswer {
  status: number;
  body: unknown;
}

/**
 * One completion, in and out in the app's own shape.
 *
 * Errors come back as an OpenAI-shaped error body rather than a throw, because
 * that is what the browser side already reads: `relayError` and the
 * `data.error` check in browserLlm both expect it, and a class that fails
 * should fail the same way whichever provider was behind it.
 */
export async function completeOnVertex(
  chat: OpenAiChat,
  options: VertexOptions,
): Promise<VertexAnswer> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const model = chat.model ?? '';
  if (!model) return { status: 400, body: { error: { message: 'no model named' } } };
  if (!ALLOWED_MODELS.has(bareModel(model))) {
    return { status: 400, body: { error: { message: `this relay does not serve ${model}` } } };
  }

  let token: string;
  try {
    token = await options.tokens.token();
  } catch (e) {
    // A credential problem is ours, not the caller's: 502, and the message
    // says which half failed so a deploy can be checked rather than guessed at.
    return {
      status: 502,
      body: { error: { message: `Google auth failed: ${(e as Error).message}` } },
    };
  }

  const url = vertexUrl(options.tokens.projectId, model, options.location ?? LOCATION);
  const body = JSON.stringify(toVertexBody(chat));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let response: Awaited<ReturnType<typeof doFetch>>;
  let reply: VertexReply;
  for (let attempt = 0; ; attempt += 1) {
    response = await doFetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body,
    });
    reply = (await response.json().catch(() => ({}))) as VertexReply;
    if (response.ok || !BUSY.has(response.status) || attempt >= BACKOFF_MS.length) break;
    // Vertex's own advice first, if it gave any, clamped so a long one cannot
    // hold a student's class open past the point they would have given up.
    const advised = Number(response.headers?.get?.('retry-after') ?? '');
    const wait = Number.isFinite(advised) && advised > 0
      ? Math.min(advised * 1_000, 5_000)
      : BACKOFF_MS[attempt];
    await sleep(wait);
  }

  if (!response.ok) {
    return {
      status: response.status,
      body: { error: { message: reply.error?.message ?? `Vertex ${response.status}` } },
    };
  }
  return { status: 200, body: toOpenAiReply(reply, model) };
}
