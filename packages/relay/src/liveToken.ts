import { fail, type RelayRequest, type RelayResponse } from './relays.ts';

/**
 * A LIVE SESSION WITHOUT THE KEY IN THE PAGE.
 *
 * Gemini Live is a socket the BROWSER opens to Google, and until now the only
 * way to open it was `?key=<the API key>` (apps/classroom/src/lib/liveAgent.ts
 * `connect`). Vite inlines VITE_ variables into the bundle, so ClassRoom.tsx
 * fences that key to DEV and a production build has no voice at all. This mints what Google built for exactly this: an EPHEMERAL TOKEN,
 * short-lived and pinned to one model, made here with the key and handed to
 * the browser in the key's place. The key never leaves the server.
 *
 * WHAT GOOGLE'S DOCS SAY, read 2026-09-30:
 *
 *   - Create: POST https://generativelanguage.googleapis.com/v1beta/auth_tokens
 *     with the key in the `x-goog-api-key` HEADER — so the key is never in a
 *     URL, where proxies and error messages log it. v1beta, not the v1alpha
 *     older samples used; the current page's curl example says v1beta.
 *     https://ai.google.dev/gemini-api/docs/ephemeral-tokens
 *   - Fields (the AuthToken resource, https://ai.google.dev/api/live):
 *       uses                  default 1; ZERO MEANS NO LIMIT, which is why
 *                             `mintLiveToken` refuses to send it.
 *       expireTime            messages in a session using the token are
 *                             rejected after it; default +30 min, must be
 *                             under 20 hours.
 *       newSessionExpireTime  NEW sessions are rejected after it; default
 *                             +60 s, must be under 20 hours.
 *       bidiGenerateContentSetup + fieldMask — see THE MASK below.
 *   - The token is the response's `name` field ("Output only. Identifier. The
 *     token itself.").
 *   - The browser then connects to the CONSTRAINED method, v1beta, with the
 *     token as `access_token` (or an `Authorization: Token <token>` header,
 *     which a browser WebSocket cannot send):
 *     wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=<token>
 *     https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
 *
 * THE MASK, AND WHY IT IS NOT OPTIONAL HERE. The AuthToken reference says:
 * with `bidiGenerateContentSetup` set and `fieldMask` EMPTY, the effective
 * setup is taken ENTIRELY from the token and the setup the connection sends is
 * ignored; with a mask, only the masked fields overwrite the connection's.
 * The browser writes its own system instruction, tools and voice into its
 * setup frame — liveAgent.ts `buildSetupFrame` does today, and the lab's Live
 * driver needs the same for its conductor tool — so this pins `model` and
 * nothing else, with `fieldMask: "model"`, the mask the official JS SDK builds
 * for a setup holding only a model (js-genai src/tokens.ts `getFieldMasks`,
 * `lockAdditionalFields: []`).
 *
 * UNVERIFIED, all of it until the Live spike makes a real call:
 *   - The docs page's own curl example posts `liveConnectConstraints:
 *     {model, config}`, while the AuthToken reference names
 *     `bidiGenerateContentSetup` and `fieldMask`, and the JS SDK source
 *     (src/converters/_tokens_converters.ts) translates liveConnectConstraints
 *     INTO bidiGenerateContentSetup before posting. This sends the reference's
 *     shape. If Google answers 400, this shape is the first thing to check.
 *   - That the token's `models/<name>` beats a different model named in the
 *     browser's setup frame, as the mask semantics above say it should.
 *   - Whether a connection that fails before setupComplete spends a use.
 *
 * USES: 1, NOT THE 3 THIS ROUTE WAS SPECIFIED WITH, and here is the reason.
 * Three was meant as "one session plus up to two resumptions". Google's page
 * says resumption does NOT spend a use: a session must be resumed every ten
 * minutes and "this can be done with the same token even if `uses: 1`"
 * (ephemeral-tokens page), and the AuthToken reference says resumption is not
 * counted as a use. Read that way — UNVERIFIED until the spike tries it —
 * `uses` counts NEW sessions, and 3 would let one mint open three separately
 * billed sessions inside the two-minute window while `admit` claimed the price
 * of one. One mint, one claim, one session. If a failed connect spends the use
 * (UNVERIFIED, above), the retry needs a new mint, and that mint is claimed
 * again.
 */

/**
 * THE ONLY LIVE MODELS A BROWSER MAY ASK FOR, the first being the default.
 *
 * gemini-3.8-live is the stable Live model; 3.1-flash-live-preview is the one
 * liveAgent.ts tries first today. Google's pricing page bills both on one row
 * (see UNITS.live in gate.ts). A name outside this list did not come from the
 * app, the same rule as vertex.ts ALLOWED_MODELS.
 */
export const LIVE_TOKEN_MODELS = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview'] as const;

export type LiveTokenModel = (typeof LIVE_TOKEN_MODELS)[number];

export const LIVE_TOKEN_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';

/** Where the browser takes the token. It appends `?access_token=<token>` itself. */
export const LIVE_CONSTRAINED_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

/** One new session per mint. See USES above. */
export const LIVE_TOKEN_USES = 1;

/**
 * Thirty minutes of life: longer than the ~10-minute class the claim prices,
 * with room for resumed connections, and far under Google's 20-hour limit.
 */
export const LIVE_TOKEN_TTL_MS = 30 * 60_000;

/** A new session must open within two minutes of the mint: mint on the tap, not ahead of it. */
export const LIVE_TOKEN_NEW_SESSION_MS = 2 * 60_000;

/** The browser sends at most `{"model":"..."}`. Anything bigger did not come from the app. */
export const MAX_LIVE_TOKEN_REQUEST_BYTES = 1024;

