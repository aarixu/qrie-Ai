import { supabase } from './supabase';
import { currentSessionId } from '../stores/ledger';
import { isNative } from './platform';

/**
 * HOW THE APP TALKS TO ITS OWN BACKEND.
 *
 * Every relay call goes through here, for two reasons that used to be spread
 * across six files:
 *
 *   1. WHERE. In dev the relays are vite middleware at /api/*; in production
 *      they are one Supabase Edge Function at <project>/functions/v1/relay/*.
 *      One base URL, read from the environment, so no caller has to know.
 *   2. WHO. Every relay now demands a verified caller, because behind each one
 *      is somebody's money. The Authorization header is attached here so that
 *      a new caller cannot forget it — the failure mode of forgetting is a 401
 *      in the middle of a class, and the failure mode of REMEMBERING to check
 *      is nothing at all.
 *
 * The speech relay is the exception and gets a ticket instead; `speechUrl`
 * below explains why.
 */

/**
 * Where the relays live.
 *
 * Empty in dev, which leaves the paths relative and the vite middleware
 * answers them. Set to the deployed function's base in production. Both are
 * public — it is a URL, not a secret.
 */
const BASE = ((import.meta.env.VITE_RELAY_URL as string | undefined) || '').replace(/\/+$/, '');

/**
 * INSIDE THE SHELL THIS IS NOT OPTIONAL.
 *
 * On the web an empty base leaves the paths relative and the dev server — or
 * the deployed origin — answers them. In the native app there is no origin to
 * fall back to: "/api/llm" resolves against the shell's own scheme, where
 * nothing is listening, and every class fails with something that looks like a
 * bug in the app rather than a missing setting.
 *
 * So a native build without VITE_RELAY_URL is a build that cannot teach, and
 * it says so once, loudly, at startup rather than silently per request.
 */
if (isNative() && BASE === '') {
  console.error(
    '[relay] VITE_RELAY_URL is not set. Inside the app every relay call will fail — ' +
      'set it to the deployed Edge Function base before building.',
  );
}

export const relayUrl = (path: string): string => `${BASE}${path}`;

/**
 * EVERY STUDENT HAS AN IDENTITY, INCLUDING THE ONES WHO NEVER SIGN UP.
 *
 * "Reject anonymous callers" and "you do not have to sign up to learn" look
 * like opposites and are not: Supabase's anonymous sign-in mints a real auth
 * user for the device, so every call is attributable and limitable, and the
 * day the student signs in with an email that same user is linked rather than
 * replaced. The alternative — an open relay for anybody who has not signed up
 * — is the hole this whole layer exists to close.
 *
 * Needs "Allow anonymous sign-ins" switched on for the project. Until it is,
 * this returns null and the relays refuse, which is the correct direction to
 * fail: no class is worse than an unmetered one, but only for the moment it
 * takes to flip a switch.
 */
/**
 * One sign-in at a time.
 *
 * A class opens with several relay calls at once — the planner, the artist,
 * the icon lookup — and on a fresh device every one of them would find no
 * session and ask for an anonymous account of its own. That mints several
 * users for one student, only one of which is kept, so the others become
 * orphaned rows and the meter counts a fraction of what was actually spent.
 * The ticket below already had this guard; the session needed it more.
 */
let signingIn: Promise<string | null> | null = null;

async function startAnonymousSession(): Promise<string | null> {
  const db = supabase();
  if (!db) return null;
  // The era `forgetTicket` moves on, read BEFORE the request. The ticket had
  // this guard and the session — which is the thing that decides who the
  // student IS — did not: a sign-in already on the wire when somebody signs
  // out lands afterwards, and `signInAnonymously` writes its session straight
  // into the Supabase client's own storage. So the person who just signed out
  // was silently signed back in as a fresh anonymous user, and the next class
  // was recorded under a stranger.
  const askedIn = era;
  try {
    const { data, error } = await db.auth.signInAnonymously();
    if (error) {
      console.error('[relay] could not start an anonymous session:', error.message);
      return null;
    }
    if (askedIn !== era) {
      // Returning null is not enough on its own — the SDK has already stored
      // the session, so the next `accessToken()` would find it and carry on.
      // It has to be taken back out.
      void db.auth.signOut();
      return null;
    }
    return data.session?.access_token ?? null;
  } finally {
    signingIn = null;
  }
}

async function accessToken(): Promise<string | null> {
  const db = supabase();
  if (!db) return null;

  const { data } = await db.auth.getSession();
  if (data.session) return data.session.access_token;

  signingIn ??= startAnonymousSession();
  return signingIn;
}

