import {
  fail,
  hearRelay,
  llmRelay,
  speechRelay,
  type HeardAudio,
  type RelayRequest,
  type RelayResponse,
  type SavedClass,
} from './relays.ts';
import { admit, type Gate, type RelayName } from './gate.ts';
import { readSpeech } from './speechInput.ts';
import { handleReport, isUuid, type ReportStore } from './report.ts';
import { handlePrep, type PrepLocks } from './prep.ts';
import { handleEnroll, handleEnrollOtp, type ConsentStore, type OtpGate, type OtpProvider } from './enroll.ts';
import { mintTicket, TICKET_TTL_MS } from './ticket.ts';
import { readSavedClass } from './classStore.ts';
import {
  MAX_REQUEST_BYTES,
  bareModel,
  completeOnVertex,
  type OpenAiReply,
  type VertexOptions,
} from './vertex.ts';
import { DEFAULT_SPEECH_MODEL } from './relays.ts';
import {
  PCM_CONTENT_TYPE,
  VERTEX_SPEECH_MODEL,
  estimatedSpeechTokens,
  maxSpeechBytes,
  speakOnVertex,
  sseToPcm,
  vertexSpeechCall,
} from './vertexSpeech.ts';
import { VERTEX_HEAR_MODEL, hearOnVertex } from './vertexHear.ts';
import { liveTokenUnconfigured, mintLiveToken, readLiveTokenRequest } from './liveToken.ts';
import {
  usageFromClass,
  usageFromHear,
  usageFromOpenRouterLlm,
  usageFromSpeech,
  usageFromVertex,
  usageFromVertexHear,
  usageFromVertexSpeech,
  type Usage,
} from './usage.ts';

/**
 * ONE ROUTER, RUN BY BOTH SIDES.
 *
 * The dev server and the deployed Edge Function are not two implementations of
 * the relays — they are this function, called from two adapters. That was
 * already the rule for the relays themselves; it has to hold for the lock and
 * the meter too, or the thing that gets tested every day is not the thing that
 * faces the internet.
 *
 * What is left to a host: turning its own request type into a RelayRequest,
 * carrying out a RelayResponse, and one platform call for multipart upload.
 */

