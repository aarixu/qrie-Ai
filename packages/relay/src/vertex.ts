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
 * And a ceiling on the TEXT one call may send.
 *
 * Nothing else limited this. A prepared class's planner prompt is a few
 * thousand tokens; a megabyte of text posted three hundred times a day, from
 * as many free anonymous identities as somebody cares to make, is billed
 * input. 256 KB is comfortably above every prompt this app builds.
 *
 * A picture is not counted here: see MAX_PICTURE_BYTES.
 */
export const MAX_REQUEST_BYTES = 256 * 1024;

/**
 * A PICTURE IS NOT TEXT, AND IS NOT BILLED LIKE TEXT.
 *
 * A vision call carries the picture it looks at as a `data:` URL, and a
 * picture the image model draws is about 1.2 MB of one. Under the one 256 KB
 * ceiling every such call was refused, so no part of any generated picture was
 * ever found (a small-intestine class, 2026-10-06: every name beside its villus
 * with no line to anything). The model bills a picture by its tiles, not its
 * bytes, so a picture's size is not what the text ceiling guards against. One
 * picture a call, as every look this app makes is at one picture, up to 4 MB.
 */
export const MAX_PICTURE_BYTES = 4 * 1024 * 1024;
export const MAX_PICTURES = 1;

/** A `data:` URL of a picture, the only kind of inline part counted as one. */
const PICTURE_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,/;

/**
 * Why this call is larger than anything the app sends, or null.
 *
 * `bodyBytes` is the whole request; the pictures in `chat` are taken out of it
 * and what is left is held to MAX_REQUEST_BYTES. Base64 needs no escaping in
 * JSON, so a picture's URL is as long in the body as it is here.
 */
export function oversized(bodyBytes: number, chat: unknown): string | null {
  const pictures: number[] = [];
  const messages = (chat as { messages?: unknown })?.messages;
  for (const message of Array.isArray(messages) ? messages : []) {
    const content = (message as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const url = (part as OpenAiPart)?.image_url?.url;
      if (typeof url === 'string' && PICTURE_URL.test(url)) pictures.push(url.length);
    }
  }
  if (pictures.length > MAX_PICTURES) return 'that request carries more pictures than this app sends';
  if (pictures.some((n) => n > MAX_PICTURE_BYTES)) return 'that picture is larger than any this app sends';
  if (bodyBytes - pictures.reduce((sum, n) => sum + n, 0) > MAX_REQUEST_BYTES) {
    return 'that request is larger than anything this app sends';
  }
  return null;
}

/**
 * THE PROVIDER'S OWN HARM FILTERS, NAMED ON EVERY CALL THIS RELAY MAKES.
 *
 * This block was absent, so every category ran at whatever Vertex's default
 * is for that model — a setting nobody in this repo chose, wrote down or can
 * point to, on the path the planner, the judge, the doubt tutor and the artist
 * all take. The live voice path had already named its own on purpose
 * (apps/classroom/src/lib/liveAgent.ts, `buildSetupFrame`), so the same child
 * got a stated filter in one mode and an unstated one in the other.
 *
 * BLOCK_ONLY_HIGH, and deliberately no stricter, for the reason liveAgent.ts
 * gives: these students study reproduction, the nervous system, the effects of
 * alcohol and the history of two world wars. A filter tuned to spare a general
 * audience every mention of harm refuses a Class 10 Biology chapter, and a
 * tutor who will not teach the syllabus is not safer, only useless. This is
 * for the narrow, serious cases; the persona and the screen in packages/safety
 * are the other layers, not this one.
 *
 * On EVERY body `toVertexBody` builds, the image model included. What that
 * covers on the image model is UNVERIFIED: these are the four TEXT
 * categories. Vertex is reported to take a separate set for a drawn picture —
 * HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT, _IMAGE_HATE, _IMAGE_HARASSMENT and
 * _IMAGE_DANGEROUS_CONTENT — which this list does not name. Nobody has
 * confirmed from this repo that those exist or what they change, so the
 * filter on the picture itself may still run at a default nobody chose. The
 * live image call due before deploy should also try those four at
 * BLOCK_ONLY_HIGH on gemini-3.1-flash-image, and they belong here if Vertex
 * accepts them.
 *
 * UNVERIFIED, and both are the plan's own acceptance test for A7: that a set
 * of ordinary Class 10 syllabus lines passes at this threshold while a harmful
 * set is blocked, and that gemini-3.1-flash-image accepts the field at all
 * rather than refusing the request. Neither has been run against Vertex; this
 * was built offline.
 */