/**
 * Establish the student's identity NOW, rather than on the first relay call.
 *
 * Lazy was fine while the only thing that needed an identity was a relay call —
 * it arrived exactly when it was needed and cost a fresh device nothing. The
 * interaction ledger broke that assumption: a student replaying a cached class
 * with on-device speech makes no relay call at all, so no session was ever
 * created, and every event they produced sat in the outbox reporting
 * `no-account` until the cap discarded the oldest.
 *
 * Same dedupe as before — `accessToken` returns the in-flight promise — so
 * calling this at start-up alongside a class opening still mints one user.
 */
export async function ensureIdentity(): Promise<boolean> {
  return (await accessToken()) !== null;
}

/**
 * A relay call with the student's identity attached.
 *
 * Anything that talks to /api/llm, /api/hear or /api/class goes through this.
 * A caller may still set its own headers and body; only Authorization is
 * decided here.
 */
export async function relayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  // Which sitting this call belongs to, so the server can attribute what it
  // cost. Absent outside a class, and that is fine.
  const session = currentSessionId();
  if (session) headers.set('x-session-id', session);
  // And which PREPARATION, when one is running. A caller that set the header
  // itself keeps it — `prepPost` in lib/liveClass.ts names its own, and an
  // explicitly named preparation must beat an ambient one rather than be
  // silently overwritten.
  if (preparing !== null && !headers.has('x-prep-id')) headers.set('x-prep-id', preparing);
  return fetch(relayUrl(path), { ...init, headers });
}

/**
 * ==========================================================================
 * WHICH PREPARATION THIS CALL PAID FOR.
 * ==========================================================================
 *
 * S - how many students share one preparation - is the whole cost model, and
 * `usage_event.prep_id` (column poured by 0018, written from 0019's
 * `record_usage`) exists to measure it. The relay fills it from an optional
 * `x-prep-id` header, validated as a uuid or DROPPED (handler.ts:373). The
 * pre-warm CLI sends it.
 *
 * THE BROWSER DID NOT, WHERE IT MATTERED. liveClass.ts stamped it on
 * /api/prep/lock, /renew and /release — all three metered at ZERO units. The
 * rupees are the planner and the artist on /api/llm, and those go through
 * `createBrowserLlm` -> `relayFetch`, which sent no prep id at all. So prep
 * attribution worked for the CLI and not for a student preparing their own
 * class, which is the case the cost model is actually about.
 *
 * AND IT STILL DOES NOT, TODAY. What follows is the way to carry one; NOTHING
 * IN THE APP OPENS A SCOPE YET. The wiring is one call in lib/liveClass.ts, at
 * the site that already holds the id from `takePrepLock`, and until it lands
 * /api/llm leaves the browser with no prep id exactly as before. Read the rest
 * of this block as a mechanism, not as a description of what the app does.
 *
 * WHAT A SCOPE ATTRIBUTES, SAID PLAINLY BEFORE ANYBODY WRAPS ONE. Every relay
 * call made while it is open, by anybody, on any path — not only the
 * preparation's own. That matters here because the class STARTS PLAYING inside
 * the preparation: `onDraft` puts it on screen while the artist is still
 * working (screens/LiveClass.tsx), so a scope around the whole of
 * `prepareLiveClass` would bill the judge, the ear and the speech tickets of a
 * child already watching to `prep_id` - per-student playback rupees landing in
 * the column that exists to measure per-preparation ones. Wrap the planner and
 * the artist, or pass `prepId` to the adapters they use; do not wrap a window
 * of wall-clock time that playback is inside.
 *
 * WHY IT MAY TRAVEL AT ALL. A prep id is OUR vocabulary: a uuid this app mints
 * per preparation, carrying nothing about the student. Identity is the bearer
 * token and stays there (see WHO HOLDS IT on `takePrepLock`). Nothing else
 * belongs on this seam — a header that leaves the browser on every relay call
 * is the last place a piece of a child's data should be put.
 *
 * WHY A SCOPE AND NOT A SETTER. A bare `setPrepId` left set is a preparation id
 * stamped on the whole class after it — playback spend attributed to a
 * preparation that finished — and nothing would say so, because the relay drops
 * only a MALFORMED id and this one is well-formed and wrong. A scope cannot be
 * left set: the `finally` restores whatever was there before, so a nested or
 * re-entrant preparation also unwinds correctly.
 *
 * HONESTLY: it is one module-level variable, so two preparations running at
 * once IN ONE TAB would both be attributed to the inner one for as long as it
 * is open. The app prepares one class at a time, and the alternative - threading
 * the id through every adapter to every call site - is the arrangement that left
 * this unwired in the first place.
 */