export interface HandlerDeps {
  /**
   * The OpenRouter key. Never leaves the server.
   *
   * Still needed for SPEECH even when Vertex serves the models: the tutor's
   * voice is Deepgram aura-2 through OpenRouter. When that call fails — out
   * of credit, down — and `vertex` is set, the line is spoken on Vertex
   * instead (vertexSpeech.ts), in the persona's Gemini voice, which is a
   * different woman from aura-2's Thalia. Empty here with `vertex` set means
   * every line is spoken on Vertex.
   */
  key: string;
  /**
   * OUR OWN SPEECH SERVICE, WHEN THERE IS ONE.
   *
   * The base URL of `tools/speech` — a box running Piper. Her voice is 86% of
   * what a class costs and all of it is cash; this is the line that turns it
   * into rent. Absent, speech goes to the vendor exactly as it did.
   *
   * ONLY WHERE VERTEX IS NOT CONFIGURED (overnight review #39). With a service
   * account, every line is Gemini on Vertex and this is ignored — Aarav's call
   * on 2026-09-28: the box's Piper voices are Hindi with no Indian English one,
   * and the tutor speaks Hinglish and Indian English.
   * In production that means it is off; turning it back on as the cost lever
   * needs a Hinglish voice on the box first.
   *
   * No credential travels with it, because there is none to travel.
   */
  speechUrl?: string;
  /**
   * OFF, NOW, WITHOUT A DEPLOY.
   *
   * The ceilings stop a slow leak. They do not stop a bug spending inside the
   * ceiling as fast as the ceiling allows, and they do not stop a key that has
   * leaked -- and both of those want the same thing at two in the morning. Each
   * host reads `RELAY_DISABLED` and hands the answer in here; the handler
   * checks it before it checks anything else, so nothing is verified, nothing
   * is metered, and nothing is dispatched.
   *
   * Absent means running. A switch that closes the relay when somebody forgets
   * to set a variable is an outage waiting for a Friday.
   */
  disabled?: boolean;
  gate: Gate;
  /**
   * Google Cloud, for everything that thinks or draws.
   *
   * Present: /api/llm goes to Vertex — planner, artist, vision and image
   * generation, all on credits attached to a project rather than a prepaid
   * balance. Absent: OpenRouter serves it exactly as before, which is what
   * the dev server does when nobody has set a service account.
   *
   * The app is not told which. It posts OpenAI chat completions either way and
   * the translation lives in vertex.ts, because a browser that knows which
   * provider is behind it is a browser that will one day be asked to hold the
   * credential too.
   */
  vertex?: VertexOptions;
  /**
   * The Gemini Developer API key (AI Studio), for ONE thing: minting Live
   * ephemeral tokens at /live-token (liveToken.ts). Ephemeral tokens are a
   * Gemini Developer API feature minted with this key; the Vertex service
   * account above plays no part in them. The key itself never leaves the
   * server — the browser gets a token pinned to one model, good for one new
   * session within two minutes.
   *
   * Absent means that route answers 503 with reason 'unconfigured'; nothing
   * else in the relay reads it.
   */
  geminiApiKey?: string;
  /**
   * Hand raw audio to a transcriber. Left to the host because it is the one
   * place a platform's FormData shows through; `transcribeViaFormData` in
   * web.ts is the implementation both hosts use.
   *
   * `language` is passed IN rather than chosen by the host: it is the
   * difference between hearing a Hinglish answer and being told a fluent
   * English one that the student never said. See HEAR_LANGUAGE in relays.ts.
   *
   * It arrives as ONE `HeardAudio`, handed on exactly as hearRelay built it.
   * As four positional arguments — three of them bare `string` — a host that
   * swapped two typechecked clean and sent `language=audio/wav`, which is the
   * same defect as sending no language at all and just as invisible. Both
   * hosts now forward a value they cannot reorder.
   */
  transcribe(call: HeardAudio): Promise<RelayResponse>;
  /**
   * Keep a class the tutor just made, so the next student gets it free —
   * once an operator publishes it: the Edge Function's keeper (classStore.ts
   * keepClass) stores every class 'pending', and the app serves only
   * 'published' rows.
   *
   * Optional because the dev server writes into content/ with its own plugin
   * and has no Storage to reach. Absent means the relay says so rather than
   * pretending: a class that quietly is not kept costs every later student the
   * whole preparation again, and nothing would ever show it.
   */
  keep?(saved: SavedClass): Promise<RelayResponse>;
  /**
   * Where what a call actually cost is written down: tokens, characters,
   * audio bytes. Optional, like `keep` - the dev server prints, the Edge
   * Function writes to Postgres - and absent means nothing is recorded, which
   * the plan's Phase 2 treats as "unmeasured", never as "free".
   *
   * It runs AFTER the call and never in its way. A slow accounting table must
   * not cost a student their class.
   */
  usage?: Usage;
  /**
   * Where a child's report goes. (Safety #4: it must reach a person.)
   * Optional like `keep`, and absent means the route answers 501 out loud —
   * the client keeps its local copy either way, so an honest refusal loses
   * nothing while a host that silently swallowed reports would lose all of
   * them. Dev keeps them in memory; the Edge Function writes Postgres
   * through keep_student_report.
   */
  reports?: ReportStore;
  /**
   * OPS_ALERT_WEBHOOK, handed in by the host like RELAY_DISABLED is. Set, a
   * kept report POSTs {kind, lessonId, at, reportId} there — metadata only,
   * NEVER the child's words. Unset, one server-side log line. Either way an
   * alert failure never fails the 202.
   */
  opsAlertWebhook?: string;
  /**
   * The per-topic preparation lock (0017), so N students on one cold topic
   * pay for ONE preparation. Absent means 501: the dev host counts in
   * memory, the Edge Function calls the definer functions.
   *
   * THE CALLER LANDED IN WAVE 3 and this docblock used to say it had not.
   * apps/classroom/src/lib/liveClass.ts takes the lock, renews it while
   * preparing and releases it on success, on failure and on pagehide.
   *
   * What is still true, and is the reason to keep reading: a LOST lock does
   * not abort a preparation already in flight, because prepareClass has no
   * cancellation. When renew returns false the heartbeat stops and the
   * twin-spend window is narrowed rather than closed.
   */
  prepLocks?: PrepLocks;
  /**
   * The OTP seam for enrolment. No SMS vendor exists yet, so the DEV SERVER
   * runs the dev provider (one process, one Map, the code in the developer's
   * own terminal) and the EDGE HOST LEAVES THIS ABSENT — both enrolment
   * routes answer 501 there rather than failing a parent with "that code is
   * not right" when it was: a memory-backed provider cannot work across
   * many short-lived isolates, and no parent can read a function's log
   * stream anyway. The real vendor lands behind this same interface with its
   * key in the HOST's environment. A vendor key path must never reach a
   * browser — that is the whole reason the relay exists.
   */
  otp?: OtpProvider;
  /**
   * May this user send this phone another code. SMS is money and identities
   * are free, so the count is per PHONE and per user, and in production it
   * lives in Postgres (claim_otp_send) for the ledger's own reason: many
   * short-lived instances cannot count in a Map.
   */
  otpGate?: OtpGate;
  /**
   * Where the DPDP verifiable-parental-consent row is written. Absent means
   * enrolment answers 501 rather than pretending: an enrolment whose consent
   * row was never kept is not an enrolment.
   */
  consent?: ConsentStore;
  now?: () => number;
}

