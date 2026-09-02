/**
 * THE FIVE RELAYS, WITHOUT A SERVER AROUND THEM.
 *
 * Today these live inside vite.config.ts as dev-only plugins, which is why
 * nothing can be deployed: the OpenRouter key sits on the developer's laptop
 * and a browser build would have to carry it. This package is the same work,
 * written as plain functions — a request description in, a response
 * description out — so it can be mounted on Firebase Functions, Cloud Run,
 * Azure, or a plain Node server without being rewritten for any of them.
 *
 * Nothing here imports a cloud SDK. That is the point: the part with the
 * decisions in it is testable on a laptop with no project, no billing and no
 * network, and the adapter that knows about a particular cloud stays a dozen
 * lines at the edge.
 */

/** What a relay needs to know about the request. */
export interface RelayRequest {
  method: string;
  /** Path and query, e.g. "/api/speech?text=hi". */
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
  /** Raw body. Empty for GET. */
  body: Uint8Array;
}

/** What a relay wants done, in terms the adapter can carry out. */
export interface RelayResponse {
  status: number;
  headers: Record<string, string>;
  /** A body to send, or a URL to stream through untouched. */
  body: { kind: 'json'; value: unknown } | { kind: 'bytes'; value: Uint8Array } | { kind: 'stream'; from: UpstreamCall };
}

/** An upstream request the adapter should make and pipe straight back. */
export interface UpstreamCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Content type to send back if upstream does not say. */
  fallbackContentType: string;
}

const json = (status: number, value: unknown): RelayResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: { kind: 'json', value },
});

export const fail = (status: number, message: string): RelayResponse =>
  json(status, { error: { message } });

const OPENROUTER = 'https://openrouter.ai/api/v1';

const authHeaders = (key: string): Record<string, string> => ({
  authorization: `Bearer ${key}`,
  'HTTP-Referer': 'https://github.com/aarixu/curie',
  'X-Title': 'Curie',
});

/**
 * OpenRouter pre-authorises a request against the model's WHOLE context, so
 * an uncapped call returns 402 on a low balance even though the reply is a
 * few hundred tokens. Nothing this app asks for comes near 24k.
 *
 * Exported because it is the one piece of judgement in the LLM relay, and it
 * cost a whole batch of lesson preparation to learn.
 */
export const CAP_MAX_TOKENS = 24_000;

export function capMaxTokens(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as { max_tokens?: number };
    if (parsed.max_tokens !== undefined) return rawBody;
    parsed.max_tokens = CAP_MAX_TOKENS;
    return JSON.stringify(parsed);
  } catch {
    // Not JSON. Forward it and let upstream complain in its own words.
    return rawBody;
  }
}

/** Chat completions. The planner, the artist, the judge, the doubt tutor. */
export function llmRelay(req: RelayRequest, key: string): RelayResponse {
  if (req.method !== 'POST') return fail(405, 'POST only');
  if (!key) return fail(503, 'The server has no OpenRouter key configured.');
  return {
    status: 200,
    headers: {},
    body: {
      kind: 'stream',
      from: {
        url: `${OPENROUTER}/chat/completions`,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(key) },
        body: capMaxTokens(new TextDecoder().decode(req.body)),
        fallbackContentType: 'application/json',
      },
    },
  };
}

export const DEFAULT_SPEECH_MODEL = 'deepgram/aura-2';

/**
 * A DEFAULT MODEL NEEDS A DEFAULT VOICE.
 *
 * OpenRouter refuses aura-2 without one — "An explicit voice is required for
 * this TTS provider" — so the relay's own default could not speak a word. The
 * app always passes a voice, which is why nothing showed it; the first caller
 * to rely on the default would have found a 400 and no reason for it.
 *
 * Thalia is the voice the classroom already uses, so the default and the app
 * are the same person rather than two.
 */
export const DEFAULT_SPEECH_VOICE = 'aura-2-thalia-en';

/**
 * Her voice. A GET so an <audio> element can point straight at it and start
 * playing on the first chunk — the whole reason a class does not pause
 * between sentences.
 */
export function speechRelay(req: RelayRequest, key: string): RelayResponse {
  if (!key) return fail(503, 'The server has no OpenRouter key configured.');
  const asked = new URL(req.url, 'http://relay.local');
  const text = asked.searchParams.get('text')?.trim();
  if (!text) return fail(400, 'nothing to say');

  // Named, and never absent: an unnamed voice picks a new speaker per call —
  // and this provider now refuses the request outright rather than choosing.
  const voice = asked.searchParams.get('voice') ?? DEFAULT_SPEECH_VOICE;
  return {
    status: 200,
    headers: {},
    body: {
      kind: 'stream',
      from: {
        url: `${OPENROUTER}/audio/speech`,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(key) },
        body: JSON.stringify({
          model: asked.searchParams.get('model') ?? DEFAULT_SPEECH_MODEL,
          input: text,
          voice,
          // mp3, because an audio element plays it straight from the wire at
          // a tenth of the bytes of raw PCM.
          response_format: 'mp3',
        }),
        fallbackContentType: 'audio/mpeg',
      },
    },
  };
}

export const DEFAULT_HEAR_MODEL = 'deepgram/nova-3';

/**
 * Her ear. Raw audio in the body, handed to a transcriber as multipart.
 *
 * The multipart assembly is left to the adapter: FormData is a platform
 * thing, and this package refuses to depend on one. What is decided here is
 * the model, and that the request is well-formed at all.
 */