let preparing: string | null = null;

/** The preparation this tab is inside, if any. Attribution only, never identity. */
export const currentPrepId = (): string | null => preparing;

export async function duringPreparation<T>(prepId: string, run: () => Promise<T>): Promise<T> {
  const before = preparing;
  // The era `forgetTicket` moves on, read here for the same reason the ticket
  // reads it: a student may sign out while this is still unwinding, and putting
  // `before` back would then stamp a departed student's preparation on the next
  // student's calls. Restore only into the era we started in.
  const startedIn = era;
  preparing = prepId;
  try {
    return await run();
  } finally {
    if (era === startedIn) preparing = before;
  }
}

/**
 * A RELAY FAILURE, WITH THE EVIDENCE STILL ON IT.
 *
 * An ordinary `Error` plus the two things the relay actually said. It is still
 * an Error and `message` is untouched, so every `catch` that renders
 * `error.message` renders exactly the same sentence it did before.
 */
export interface RelayFailure extends Error {
  /** The HTTP status the relay answered with. A 429 and a 503 are different refusals. */
  status: number;
  /**
   * The relay's own name for the refusal - gate.ts sends `rate`, `budget`,
   * `halted`, `capped` or `unavailable` beside the sentence. Absent when the
   * body carried none, which is most non-refusals.
   */
  reason?: string;
}

/**
 * The mark `relayError` puts on what it builds.
 *
 * BRANDED RATHER THAN DUCK-TYPED, because the predicate below is a promise
 * about `message`: that it is a sentence the relay wrote, and for a 429 or a
 * 503 a sentence written for a CHILD to read. "An Error with a numeric status"
 * is also true of a Supabase error and of most HTTP clients, so a structural
 * check would let an internal string be shown to a student the day one of those
 * reaches the same catch. `Symbol.for` so the mark survives a module loaded
 * twice, which is an ordinary thing for a test runner to do.
 */
const RELAY_FAILURE = Symbol.for('curie.relay.failure');

/** A thrown thing the relay produced, as opposed to a dropped connection. */
export const isRelayFailure = (thrown: unknown): thrown is RelayFailure =>
  thrown instanceof Error && (thrown as unknown as Record<symbol, unknown>)[RELAY_FAILURE] === true;

/**
 * What went wrong, in the words the student should see.
 *
 * The relay refuses for reasons a student can act on — too much at once,
 * nothing left in today's budget, the meter is down — and it writes those
 * refusals as sentences. Wrapping one in "LLM 429:" turns a sentence somebody
 * can respond to back into a status code. Anything else keeps the technical
 * form, because anything else is ours to debug.
 *
 * AND THE STATUS SURVIVES NOW, WHICH IS THE POINT OF THE SENTENCE IN THE FIRST
 * PLACE. gate.ts is careful about exactly two codes: 429 is the student's own
 * rate or their own day, 503 is OUR capacity or OUR outage and its wording
 * deliberately does not hand a child a fault they do not have (gate.ts:198).
 * Returning `new Error(said)` kept the sentence and threw that distinction
 * away, so `lib/refusal.ts` had to recover it by comparing the sentence,
 * character for character, against a second copy of gate.ts's prose - a string
 * comparison standing between a child and being told whose fault something is,
 * which breaks the day anybody rewords a refusal.
 *
 * IT STILL COMPARES THE SENTENCE TODAY. Carrying the evidence is half the job;
 * teaching `readRefusal` to read it is the other half, and that file was not
 * this phase's to edit. Until it is, the past tense above is about what
 * `relayError` drops, not about what refusal.ts does. The coupling is asserted
 * out loud in tests/refusal.test.ts and again in tests/whyProbePlayback.test.ts
 * so a reword fails a test rather than a child's screen.
 *
 * `reason` is the machine-readable half gate.ts already sends in the same body.
 * It is validated as a string and otherwise dropped, for the same reason the
 * relay validates the prep id: a response body is still input.
 */
export function relayError(
  status: number,
  body: { error?: { message?: string; reason?: string } } | null,
): RelayFailure {
  const said = body?.error?.message;
  const error = (
    said && (status === 429 || status === 503)
      ? new Error(said)
      : new Error(said ? `relay ${status}: ${said}` : `relay ${status}`)
  ) as RelayFailure;
  error.status = status;
  const reason = body?.error?.reason;
  if (typeof reason === 'string') error.reason = reason;
  // Non-enumerable, so the mark does not turn up in a log line or a JSON copy
  // of the error; `isRelayFailure` is the only thing meant to read it.
  Object.defineProperty(error, RELAY_FAILURE, { value: true });
  return error;
}

