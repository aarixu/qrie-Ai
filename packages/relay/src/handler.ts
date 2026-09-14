import {
  fail,
  hearRelay,
  llmRelay,
  speechRelay,
  type RelayRequest,
  type RelayResponse,
  type SavedClass,
} from './relays.ts';
import { admit, type Gate, type RelayName } from './gate.ts';
import { mintTicket, TICKET_TTL_MS } from './ticket.ts';
import { readSavedClass } from './classStore.ts';
import { MAX_REQUEST_BYTES, completeOnVertex, type OpenAiReply, type VertexOptions } from './vertex.ts';
import { DEFAULT_SPEECH_MODEL } from './relays.ts';
import {
  usageFromClass,
  usageFromHear,
  usageFromOpenRouterLlm,
  usageFromSpeech,
  usageFromVertex,
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
   * voice is Deepgram aura-2 through OpenRouter, and Google's own voices are
   * a different person. Speech is on its way to being on-device anyway, so
   * moving it now would be work spent on something being replaced.
   */
  key: string;
  /**
   * OUR OWN SPEECH SERVICE, WHEN THERE IS ONE.
   *
   * The base URL of `tools/speech` — a box running Piper. Her voice is 86% of
   * what a class costs and all of it is cash; this is the line that turns it
   * into rent. Absent, speech goes to the vendor exactly as it did.
   *
   * No credential travels with it, because there is none to travel.
   */
  speechUrl?: string;
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
   * Hand raw audio to a transcriber. Left to the host because it is the one
   * place a platform's FormData shows through; `transcribeViaFormData` in
   * web.ts is the implementation both hosts use.
   */
  transcribe(model: string, contentType: string, audio: Uint8Array): Promise<RelayResponse>;
  /**
   * Keep a class the tutor just made, so the next student gets it free.
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
  now?: () => number;
}

/**
 * Which learning session a call belongs to, when the app said.
 *
 * A header for the relays a fetch reaches; a query parameter for speech, which
 * is an <audio src> and cannot send one. Absent is ordinary: a call made from
 * the Home screen belongs to no sitting.
 */
function sessionOf(req: RelayRequest, relay: RelayName): string | null {
  if (relay === 'speech') {
    return new URL(req.url, 'http://relay.local').searchParams.get('session');
  }
  return req.headers['x-session-id'] ?? req.headers['X-Session-Id'] ?? null;
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
 * Route, admit, then relay.
 *
 * The order matters and is the whole point of the file: NOTHING reaches
 * OpenRouter before `admit` has said who is asking and that they are within
 * their limits. A relay that spends first and checks after is a relay with no
 * limit at all.
 */
export async function handleRelay(req: RelayRequest, deps: HandlerDeps): Promise<RelayResponse> {
  const path = new URL(req.url, 'http://relay.local').pathname;
  if (path.split('/').filter(Boolean).pop() === 'ticket') {
    return handleTicket(req, deps.gate);
  }

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
  // told so — five units is a fortieth of a prepared class.
  if (relay === 'class') {
    if (req.method !== 'POST') return fail(405, 'POST only');
    if (!deps.keep) return fail(501, 'this host cannot keep a class');
  }

  const admitted = await admit(req, relay, deps.gate);
  if (!admitted.ok) return admitted.response;

  // Usage is recorded on the way OUT, never in the way. `void` because a
  // slow or absent accounting sink must not delay the reply; the sink itself
  // swallows its errors.
  const base = { userId: admitted.userId, sessionId: sessionOf(req, relay) };
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
      const model = String((chat as { model?: unknown })?.model ?? '');
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
    const out = speechRelay(req, deps.key, deps.speechUrl);
    if (out.status === 200) {
      const asked = new URL(req.url, 'http://relay.local').searchParams;
      note(usageFromSpeech(base, asked.get('model') ?? DEFAULT_SPEECH_MODEL, asked.get('text') ?? ''));
    }
    return out;
  }

  if (relay === 'class') {
    const saved = readSavedClass(req.body);
    if (!saved.ok) return saved.response;
    const kept = await deps.keep!(saved.value);
    note(usageFromClass(base, kept.status, req.body.byteLength));
    return kept;
  }

  const heard = hearRelay(req, deps.key);
  if (!heard.ok) return heard.response;
  const transcribed = await deps.transcribe(heard.model, heard.contentType, heard.audio);
  note(usageFromHear(base, heard.model, transcribed.status, heard.audio));
  return transcribed;
}