export function hearRelay(
  req: RelayRequest,
  key: string,
): { ok: true; model: string; contentType: string; audio: Uint8Array } | { ok: false; response: RelayResponse } {
  if (req.method !== 'POST') return { ok: false, response: fail(405, 'POST only') };
  if (!key) return { ok: false, response: fail(503, 'The server has no OpenRouter key configured.') };
  if (req.body.byteLength === 0) return { ok: false, response: fail(400, 'no audio') };
  const asked = new URL(req.url, 'http://relay.local');
  return {
    ok: true,
    model: asked.searchParams.get('model') ?? DEFAULT_HEAR_MODEL,
    contentType: req.headers['content-type'] ?? 'audio/wav',
    audio: req.body,
  };
}

/** A class the room made and wants kept. */
export interface SavedClass {
  id: string;
  /**
   * The catalogue row, in the same shape an authored lesson has.
   *
   * Every field is here because the deployed writer READS it — a row goes into
   * Postgres with this title, this class and this subject. It used to be typed
   * as { id } alone, which is exactly the amount of checking a browser-supplied
   * object should not get when its contents become a row every later student
   * is served.
   */
  entry: {
    id: string;
    title: string;
    subtitle?: string;
    class: number;
    subject: string;
    path: string;
    topicRef: string;
  };
  files: { path: string; body: string; encoding: 'utf8' | 'base64' }[];
}

/**
 * What may be written, and where.
 *
 * A folder name and a set of file paths arrive over HTTP from a browser, so
 * every one of them is checked before anything touches a disk or a bucket:
 * the id is a slug and nothing else, and no path may climb out of its folder.
 * The dev plugin checks the same things; this is that check, made portable
 * and testable.
 */
/** A lesson, its assets, and its pictures. Ten is already generous. */
export const MAX_CLASS_FILES = 24;

/**
 * 12 MB of base64, which is about 9 MB of actual picture.
 *
 * The largest class in the repo today is 3.3 MB of artwork; the whole of
 * content/ is 15 MB. A single class four times the size of the biggest one
 * ever made is the right place for a ceiling.
 */
export const MAX_CLASS_BYTES = 12 * 1024 * 1024;

export function checkSavedClass(saved: unknown): { ok: true; value: SavedClass } | { ok: false; why: string } {
  if (typeof saved !== 'object' || saved === null) return { ok: false, why: 'not an object' };
  const c = saved as Partial<SavedClass>;
  if (typeof c.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) {
    return { ok: false, why: 'bad class id' };
  }
  const entry = c.entry as Partial<SavedClass['entry']> | undefined;
  if (typeof entry !== 'object' || entry === null) return { ok: false, why: 'bad catalogue entry' };
  // Checked field by field because every one of them becomes a row that every
  // later student is served, and all of it arrived over HTTP from a browser.
  if (typeof entry.id !== 'string' || entry.id === '') return { ok: false, why: 'entry has no id' };
  if (typeof entry.title !== 'string' || entry.title === '') {
    return { ok: false, why: 'entry has no title' };
  }
  if (entry.subtitle !== undefined && typeof entry.subtitle !== 'string') {
    return { ok: false, why: 'entry subtitle must be text' };
  }
  if (typeof entry.class !== 'number' || !Number.isInteger(entry.class) || entry.class < 6 || entry.class > 12) {
    return { ok: false, why: 'entry class must be a school class from 6 to 12' };
  }
  if (typeof entry.subject !== 'string' || entry.subject === '') {
    return { ok: false, why: 'entry has no subject' };
  }
  // Three segments, the same shape every other topicRef in the product has.
  // A row whose topic nothing can ask for is a lesson nobody will ever reach.
  // Three NON-EMPTY segments. "a//c" also splits into three, and a topicRef
  // nothing can join on becomes a row under a unique key that then blocks the
  // correct save for that topic for good — ignore-duplicates would swallow it.
  const segments = typeof entry.topicRef === 'string' ? entry.topicRef.split('/') : [];
  if (segments.length !== 3 || segments.some((part) => part === '')) {
    return { ok: false, why: 'entry needs a "<syllabus>/<chapter>/<topic>" topicRef' };
  }
  if (!Array.isArray(c.files) || c.files.length === 0) return { ok: false, why: 'no files' };
  /**
   * A CEILING, because this writes to storage on somebody else's word.
   *
   * Anonymous sign-in means an identity costs nothing, and the daily budget
   * allows six hundred of these — so without a bound, a throwaway account is
   * unmetered storage. A real prepared class is a lesson.json, an assets.json
   * and a handful of pictures: well inside both numbers, and a class that
   * exceeds them is not one this app made.
   */
  if (c.files.length > MAX_CLASS_FILES) {
    return { ok: false, why: `a class may hold at most ${MAX_CLASS_FILES} files` };
  }
  const bytes = c.files.reduce((n, f) => n + (typeof f?.body === 'string' ? f.body.length : 0), 0);
  if (bytes > MAX_CLASS_BYTES) {
    return { ok: false, why: 'that class is larger than any class this app makes' };
  }
  for (const file of c.files) {
    if (typeof file?.path !== 'string' || file.path === '') return { ok: false, why: 'bad file path' };
    // Anything that could climb out of the class folder, in any spelling.
    if (file.path.includes('..') || file.path.startsWith('/') || file.path.includes('\\')) {
      return { ok: false, why: `unsafe file path: ${file.path}` };
    }
    if (typeof file.body !== 'string') return { ok: false, why: 'file has no body' };
    if (file.encoding !== 'utf8' && file.encoding !== 'base64') {
      return { ok: false, why: 'file encoding must be utf8 or base64' };
    }
  }
  return { ok: true, value: c as SavedClass };
}