/**
 * A PASS FOR HER VOICE.
 *
 * Speech is fetched by assigning a URL to an `<audio>` element, which is what
 * lets a line start playing on its first chunk off the wire — 0.36 s instead
 * of 2.5. An audio element cannot send an Authorization header, and fetching
 * the whole file first to get one on would undo exactly that.
 *
 * So the app asks the relay for a ticket: a signed, ten-minute, speech-only
 * string that names the student and nothing else. It goes in the query string,
 * where a session token must never go — a ticket in a log costs a few minutes
 * of text-to-speech, a session costs the account.
 *
 * Held in memory and re-minted a minute before it lapses, so a long class
 * never stops mid-sentence to ask for one.
 */
let ticket: { value: string; expiresAt: number } | null = null;
let minting: Promise<string | null> | null = null;

/**
 * WHICH STUDENT THIS COUNTER IS ON.
 *
 * Dropping the ticket on sign-out is not enough on its own: a mint that was
 * already in flight when they signed out resolves a moment later and writes the
 * old student's pass back into the slot that was just cleared — clearing
 * `minting` abandons the promise, it does not cancel the request. So a reply is
 * only kept if the identity has not changed underneath it.
 */
let era = 0;

/** Renewed a minute early, so a line never waits on the round trip. */
const RENEW_BEFORE_MS = 60_000;

const fresh = (at: number): boolean => ticket !== null && ticket.expiresAt - at > RENEW_BEFORE_MS;

async function mint(): Promise<string | null> {
  const askedIn = era;
  try {
    const res = await relayFetch('/api/ticket', { method: 'POST' });
    if (!res.ok) return null;
    const body = (await res.json()) as { ticket?: unknown; expiresAt?: unknown };
    if (typeof body.ticket !== 'string' || typeof body.expiresAt !== 'number') return null;
    // Somebody signed out while this was on the wire. The pass names a student
    // who has left; storing it now would undo the sign-out.
    if (askedIn !== era) return null;
    ticket = { value: body.ticket, expiresAt: body.expiresAt };
    return ticket.value;
  } catch {
    // No ticket means no voice for this line. The class still runs, in the
    // browser's own fallback voice — see createStreamingTts.
    return null;
  } finally {
    minting = null;
  }
}

/** Get a ticket, waiting for one if there is none. */
export async function speechTicket(): Promise<string | null> {
  if (fresh(Date.now())) return ticket!.value;
  // One in flight at a time: a class opens its voice once, but the renewal
  // below can fire on several lines in the same second.
  minting ??= mint();
  return minting;
}

/**
 * The ticket to put on THIS line, right now.
 *
 * Synchronous on purpose: it is read while building the URL for an audio
 * element, and an await there would be a pause in the middle of her speaking.
 * A class can easily outlive a ten-minute ticket, so this also starts the
 * renewal — a minute early, in the background, while the current ticket is
 * still good.
 */
export function currentSpeechTicket(): string | null {
  if (!fresh(Date.now())) void speechTicket();
  return ticket?.value ?? null;
}

/**
 * Drop the remembered ticket. Called by `signOut` in lib/supabase.ts, because
 * this string names the student who has just left and the relay meters voice
 * against whoever it names — on a shared phone the next student was spending
 * the previous one's budget for up to ten minutes.
 *
 * That the two files import each other is deliberate and safe: neither one
 * touches the other during module evaluation, only inside a function that runs
 * long after both are loaded. The alternative was for each screen with a sign-
 * out button to remember to call this, which is the arrangement that left it
 * with no caller at all.
 *
 * The in-flight promises go with it, and the era moves on so the ones already
 * on the wire cannot land in the slot they were just cleared from.
 */
export function forgetTicket(): void {
  era += 1;
  ticket = null;
  minting = null;
  signingIn = null;
  // The preparation the previous student was inside is over as far as this app
  // is concerned. The era above is what makes that stick: a `duringPreparation`
  // still unwinding restores what it saved only if the era has not moved, so a
  // nested scope cannot put the departed student's outer preparation back and
  // have it stamped on the next student's calls. Nothing drops the id in flight
  // — a request already on the wire keeps the header it left with.
  preparing = null;
}
