import type { RelayRequest } from './relays.ts';

/**
 * THE LINE TO SAY, WHERE THE APP PUT IT.
 *
 * POST (the app since 2026-09-29): `{ text, lang?, format? }` as JSON, the
 * identity in Authorization and the sitting in `x-session-id`, like every
 * other relay. GET (an old bundle's `<audio src>`): the same fields in the
 * query string, with a signed ticket because an audio element cannot send a
 * header.
 *
 * Why POST now (overnight review #2): every line she speaks — the greeting
 * with the child's first name, their own answer read back — went out as a
 * query string, and query strings land in the gateway's and the Edge
 * Function's request logs. A body does not.
 *
 * One reader for the handler, the meter and the usage attribution, so the
 * three can never price, speak and book different text.
 */

/**
 * The longest line one request may carry. The longest narration in any
 * prepared lesson is 385 characters (class9-particle-size, measured
 * 2026-09-29); a worked example read aloud is a few of those. Anything past
 * this is not a line of a lesson.
 */
export const MAX_SPEECH_CHARS = 2000;

/** The request body a POST may carry at most, JSON included. */
const MAX_BODY_BYTES = 16 * 1024;

export interface SpeechInput {
  text: string;
  lang: string | null;
  format: string | null;
  session: string | null;
}

export type SpeechRead = { ok: true; input: SpeechInput } | { ok: false; status: number; why: string };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function readSpeech(req: RelayRequest): SpeechRead {
  const parsed = parseSpeech(req);
  if (!parsed.ok) return parsed;
  if ([...parsed.input.text].length > MAX_SPEECH_CHARS) return { ok: false, status: 413, why: 'that line is too long' };
  return parsed;
}

function parseSpeech(req: RelayRequest): SpeechRead {
  let input: SpeechInput;
  if (req.method === 'POST') {
    if (req.body.byteLength > MAX_BODY_BYTES) return { ok: false, status: 413, why: 'that line is too long' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(req.body));
    } catch {
      return { ok: false, status: 400, why: 'the body is not JSON' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: 400, why: 'expected { text, lang?, format? }' };
    }
    const body = parsed as Record<string, unknown>;
    input = {
      text: (str(body.text) ?? '').trim(),
      lang: str(body.lang),
      format: str(body.format),
      session: req.headers['x-session-id'] ?? req.headers['X-Session-Id'] ?? null,
    };
  } else {
    const asked = new URL(req.url, 'http://relay.local').searchParams;
    input = {
      text: asked.get('text')?.trim() ?? '',
      lang: asked.get('lang'),
      format: asked.get('format'),
      session: asked.get('session'),
    };
  }
  return { ok: true, input };
}

/**
 * The text alone, for the meter: priced in full even past MAX_SPEECH_CHARS,
 * so a caller that reaches the meter some other way than through the handler
 * (which refuses an over-long line first) still pays for every character.
 * '' only for a body that is not a line at all.
 */
export const speechText = (req: RelayRequest): string => {
  const read = parseSpeech(req);
  return read.ok ? read.input.text : '';
};