/**
 * Which learning session a call belongs to, when the app said.
 *
 * A header for the relays a fetch reaches — speech POSTed by the app included —
 * and a query parameter for an old bundle's speech GET, which is an
 * <audio src> and cannot send one. Absent is ordinary: a call made from the
 * Home screen belongs to no sitting.
 */
function sessionOf(req: RelayRequest, relay: RelayName): string | null {
  if (relay === 'speech') {
    const read = readSpeech(req);
    return read.ok ? read.input.session : null;
  }
  return req.headers['x-session-id'] ?? req.headers['X-Session-Id'] ?? null;
}

/**
 * The route families beside the relays: a report, the prep lock, enrolment.
 *
 * Matched exactly as written below, and the two rules differ: 'report' and
 * 'enroll' are named by their LAST SEGMENT, like the relays; the prep family
 * and enroll/otp by their LAST TWO, because /api/prep/lock and some future
 * /api/other/lock must not collide. The looser pair means /api/anything/
 * report also routes here — harmless, since it still admits and validates,
 * but say it rather than describe a stricter router than this is. Both rules
 * serve both hosts' prefixes (/api/... in dev, /relay/... behind the
 * function's name in production), which is why neither anchors on 'api'.
 */
export type RouteName =
  | 'report'
  | 'prep/lock'
  | 'prep/renew'
  | 'prep/release'
  | 'prep/state'
  | 'enroll'
  | 'enroll/otp';

export function routeFor(url: string): RouteName | null {
  const parts = new URL(url, 'http://relay.local').pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  const prev = parts.length > 1 ? parts[parts.length - 2] : undefined;
  if (last === 'report') return 'report';
  if (prev === 'prep' && (last === 'lock' || last === 'renew' || last === 'release' || last === 'state')) {
    return `prep/${last}`;
  }
  if (last === 'enroll') return 'enroll';
  if (prev === 'enroll' && last === 'otp') return 'enroll/otp';
  return null;
}

/** The relay a path names, or null. */
export function relayFor(url: string): RelayName | null {
  const path = new URL(url, 'http://relay.local').pathname;
  // Matched on the LAST segment so the same code serves /api/llm in dev and
  // /relay/llm behind a function's own name in production.
  const last = path.split('/').filter(Boolean).pop();
  switch (last) {
    case 'llm':
      return 'llm';
    case 'speech':
      return 'speech';
    case 'hear':
      return 'hear';
    case 'class':
      return 'class';
    case 'icons':
      return 'icons';
    default:
      return null;
  }
}

/**
 * A pass for the one request that cannot carry a header.
 *
 * Minted only for a caller who has just proved who they are with a real
 * Authorization header, and it says nothing except that user id and a
 * deadline — see ticket.ts for why it is not simply the session token.
 */
