import { fail, type RelayRequest, type RelayResponse } from './relays.ts';

/**
 * A LIVE SESSION WITHOUT THE KEY IN THE PAGE.
 *
 * Gemini Live is a socket the BROWSER opens to Google, and until now the only
 * way to open it was `?key=<the API key>` (apps/classroom/src/lib/liveAgent.ts
 * `connect`). Vite inlines VITE_ variables into the bundle, so ClassRoom.tsx
 * fences that key to DEV and a production build has no voice at all. This
 * mints what Google built for exactly this: an EPHEMERAL TOKEN, short-lived,
 * good for one session and pinned to one model speaking aloud, made here with
 * the key and handed to the browser in the key's place. The key never leaves
 * the server.
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
 * MEASURED against the real API by the Live spike on 2026-09-30
 * (tools/live-sim/SPIKE.md §1, probe-live.mjs; merged into phase3-completion
 * at 2457b12), so these are facts, not readings of the docs:
 *   - The body `mintLiveToken` sends — `bidiGenerateContentSetup` holding the
 *     model and `responseModalities: ['AUDIO']`, with
 *     `fieldMask: "model,generationConfig.responseModalities"` — answers 200.
 *     The docs page's own REST sample, `liveConnectConstraints`, answers
 *     400 `Unknown name "liveConnectConstraints"`: that is the SDK's name,
 *     not the REST field.
 *   - The token is the response's `name`, its only field: 76 characters
 *     starting `auth_tokens/`. Minting took 420–792 ms (n=11).
 *   - The Constrained v1beta URL with `?access_token=` reached setupComplete
 *     in 1142–1821 ms (n=8).
 *   - A masked field overrides the page: a page asking for TEXT on this
 *     token still got AUDIO.
 *   - A one-use token cannot open a second NEW session: the socket closed
 *     1011 "Token has been used too many times".
 *
 * THE MASK, AND WHY IT IS NOT OPTIONAL HERE. With NO mask, the spike's page
 * lost its systemInstruction and its tools — she said "My name is Gemini."
 * and never called `next_move` (2 of 2) — while its outputAudioTranscription
 * and sessionResumption still worked; which other page fields a maskless
 * token keeps is UNVERIFIED. With this mask she was Meera and called the
 * tool (2 of 2). The browser writes its own system instruction, tools and
 * voice into its setup frame — liveAgent.ts `buildSetupFrame` does today, and
 * the lab's Live driver needs the same for its conductor tool — so the token
 * pins only the model and the voice-out modality, with the exact mask that
 * was measured. `fieldMask: "model"` alone was never tried.
 *
 * STILL UNVERIFIED:
 *   - The model lock on its own: that the token's `models/<name>` beats a
 *     DIFFERENT model named in the page's setup (the spike's page always
 *     named the same one).
 *   - Whether a connection that fails before setupComplete spends the use.
 *     If it does, the retry needs a new mint, and that mint is claimed again.
 *   - Resuming a session on the same token (below).
 *
 * USES: 1, NOT THE 3 THIS ROUTE WAS SPECIFIED WITH. Three was meant as "one
 * session plus up to two resumptions". Google's docs say resumption does NOT
 * spend a use: the AuthToken reference on `uses` says "Resuming a Live API
 * session does not count as a use", and the ephemeral-tokens page says a
 * session can be resumed "with the same token even if `uses: 1`" until
 * `expireTime`. So `uses` counts NEW sessions, and 3 would let one mint open
 * three separately billed sessions inside the two-minute window while `admit`
 * claimed the price of one. One mint, one claim, one session.
 *
 * HOW A BROWSER GETS ITS NEXT TOKEN:
 *   - A NEW session — the turn budget is spent, the token is near its
 *     expireTime, or a socket closed and the session cannot be resumed —
 *     needs a NEW mint, and that is a new claim. Measured: reusing a spent
 *     token closes 1011.
 *   - RESUMING this session with a sessionResumption handle, after a dropped
 *     connection, is documented to reuse THIS token until its expireTime.
 *     The spike never resumed, so this is UNVERIFIED; a driver whose resume
 *     is refused mints again. The same page says a connection has to be
 *     resumed about every ten minutes; a token that lives LIVE_TOKEN_TTL_MS,
 *     six, should not reach one (UNVERIFIED: the spike saw no goAway, every
 *     session being under 30 s).
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
 * WHAT ONE MINT SELLS: ONE SESSION OF AT MOST EIGHT STUDENT TURNS, AND AT
 * MOST SIX MINUTES — not a whole class. `UNITS.live` in gate.ts prices
 * exactly this, from the spike's measured usage, and says why a whole class
 * in one session cannot be priced inside a student's day.
 *
 * The turn budget is handed to the browser (`maxStudentTurns`) and only the
 * browser can keep it: no turn passes this server. The six minutes are the
 * one bound the relay holds itself, as the token's expireTime, and they are
 * eight turns at the Respiration plan's own pace: `minutes: 20` for its 28
 * student turns (content/plans/class10-respiration.json at 35832aa) is
 * ~43 s a turn, and eight of those are 343 s. At the spike's measured pace
 * a spoken turn is ~11–13 s of machine and talk — her one-sentence line (4.4–6.8 s of
 * audio on the openers), ~1.5 s from the student's turn to her first voice
 * (whole-turn medians 1385–1548 ms on 3.8), and the 5 s answer the price
 * assumes — so the rest of the 45 s a turn is the student's thinking. A
 * session that runs out of time before its eighth turn ends early, and the
 * class's next session is the next mint.
 */