/** Google's own ceiling on both deadlines. */
const GOOGLE_MAX_TTL_MS = 20 * 60 * 60_000;

const MINT_TIMEOUT_MS = 10_000;

export interface LiveTokenOptions {
  /** One of LIVE_TOKEN_MODELS; defaults to the first. */
  model?: string;
  now?: () => number;
  /** Injected in tests; the global fetch otherwise, read at call time. */
  fetch?: typeof fetch;
  uses?: number;
  ttlMs?: number;
  newSessionMs?: number;
}

/** The JSON the browser receives. */
export interface LiveTokenReply {
  token: string;
  /** Epoch ms: the token's expireTime. A session using it stops being served after this. */
  expiresAt: number;
  /** Epoch ms: the token's newSessionExpireTime. The socket must be OPEN by this. */
  newSessionExpiresAt: number;
  model: LiveTokenModel;
  /** The websocket URL WITHOUT the token; the client appends `?access_token=`. */
  url: string;
}

export const isLiveTokenModel = (model: unknown): model is LiveTokenModel =>
  typeof model === 'string' && (LIVE_TOKEN_MODELS as readonly string[]).includes(model);

/**
 * 503 with a reason the client can branch on: this host holds no Gemini key,
 * so live voice is off here — not "try again in a moment".
 */
export function liveTokenUnconfigured(): RelayResponse {
  return {
    status: 503,
    headers: { 'content-type': 'application/json' },
    body: {
      kind: 'json',
      value: { error: { message: 'Live voice is not set up on this server.', reason: 'unconfigured' } },
    },
  };
}

/**
 * Which model the browser asked for, read BEFORE the meter: a request that
 * was never going to be served must not spend a class's worth of units on
 * being told so. An empty body means the default.
 */
export function readLiveTokenRequest(
  req: RelayRequest,
): { ok: true; model: LiveTokenModel } | { ok: false; response: RelayResponse } {
  if (req.body.byteLength > MAX_LIVE_TOKEN_REQUEST_BYTES) {
    return { ok: false, response: fail(413, 'that request is larger than anything this app sends') };
  }
  const text = new TextDecoder().decode(req.body).trim();
  if (text === '') return { ok: true, model: LIVE_TOKEN_MODELS[0] };

  let asked: unknown;
  try {
    asked = JSON.parse(text);
  } catch {
    return { ok: false, response: fail(400, 'the request body was not JSON') };
  }
  if (typeof asked !== 'object' || asked === null || Array.isArray(asked)) {
    return { ok: false, response: fail(400, 'the request body was not an object') };
  }
  const model = (asked as { model?: unknown }).model;
  if (model === undefined) return { ok: true, model: LIVE_TOKEN_MODELS[0] };
  if (!isLiveTokenModel(model)) {
    return { ok: false, response: fail(400, 'that live model is not one this app uses') };
  }
  return { ok: true, model };
}

/**
 * Mint one token. Never throws: every failure is a status and a short message.
 *
 * NOTHING FROM GOOGLE IS ECHOED BACK. Not the upstream body, not a thrown
 * error's message: either could carry a request detail, and the one detail
 * this request holds is the key. The status number is enough to act on; the
 * rest belongs in a server log, which this does not write.
 *
 * Checks that need no network (the model, the numbers) come first, so a bad
 * call never reaches Google.
 */
export async function mintLiveToken(apiKey: string, opts: LiveTokenOptions = {}): Promise<RelayResponse> {
  if (!apiKey) return liveTokenUnconfigured();

  const model = opts.model ?? LIVE_TOKEN_MODELS[0];
  if (!isLiveTokenModel(model)) return fail(400, 'that live model is not one this app uses');

  const uses = opts.uses ?? LIVE_TOKEN_USES;
  const ttlMs = opts.ttlMs ?? LIVE_TOKEN_TTL_MS;
  const newSessionMs = opts.newSessionMs ?? LIVE_TOKEN_NEW_SESSION_MS;
  // `uses: 0` is Google's "no limit", so it is refused rather than sent. A new
  // session window longer than the token's own life means nothing.
  const sane =
    Number.isInteger(uses) &&
    uses >= 1 &&
    Number.isFinite(ttlMs) &&
    ttlMs > 0 &&
    ttlMs < GOOGLE_MAX_TTL_MS &&
    Number.isFinite(newSessionMs) &&
    newSessionMs > 0 &&
    newSessionMs <= ttlMs;
  if (!sane) return fail(500, 'the live token options are out of range');

  const now = (opts.now ?? Date.now)();
  const expiresAt = now + ttlMs;
  const newSessionExpiresAt = now + newSessionMs;
  const doFetch = opts.fetch ?? globalThis.fetch;

  let res: Response;
  try {
    res = await doFetch(LIVE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        uses,
        expireTime: new Date(expiresAt).toISOString(),
        newSessionExpireTime: new Date(newSessionExpiresAt).toISOString(),
        bidiGenerateContentSetup: { model: `models/${model}` },
        fieldMask: 'model',
      }),
      ...(typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? { signal: AbortSignal.timeout(MINT_TIMEOUT_MS) }
        : {}),
    });
  } catch {
    return fail(502, 'Google could not be reached for a live token.');
  }
  if (!res.ok) return fail(502, `Google refused the live token (${res.status}).`);

  const answer = (await res.json().catch(() => null)) as { name?: unknown } | null;
  const token = answer && typeof answer.name === 'string' ? answer.name : '';
  if (token === '') return fail(502, 'Google answered without a live token.');

  const reply: LiveTokenReply = { token, expiresAt, newSessionExpiresAt, model, url: LIVE_CONSTRAINED_URL };
  return {
    status: 200,
    // A credential, however short-lived: no cache along the way may keep it.
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: { kind: 'json', value: reply },
  };
}