export async function handleTicket(req: RelayRequest, gate: Gate): Promise<RelayResponse> {
  if (!gate.ticketSecret) {
    return fail(503, 'The server has no ticket secret configured.');
  }
  const verified = await gate.verify(req.headers['authorization'] ?? req.headers['Authorization']);
  if (!verified.ok) return fail(verified.status, verified.why);

  const now = (gate.now ?? Date.now)();
  const expiresAt = now + TICKET_TTL_MS;
  const ticket = await mintTicket(verified.user.userId, gate.ticketSecret, expiresAt);
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { kind: 'json', value: { ticket, expiresAt } },
  };
}

/**
 * A Live token, for a verified caller whose claim for one session was
 * allowed — in that order, and both before Google is called. A class is
 * several sessions, each its own call here (liveToken.ts LIVE_SESSION_TURNS).
 *
 * The meter has to be paid HERE because it never sees the session: it runs
 * from the browser straight to Google, so this mint is the only request of
 * a Live session that reaches the relay. `UNITS.live` in gate.ts is what it
 * costs and why. No usage row is written, deliberately: `UsageEvent` in
 * usage.ts says why 'live' cannot be one yet.
 *
 * Refusals that cost nothing come before the meter, as for the class relay:
 * the wrong method, a host with no key, a model the app does not use.
 */
async function handleLiveToken(req: RelayRequest, deps: HandlerDeps): Promise<RelayResponse> {
  if (req.method !== 'POST') return fail(405, 'POST only');
  if (!deps.geminiApiKey) return liveTokenUnconfigured();

  const asked = readLiveTokenRequest(req);
  if (!asked.ok) return asked.response;

  const admitted = await admit(req, 'live', deps.gate);
  if (!admitted.ok) return admitted.response;

  return mintLiveToken(deps.geminiApiKey, { model: asked.model, ...(deps.now ? { now: deps.now } : {}) });
}

/**
 * Route, admit, then relay.
 *
 * The order matters and is the whole point of the file: NOTHING reaches
 * OpenRouter before `admit` has said who is asking and that they are within
 * their limits. A relay that spends first and checks after is a relay with no
 * limit at all.
 */
