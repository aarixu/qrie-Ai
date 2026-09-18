import { isAllowedClassPath, unsafeMarkup } from './markup.ts';
// By relative path with the extension, the way the Edge Function reaches every
// other module here: Deno resolves files, not package names, and this gate has
// to run in production or it is not a gate. `packages/safety` is pure — no
// imports of its own, no DOM, no node — so it travels.
import { screen } from '../../safety/src/screen.ts';
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

/**
 * A short, present piece of text — the shared vocabulary every validator in
 * this package reaches for.
 *
 * ONE DEFINITION, because there were two: report.ts asked for `length > 0`
 * and enroll.ts for `trim() !== ''`, so "   " was a valid lessonId and an
 * invalid parentName for no stated reason. The TRIM-AWARE rule wins, and
 * deliberately: a name made of spaces is not a name, and a lessonId made of
 * spaces joins to nothing. Whitespace is REFUSED, never trimmed off and
 * accepted — this package rejects rather than quietly repairs.
 */
export const isShortText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.length <= max;

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
export function speechRelay(req: RelayRequest, key: string, own?: string): RelayResponse {
  const asked = new URL(req.url, 'http://relay.local');
  const text = asked.searchParams.get('text')?.trim();
  if (!text) return fail(400, 'nothing to say');

  /**
   * OUR OWN VOICE, WHEN THERE IS ONE.
   *
   * Her voice is 86% of what a class costs and every rupee of it is cash to a
   * vendor. `tools/speech` serves the same thing from a box we rent: measured
   * on an ordinary laptop, Piper runs at 10.4x realtime with the first audio
   * at 0.25-0.37s — as fast as the vendor it replaces, whose measured
   * time-to-first-byte was 0.36s.
   *
   * A GET with no credential, because there is none: the whole point of the
   * relay is that the browser never holds a vendor key, and a service of ours
   * has no key to hold. Absent, everything below is exactly as it was.
   *
   * AND `voice` DOES NOT TRAVEL, which is a fix and not a simplification.
   *
   * A voice name only means anything next to the model that has it — the same
   * argument HEAR_LANGUAGE makes below. This forwarded `?voice=` verbatim, and
   * the app has exactly one setting for it: `TUTOR_VOICE` in
   * apps/classroom/src/lib/lessonVoice.ts sends `aura-2-thalia-en` on EVERY
   * line, and AvatarLab sends the same. `tools/speech` looks a voice up as
   * `<name>.onnx` on disk, so our own box answers 404 'no voice at
   * .../aura-2-thalia-en.onnx' to every line of every class. The audio element
   * fails, `createStreamingTts` falls back, and a student whose relay has
   * CURIE_SPEECH_URL set hears the browser's robot voice for the whole lesson
   * — the one failure the box was built to be indistinguishable from the
   * vendor on. The test that shipped with it passed `hi_IN-pratham-medium`,
   * which is a name nothing in this product can ask for.
   *
   * The box picks its own speaker from `CURIE_VOICE`, which is where a Piper
   * voice can be named by somebody who knows Piper's names. Choosing among its
   * three Hindi voices from the app needs the app to know they exist, and that
   * is a real decision with a student in front of it — not a query parameter
   * forwarded on the chance the two vocabularies happen to agree.
   */
  if (own) {
    const q = new URLSearchParams({ text });
    return {
      status: 200,
      headers: {},
      body: {
        kind: 'stream',
        from: {
          url: `${own.replace(/\/$/, '')}/speak?${q}`,
          method: 'GET',
          headers: {},
          fallbackContentType: 'audio/wav',
        },
      },
    };
  }

  if (!key) return fail(503, 'The server has no OpenRouter key configured.');

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
 * The longest answer this relay will carry, in bytes.
 *
 * A minute of the 16 kHz 16-bit mono `ear.ts` posts. The endpointer stops a
 * spoken answer at ten seconds, so this is three times the longest thing the
 * room can produce — wide enough that no student meets it, narrow enough that
 * the meter's bytes-to-seconds arithmetic stays true.
 */
export const MAX_HEAR_BYTES = 2_000_000;

/**
 * THE EAR WAS LISTENING IN ENGLISH, AND NOBODY HAD TOLD IT OTHERWISE.
 *
 * The multipart form went out carrying `model` and `file` and nothing else, so
 * the vendor used its default language — English — on a Class 10 student
 * saying "har cell ko oxygen chahiye". A transcriber pointed at a language it
 * was not configured for does not go quiet; it produces fluent text in the
 * language it knows. The measurement this project actually recorded is in
 * `tools/speech/README.md`: faster-whisper given Hinglish reported the
 * language as `en` and returned garbage at avg logprob −0.79, with no error —
 * the same English sentence came back exact at −0.22. Those invented words
 * then reach the judge as the child's answer and the ledger as the child's own
 * words. It is the same defect that on 2026-09-14 took the on-device ear out
 * of `apps/classroom/src/lib/ear.ts`, and with that one gone this is now the
 * ONLY ear, so nothing is behind it.
 *
 * `multi`, and specifically NOT `hi`. Two reasons, either one sufficient:
 *  - `hi` is a single-language mode. Deepgram documents code-switching as
 *    requiring `multi`, and a Class 10 science answer is Hinglish by default:
 *    Hindi grammar carrying English nouns, in one sentence.
 *  - Deepgram's Hindi emits DEVANAGARI. Every English term a student says —
 *    "cell", "oxygen", "reflex action" — would come back in Devanagari, and
 *    the 133 romanised entries in `packages/tutor-judge/src/match.ts` are
 *    compared as Latin text, so Devanagari would miss all of them.
 *    `matchSpokenAnswer` has no production caller YET — it is wired in with
 *    the learner model — which is precisely why the language has to be settled
 *    here and now: pick `hi` today and the matcher resolves nothing on the day
 *    it is finally called, with every answer going to a model instead and
 *    nothing in either file saying why.
 *
 * A CONSTANT AND NOT A QUERY PARAMETER, deliberately, and that is the guard.
 * `model` is overridable because there is a real reason to try a different
 * transcriber. There is no setting of THIS one that is not a defect: anything
 * narrower than `multi` is either the English-only ear that was just deleted
 * or Devanagari that breaks the matcher downstream. A knob whose every
 * position is a bug is cheaper to remove than to validate, so a caller cannot
 * ask for a language at all — `?language=` is ignored.
 *
 * It does travel WITH the model, because it only means anything next to one: a
 * caller who overrides `model` away from nova-3 owes the same two properties —
 * understands `multi`, answers in Latin script — and nothing here can check
 * that for them.
 */
export const HEAR_LANGUAGE = 'multi';

/**
 * Everything the transcriber is told, in one value.
 *
 * ONE OBJECT AND NOT FOUR ARGUMENTS, deliberately. The seam used to be
 * `transcribe(model, language, contentType, audio)` — three consecutive bare
 * strings, forwarded positionally by both hosts. Swapping two of them at
 * either call site typechecks clean and sends `language=audio/wav`, which is
 * the missing-language defect again wearing types that call it correct. Named
 * fields make that swap unspellable instead of something a reviewer has to
 * catch.
 */
export interface HeardAudio {
  model: string;
  language: string;
  contentType: string;
  audio: Uint8Array;
}

/**
 * Her ear. Raw audio in the body, handed to a transcriber as multipart.
 *
 * The multipart assembly is left to the adapter: FormData is a platform
 * thing, and this package refuses to depend on one. What is decided here is
 * the model and the language, and that the request is well-formed at all.
 */
export function hearRelay(
  req: RelayRequest,
  key: string,
): ({ ok: true } & HeardAudio) | { ok: false; response: RelayResponse } {
  if (req.method !== 'POST') return { ok: false, response: fail(405, 'POST only') };
  if (!key) return { ok: false, response: fail(503, 'The server has no OpenRouter key configured.') };
  if (req.body.byteLength === 0) return { ok: false, response: fail(400, 'no audio') };

  /**
   * WHAT THE METER IS ABLE TO PRICE.
   *
   * The vendor bills by the SECOND, and the meter turns bytes into seconds by
   * dividing by `HEARD_BYTES_PER_SECOND` — which is only true of the raw
   * 16 kHz mono PCM `ear.ts` actually posts. A compressed body of the same
   * duration is a fraction of the bytes, so it would be charged a fraction of
   * the units: 16 kbps opus is about 2,000 bytes a second against 32,000, and
   * a day's budget would then buy something like seventy-seven hours of
   * transcription. Nothing else stops it — the per-minute request limit is
   * nowhere near binding on a body that large.
   *
   * So rather than pricing a body the meter cannot read, refuse it. `ear.ts`
   * posts `audio/wav` and nothing else, which makes this a guard on a state
   * that should never occur rather than a restriction on a caller.
   *
   * The cap is generous against the same source: `EAR_DEFAULTS.maxSpeechMs` is
   * ten seconds and the endpointer's hard stop is the longest answer taken
   * whole, so a minute of 16 kHz 16-bit mono — under 2 MB — is already three
   * times the longest thing the room can send.
   */
  const type = (req.headers['content-type'] ?? 'audio/wav').split(';')[0].trim().toLowerCase();
  if (type !== 'audio/wav' && type !== 'audio/wave' && type !== 'audio/x-wav') {
    return { ok: false, response: fail(415, `this relay hears audio/wav, not ${type}`) };
  }
  if (req.body.byteLength > MAX_HEAR_BYTES) {
    return { ok: false, response: fail(413, 'that answer is longer than this relay takes') };
  }

  const asked = new URL(req.url, 'http://relay.local');
  return {
    ok: true,
    model: asked.searchParams.get('model') ?? DEFAULT_HEAR_MODEL,
    language: HEAR_LANGUAGE,
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
  /**
   * The catalogue row is written from `saved.id`, and the files under it.
   * An entry naming a different id is either a bug or somebody trying to
   * point a row at another student's folder.
   */
  if (entry.id !== c.id) return { ok: false, why: 'the entry names a different class' };

  for (const file of c.files) {
    if (typeof file?.path !== 'string' || file.path === '') return { ok: false, why: 'bad file path' };
    /**
     * An ALLOW-LIST. The check here used to be a deny-list — no `..`, no
     * leading slash, no backslash — which stopped a climb out of the folder
     * and let through every extension there is, including .svg, which this
     * bucket serves as image/svg+xml.
     */
    if (!isAllowedClassPath(file.path)) {
      return { ok: false, why: `a class does not hold "${file.path}"` };
    }
    if (typeof file.body !== 'string') return { ok: false, why: 'file has no body' };
    if (file.encoding !== 'utf8' && file.encoding !== 'base64') {
      return { ok: false, why: 'file encoding must be utf8 or base64' };
    }
    /**
     * THE MARKUP GATE, on the server, where it belongs.
     *
     * Diagram markup travels inside assets.json and is inlined into the page
     * with dangerouslySetInnerHTML by every student who later opens this
     * topic. The gate existed and ran in the BROWSER during preparation, so it
     * protected only the traffic that chose to walk through it — a hand-made
     * POST went straight past. Demonstrated: an anonymous identity posted
     * `<svg><g><script>…` and this endpoint answered 200.
     */
    if (file.encoding === 'utf8') {
      const problems = unsafeMarkup(file.body);
      if (problems.length > 0) {
        return { ok: false, why: `${file.path} ${problems[0]}` };
      }
      /**
       * AND THE OTHER THING A KEPT CLASS CARRIES TO EVERY LATER STUDENT.
       *
       * Every word of the markup argument above applies to what she SAYS, and
       * the words had no gate at all. `ClassRoom.tsx` justified not screening
       * narration on its way to the speaker with "it came through prep, which
       * screens what it plans" — and `packages/class-prep` imports
       * `@ai-tutor/safety` nowhere. Its own `safety.ts` is a re-export of THIS
       * file's markup gate: script tags and `@import`, not children. The claim
       * was load-bearing and false, which is how a gap survives a review.
       *
       * Narration is written by a model, kept permanently (`topic_ref` is
       * unique and a 409 is treated as success) and read aloud to every later
       * student by a tutor they trust. Refused, never cleaned: masking a line
       * out of a lesson would leave a class nobody understood, and preparing
       * another costs about Rs 30.
       *
       * THE LIMIT IS THE FILE'S OWN LENGTH. `screen` truncates at 1,200 words
       * by default, which is shorter than a class — so the default would have
       * checked the first few beats and waved the rest through, which is worse
       * than no gate because it reads like one. No word is shorter than a
       * character, so this covers the file exactly.
       */
      const verdict = screen(file.body, 'to-student', { limit: file.body.length });
      if (verdict.kind === 'support') {
        return { ok: false, why: `${file.path} carries a line that reads as distress` };
      }
    }
  }
  return { ok: true, value: c as SavedClass };
}