export const LIVE_SESSION_TURNS = 8;
export const LIVE_SESSION_MS = 6 * 60_000;

/**
 * The token lives exactly as long as the session its claim paid for. It was
 * thirty minutes, three times the class it was priced for, and the kill
 * switch cannot end a token already issued — so its life is also how long a
 * token outlives the switch (the phase-1 security review of this route). After
 * expireTime, Google rejects "messages in BidiGenerateContent sessions"
 * using the token (the AuthToken reference, read 2026-10-01; not measured —
 * every spike session ended long before its token). Far under Google's
 * 20-hour limit.
 */
export const LIVE_TOKEN_TTL_MS = LIVE_SESSION_MS;

/** A new session must open within two minutes of the mint: mint on the tap, not ahead of it. */
export const LIVE_TOKEN_NEW_SESSION_MS = 2 * 60_000;

/**
 * The fields the token pins, and nothing else: the mask the spike measured
 * keeping the page's own systemInstruction and tools. See THE MASK above.
 */
export const LIVE_TOKEN_FIELD_MASK = 'model,generationConfig.responseModalities';

/** The browser sends at most `{"model":"..."}`. Anything bigger did not come from the app. */
export const MAX_LIVE_TOKEN_REQUEST_BYTES = 1024;

/** Google's own ceiling on both deadlines. */
const GOOGLE_MAX_TTL_MS = 20 * 60 * 60_000;

/**
 * HOW HARD ONE CLAIM TRIES FOR ITS TOKEN.
 *
 * The claim is taken before the mint and cannot be refunded — claim_relay
 * refuses a negative cost (0016:73) — so a mint that fails on a busy moment
 * used to cost the student a session they never had, and their own retry
 * was claimed again. Google's pricing page (read 2026-10-01) lists no charge
 * for creating a token, only for the tokens a session reads and writes
 * (UNVERIFIED against a bill), so a busy moment is asked again here, inside
 * the one claim: up to
 * three asks, waiting 0.5 s and then 1.5 s. Only a busy answer is asked
 * again — a thrown fetch (including this timeout), 408, 429 or any 5xx. A
 * 400/401/403/404 is about our key or our body and would say the same twice.
 *
 * Five seconds an ask, not the ten it was: the spike measured mints at
 * 420–792 ms, and three asks at ten seconds would leave a student staring
 * at "connecting" for over half a minute before being told.
 */
const MINT_ATTEMPTS = 3;
const MINT_BACKOFF_MS = [500, 1_500] as const;
const MINT_TIMEOUT_MS = 5_000;

const isBusy = (status: number): boolean => status === 408 || status === 429 || status >= 500;

export interface LiveTokenOptions {
  /** One of LIVE_TOKEN_MODELS; defaults to the first. */
  model?: string;
  now?: () => number;
  /** Injected in tests; the global fetch otherwise, read at call time. */
  fetch?: typeof fetch;
  /** The wait between asks. Injected in tests; a real timer otherwise. */
  sleep?: (ms: number) => Promise<void>;
  uses?: number;
  /** At most LIVE_SESSION_MS: a token may not outlive what its claim paid for. */
  ttlMs?: number;
  newSessionMs?: number;
}