export async function handleRelay(req: RelayRequest, deps: HandlerDeps): Promise<RelayResponse> {
  /**
   * ABOVE THE KILL SWITCH, AND ONLY THIS ONE. (Safety #4.)
   *
   * The switch exists to stop SPEND. A report spends nothing — no vendor is
   * called, no unit is claimed — and the moment somebody flips the switch is
   * the moment a child is most likely to have something to say: a leaked
   * key, a wrong answer, a line that frightened somebody. A relay that goes
   * quiet and takes the report button with it is one that can only be told
   * about problems while it is healthy. admitFree still demands a verified
   * identity, and it exempts 'report' from the ledger's halted/capped arms
   * for the same reason — see its docblock for the price of that.
   *
   * Prep and enrolment stay BELOW: neither is safety, and both can wait.
   */
  const early = routeFor(req.url);
  if (early === 'report') return handleReport(req, deps);

  // Before everything else, including the ticket. A ticket outlives the
  // switch by its whole ten minutes, so minting one during an incident hands
  // out access that survives the fix.
  if (deps.disabled === true) {
    return {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '900' },
      body: {
        kind: 'json',
        value: {
          error: {
            message: 'Qrie is having a rest. Classes are paused for a few minutes.',
            reason: 'disabled',
          },
        },
      },
    };
  }

  const path = new URL(req.url, 'http://relay.local').pathname;
  const last = path.split('/').filter(Boolean).pop();
  if (last === 'ticket') {
    return handleTicket(req, deps.gate);
  }
  // Below the switch for the ticket's reason: a Live token outlives the
  // switch by its whole life, LIVE_TOKEN_TTL_MS (six minutes).
  if (last === 'live-token') return handleLiveToken(req, deps);

  // The route families beside the relays. Each does its own admission —
  // identity plus the per-minute window, zero units. These ones DO sit
  // below the kill switch: preparing a class and enrolling can both wait
  // for the incident to end. The report route is the exception and was
  // dispatched above.
  const route = early;
  if (route === 'prep/lock' || route === 'prep/renew' || route === 'prep/release' || route === 'prep/state') {
    return handlePrep(route, req, deps);
  }
  if (route === 'enroll') return handleEnroll(req, deps);
  if (route === 'enroll/otp') return handleEnrollOtp(req, deps);

  const relay = relayFor(req.url);
  if (relay === null) return fail(404, 'no such relay');

  // Still not served here: the icon lookup needs a static index built at
  // deploy time, because @iconify/json is 443 MB and must never reach a
  // browser. Saying so is better than a 404 that reads as a deploy problem.
  if (relay === 'icons') {
    return fail(501, 'the icons relay is not hosted here yet');
  }

  // Refusals that cost nothing come BEFORE the meter. A request this host was
  // never going to serve should not spend a student's daily budget on being
  // told so. The class relay costs ten units; preparing the class it would
  // have kept costs some hundreds of times that, and the exact weights live in
  // one place only — the docblock on UNITS_PER_DAY in gate.ts.
  if (relay === 'class') {
    if (req.method !== 'POST') return fail(405, 'POST only');
    if (!deps.keep) return fail(501, 'this host cannot keep a class');
  }
  // A speech body that is not a line, or a line too long for one breath, is
  // refused here: the meter prices the text, and must never price that.
  if (relay === 'speech') {
    const read = readSpeech(req);
    if (!read.ok) return fail(read.status, read.why);
  }

  const admitted = await admit(req, relay, deps.gate);
  if (!admitted.ok) return admitted.response;

  /**
   * WHICH PREPARATION THIS CALL BELONGS TO, when the app says.
   *
   * S — how many students share one preparation — is the whole cost model,
   * and 0018 poured usage_event.prep_id so it could finally be measured.
   * An optional x-prep-id header fills it. VALIDATED OR DROPPED, never
   * trusted: a header is browser input, and browser input does not get to
   * write unvalidated bytes into the cost books — a non-uuid would only
   * bounce off the column type later and cost the whole usage row.
   */
  const said = req.headers['x-prep-id'] ?? req.headers['X-Prep-Id'];
  const prepId = typeof said === 'string' && isUuid(said) ? said.toLowerCase() : null;

  // Usage is recorded on the way OUT, never in the way. `void` because a
  // slow or absent accounting sink must not delay the reply; the sink itself
  // swallows its errors.
  const base = { userId: admitted.userId, sessionId: sessionOf(req, relay), prepId };
  const note = (event: Parameters<Usage['record']>[0]): void => {
    if (!deps.usage) return;
    // Both a synchronous throw and a rejected promise are caught HERE, not
    // trusted to the sink. On Deno an unhandled rejection is not a log line,
    // it can take the isolate down mid-reply - and this was reachable: the
    // first test of a throwing sink passed its assertion and still leaked one.
    try {
      void deps.usage.record(event).catch(() => undefined);
    } catch {
      // A sink that throws before returning a promise. Same answer.
    }
  };

  if (relay === 'llm') {
    if (deps.vertex) {
      if (req.method !== 'POST') return fail(405, 'POST only');
      // Before the parse, not after: a refusal should not cost the memory of
      // decoding what it is refusing.
      if (req.body.byteLength > MAX_REQUEST_BYTES) {
        return fail(413, 'that request is larger than anything this app sends');
      }
      let chat: unknown;
      try {
        chat = JSON.parse(new TextDecoder().decode(req.body));
      } catch {
        return fail(400, 'the request body was not JSON');
      }
      const answer = await completeOnVertex(chat as Parameters<typeof completeOnVertex>[0], deps.vertex);
      // The name the BOOKS know, not the name the browser sent. Callers speak
      // OpenAI and ask for `google/gemini-3.7-flash`; model_price stores the
      // Vertex name. Recording the prefixed one made price_at() miss every row
      // and every LLM call read as free. completeOnVertex already strips it.
      const model = bareModel(String((chat as { model?: unknown })?.model ?? ''));
      note(usageFromVertex(base, model, answer.status, answer.status === 200 ? (answer.body as OpenAiReply) : undefined));
      return {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
        body: { kind: 'json', value: answer.body },
      };
    }
    const out = llmRelay(req, deps.key);
    if (out.status === 200) note(usageFromOpenRouterLlm(base, req.body));
    return out;
  }
  if (relay === 'speech') {
    const read = readSpeech(req);
    if (!read.ok) return fail(read.status, read.why);
    const asked = read.input;
    const text = asked.text;
    /**
     * HER VOICE IS GEMINI ON VERTEX (Aarav, 2026-09-28): no OpenRouter and no
     * Deepgram for speech wherever Vertex is configured — aura-2 has no Indian
     * voice and cannot speak Hinglish. `format=pcm` streams raw PCM to the
     * app's Web Audio player as Vertex makes it; anything else (an old
     * bundle's `<audio src>`) gets the line collected into one WAV. The client
     * cannot choose the model or the voice here — both are fixed server-side,
     * which also closes the `?model=` route that let a caller pick a vendor.
     * See vertexSpeech.ts for what it measured and what it costs.
     */
    const vertex = deps.vertex;
    if (vertex) {
      if (!text) return fail(400, 'nothing to say');
      const lang = asked.lang === 'hi-en' ? 'hi-en' : 'en';
      const collected = async (format: 'pcm' | 'wav'): Promise<RelayResponse> => {
        const spoken = await speakOnVertex(text, vertex, { format, lang });
        note(usageFromVertexSpeech(base, VERTEX_SPEECH_MODEL, spoken));
        return spoken.response;
      };
      if (asked.format !== 'pcm') return collected('wav');

      let call: Awaited<ReturnType<typeof vertexSpeechCall>>;
      try {
        call = await vertexSpeechCall(text, lang, vertex);
      } catch (e) {
        return fail(502, `Google auth failed: ${(e as Error).message}`);
      }
      return {
        status: 200,
        headers: {},
        body: {
          kind: 'stream',
          from: {
            url: call.url,
            method: 'POST',
            headers: call.headers,
            body: call.body,
            fallbackContentType: PCM_CONTENT_TYPE,
            contentType: PCM_CONTENT_TYPE,
            // Booked when the stream ends or is cancelled: Vertex's own counts,
            // or an estimate from the audio when its count never arrived.
            // Ended early if it runs far past what the line needs (#1).
            transform: () =>
              sseToPcm(
                (u) =>
                  note(
                    usageFromVertexSpeech(base, VERTEX_SPEECH_MODEL, {
                      status: u.audioBytes > 0 ? 200 : 502,
                      ...u,
                      // Vertex's count arrives in the last event; a line the
                      // cap or the student ended never got it (third review).
                      ...(u.outputTokens === undefined && u.audioBytes > 0
                        ? { outputTokens: estimatedSpeechTokens(u.audioBytes) }
                        : {}),
                    }),
                  ),
                { maxAudioBytes: maxSpeechBytes(text) },
              ),
            // A stream that will not start (a 429, a 5xx) gets one collected retry.
            orElse: () => collected('pcm'),
          },
        },
      };
    }

    // No service account (a laptop): the OpenRouter voice, as before.
    const out = speechRelay(req, deps.key, deps.speechUrl, text);
    if (out.body.kind === 'stream') {
      const model = new URL(req.url, 'http://relay.local').searchParams.get('model') ?? DEFAULT_SPEECH_MODEL;
      return {
        ...out,
        body: {
          kind: 'stream',
          from: {
            ...out.body.from,
            // Booked when the host sees the vendor answer, not at dispatch.
            onServed: () => note(usageFromSpeech(base, model, text, 200)),
          },
        },
      };
    }
    return out;
  }

  if (relay === 'class') {
    // I1: readSavedClass validates lesson.json and screens its spine before
    // anything is written, and the Edge Function's keeper stores the class
    // 'pending' — kept, not published (classStore.ts).
    const saved = readSavedClass(req.body);
    if (!saved.ok) return saved.response;
    const kept = await deps.keep!(saved.value);
    note(usageFromClass(base, kept.status, req.body.byteLength));
    return kept;
  }

  // HER EAR IS GEMINI ON VERTEX wherever Vertex is configured (vertexHear.ts);
  // the same guards as before, then no OpenRouter call at all.
  const heard = hearRelay(req, deps.key, !deps.vertex);
  if (!heard.ok) return heard.response;
  if (deps.vertex) {
    const transcript = await hearOnVertex(heard.audio, heard.contentType, deps.vertex);
    note(usageFromVertexHear(base, VERTEX_HEAR_MODEL, transcript, heard.audio));
    return transcript.response;
  }
  const { model, language, contentType, audio } = heard;
  const transcribed = await deps.transcribe({ model, language, contentType, audio });
  note(usageFromHear(base, heard.model, transcribed.status, heard.audio));
  return transcribed;
}