export const SAFETY_SETTINGS: readonly { category: string; threshold: string }[] = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
];

/**
 * WHAT THE RELAY ANSWERS WHEN A FILTER FIRES.
 *
 * Before this, a blocked call reached the browser as an empty reply (a
 * refused prompt carries no candidate at all) or as the half-written text the
 * filter stopped — and that half is precisely the part judged unfit to finish.
 * Now the relay always answers this line instead, with finish_reason
 * BLOCKED_FINISH below: fixed, kind, and steering back to the lesson, with
 * nothing of what was blocked in it.
 *
 * WHO SPEAKS IT. The one client that reads BLOCKED_FINISH is the typed doubt
 * tutor, which then says its own copy of this line
 * (apps/classroom/src/lib/geminiAgent.ts, FILTERED_REPLY_LINE). Nothing else
 * in apps/classroom reads the finish_reason, so every other caller gets this
 * line as ordinary reply text and handles it by its own rules; for the JSON
 * callers, that is the next paragraph.
 *
 * NO BRACES, and that is load-bearing. The class planner asks for JSON and
 * rescues a messy reply by slicing between its outermost braces (class-prep
 * `parsePlan`; the reviewer's `parseVerdict` does the same). A line with none
 * in it gives them nothing to slice, so they read it as unreadable, ask once
 * more, and then throw the plain error they already throw on garbled JSON —
 * the planner never builds a lesson out of it. The test that says so runs the
 * real `prepareClass`.
 */
export const BLOCKED_LINE = "Let's keep our class on the lesson — ask me anything about it!";

/**
 * How a client tells a block from an answer: OpenAI's own finish_reason for
 * exactly this. The typed doubt tutor reads it (geminiAgent.ts,
 * `createTransport`): on it, she says her own copy of BLOCKED_LINE instead of
 * parsing the reply, and takes the blocked question out of the history she
 * sends with the next one. Nothing else in apps/classroom reads it yet.
 */
export const BLOCKED_FINISH = 'content_filter';

/**
 * The finish reasons that are a policy stop rather than an answer.
 *
 * SAFETY is the four categories above. The rest are Google's other harm and
 * policy stops, which SAFETY_SETTINGS does not control. RECITATION is NOT here: it
 * is a copyright stop, not a harm one, and MAX_TOKENS is an answer that ran
 * long. Both pass through as they always have.
 */
const BLOCKING_FINISH: ReadonlySet<string> = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
]);

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
  /**
   * HOW HARD THE MODEL SHOULD THINK, IN OPENAI'S WORD FOR IT.
   *
   * Gemini's thinking tokens bill at the OUTPUT rate and they are not small.
   * Measured over one class: the judge spent 2,460 prompt tokens, 296 output
   * tokens and 2,353 THINKING tokens deciding whether four spoken answers
   * matched a known option, so three quarters of that bill bought reasoning
   * nobody reads and the student never hears.
   *
   * Left undefined, nothing is sent and the model does whatever it does today
   * — so adding this changes no existing caller. 'none' maps to a budget of
   * zero, which is the only setting that actually stops the spend.
   */
  reasoning_effort?: 'none' | 'low' | 'medium' | 'high';
}

interface VertexPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

export interface VertexBody {
  systemInstruction?: { parts: VertexPart[] };
  contents: { role: string; parts: VertexPart[] }[];
  generationConfig: Record<string, unknown>;
  safetySettings: { category: string; threshold: string }[];
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