/** The JSON the browser receives. */
export interface LiveTokenReply {
  token: string;
  /**
   * Epoch ms: the token's expireTime. A session using it stops being served
   * after this, so the browser opens its next session (a new mint) before.
   */
  expiresAt: number;
  /** Epoch ms: the token's newSessionExpireTime. The socket must be OPEN by this. */
  newSessionExpiresAt: number;
  model: LiveTokenModel;
  /** The websocket URL WITHOUT the token; the client appends `?access_token=`. */
  url: string;
  /**
   * LIVE_SESSION_TURNS: the student turns this token's claim paid for. The
   * browser ends the session at this many and mints the next. Nothing here
   * can enforce it; a driver that runs past it spends money the meter never
   * saw, at a cost that grows with every turn (gate.ts UNITS.live).
   */
  maxStudentTurns: number;
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
 * was never going to be served must not spend a session's worth of units on
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
 *
 * A busy Google is asked again, up to MINT_ATTEMPTS times (see there). Each
 * ask computes its deadlines from its own moment, so the token handed out
 * lives LIVE_TOKEN_TTL_MS from the ask that got it, and the browser is told
 * those same deadlines.
 */
export async function mintLiveToken(apiKey: string, opts: LiveTokenOptions = {}): Promise<RelayResponse> {
  if (!apiKey) return liveTokenUnconfigured();

  const model = opts.model ?? LIVE_TOKEN_MODELS[0];
  if (!isLiveTokenModel(model)) return fail(400, 'that live model is not one this app uses');

  const uses = opts.uses ?? LIVE_TOKEN_USES;
  const ttlMs = opts.ttlMs ?? LIVE_TOKEN_TTL_MS;
  const newSessionMs = opts.newSessionMs ?? LIVE_TOKEN_NEW_SESSION_MS;
  // `uses: 0` is Google's "no limit", so it is refused rather than sent. A
  // token longer-lived than the session its claim paid for would sell Live
  // the meter never charged. A new session window longer than the token's own
  // life means nothing.
  const sane =
    Number.isInteger(uses) &&
    uses >= 1 &&
    Number.isFinite(ttlMs) &&
    ttlMs > 0 &&
    ttlMs <= LIVE_SESSION_MS &&
    ttlMs < GOOGLE_MAX_TTL_MS &&
    Number.isFinite(newSessionMs) &&
    newSessionMs > 0 &&
    newSessionMs <= ttlMs;
  if (!sane) return fail(500, 'the live token options are out of range');

  const clock = opts.now ?? Date.now;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; ; attempt += 1) {
    const now = clock();
    const expiresAt = now + ttlMs;
    const newSessionExpiresAt = now + newSessionMs;

    let res: Response | null;
    try {
      res = await doFetch(LIVE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          uses,
          expireTime: new Date(expiresAt).toISOString(),
          newSessionExpireTime: new Date(newSessionExpiresAt).toISOString(),
          bidiGenerateContentSetup: {
            model: `models/${model}`,
            generationConfig: { responseModalities: ['AUDIO'] },
          },
          fieldMask: LIVE_TOKEN_FIELD_MASK,
        }),
        // A fresh timer for every ask: one shared signal would leave the
        // second ask only what the first one had not used.
        ...(typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
          ? { signal: AbortSignal.timeout(MINT_TIMEOUT_MS) }
          : {}),
      });
    } catch {
      res = null;
    }

    if ((res === null || isBusy(res.status)) && attempt < MINT_ATTEMPTS) {
      // Nothing of a refused answer is read; let its body go.
      await res?.body?.cancel().catch(() => undefined);
      await sleep(MINT_BACKOFF_MS[attempt - 1]);
      continue;
    }
    if (res === null) return fail(502, 'Google could not be reached for a live token.');
    if (!res.ok) return fail(502, `Google refused the live token (${res.status}).`);

    const answer = (await res.json().catch(() => null)) as { name?: unknown } | null;
    const token = answer && typeof answer.name === 'string' ? answer.name : '';
    if (token === '') return fail(502, 'Google answered without a live token.');

    const reply: LiveTokenReply = {
      token,
      expiresAt,
      newSessionExpiresAt,
      model,
      url: LIVE_CONSTRAINED_URL,
      maxStudentTurns: LIVE_SESSION_TURNS,
    };
    return {
      status: 200,
      // A credential, however short-lived: no cache along the way may keep it.
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: { kind: 'json', value: reply },
    };
  }
}