  /**
   * HOW HARD TO THINK — and Gemini 3 renamed the dial.
   *
   * Thinking tokens bill at the OUTPUT rate, which is five times input, and on
   * this workload they were the bill: measured over one class, the judge spent
   * 2,460 prompt tokens and 296 output tokens against 2,353 THINKING tokens, so
   * three quarters of what it cost bought reasoning nobody reads and the
   * student never hears, on a question whose right answer is committed to this
   * repo.
   *
   * This sent `thinkingBudget`, which is the 2.5-era integer scale. Every model
   * this relay serves is a 3.x, and Google's docs are explicit that a Gemini 3
   * model takes `thinkingLevel` and **errors if both are present**. So the one
   * thing a budget of zero could not do on a 3.x name was turn thinking off:
   * measured, `thinkingBudget: 0` on gemini-3.7-flash still produced 5,724
   * thinking tokens across 72 answers, down from 12,030 rather than to none.
   *
   * Chosen by the model's OWN name rather than by a flag, because the caller
   * asks for an effort and should never have to know which generation is
   * behind it. Nothing is sent unless a caller asked: a model told to think
   * MINIMAL when nobody asked would be a silent change to every answer this
   * relay has ever given.
   */
  /**
   * `none` maps to LOW, and that is a measurement rather than a compromise.
   *
   * Google documents MINIMAL as available on Gemini 3 Flash. Vertex, asked for
   * it on this project on 2026-09-14, answers
   * `400 Thinking level is unsupported: THINKING_LEVEL_MINIMAL` — on
   * gemini-3.7-flash AND on gemini-3.8-flash. So MINIMAL is not a cheaper
   * setting here, it is an outage: every judge call would 400, and the class
   * swallows a failed judge on purpose, so every spoken answer would go
   * unjudged and silent.
   *
   * LOW is therefore the floor this relay can actually reach, and it is a real
   * saving: measured on the same prompt, gemini-3.8-flash went from 271
   * thinking tokens to 150.
   */
  const LEVEL: Record<string, string> = {
    none: 'LOW',
    low: 'LOW',
    medium: 'MEDIUM',
    high: 'HIGH',
  };
  // The 2.5-era integer scale, kept for any older name this relay is ever
  // pointed at. Sending it to a 3.x model is an error, not a fallback.
  const BUDGET: Record<string, number> = { none: 0, low: 1024, medium: 8192, high: 24576 };
  if (chat.reasoning_effort && chat.reasoning_effort in LEVEL) {
    generationConfig.thinkingConfig = /^gemini-3\./.test(model)
      ? { thinkingLevel: LEVEL[chat.reasoning_effort] }
      : { thinkingBudget: BUDGET[chat.reasoning_effort] };
  }
  if (isImageModel(model)) {
    generationConfig.responseModalities = ['IMAGE'];
    // A picture is not JSON, and asking for both gets a refusal.
    delete generationConfig.responseMimeType;
  }

  return {
    ...(system.length > 0 ? { systemInstruction: { parts: system } } : {}),
    contents,
    generationConfig,
    // A fresh copy per body, so nothing holding one body can loosen the next.
    safetySettings: SAFETY_SETTINGS.map((s) => ({ ...s })),
  };
}

interface VertexReply {
  candidates?: {
    content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] };
    finishReason?: string;
  }[];
  /** Present when the PROMPT was refused; there is then no candidate at all. */
  promptFeedback?: { blockReason?: string };
  usageMetadata?: Record<string, number>;
  error?: { message?: string };
}

/**
 * Whether Vertex stopped this call on policy: the prompt refused outright, or
 * the reply stopped for one of BLOCKING_FINISH. An UNSPECIFIED prompt verdict
 * is Google's zero value, not a verdict.
 */
function isBlocked(reply: VertexReply): boolean {
  const prompt = reply.promptFeedback?.blockReason;
  if (prompt && prompt !== 'BLOCKED_REASON_UNSPECIFIED') return true;
  const finish = reply.candidates?.[0]?.finishReason;
  return finish !== undefined && BLOCKING_FINISH.has(finish);
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
  /**
   * A block answers as a normal 200 carrying BLOCKED_LINE, never an error,
   * because an error is what the browser treats as the call breaking — and a
   * child who asked about a chapter did not break anything. Whatever text or
   * picture came back with the stop is dropped, unread, so the image artist
   * sees no picture (one fewer on the board) rather than a blocked one. The
   * usage is kept: Vertex's count of what it was sent is the books' business.
   */
  if (isBlocked(reply)) {
    return {
      model,
      choices: [{ message: { role: 'assistant', content: BLOCKED_LINE }, finish_reason: BLOCKED_FINISH }],
      ...(reply.usageMetadata ? { usage: reply.usageMetadata } : {}),
    };
  }

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
