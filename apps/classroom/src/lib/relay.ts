import { supabase } from './supabase';
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
  try {
    const { data, error } = await db.auth.signInAnonymously();
    if (error) {
      console.error('[relay] could not start an anonymous session:', error.message);
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
  return fetch(relayUrl(path), { ...init, headers });
}

/**
 * What went wrong, in the words the student should see.
 *
 * The relay refuses for reasons a student can act on — too much at once,
 * nothing left in today's budget, the meter is down — and it writes those
 * refusals as sentences. Wrapping one in "LLM 429:" turns a sentence somebody
 * can respond to back into a status code. Anything else keeps the technical
 * form, because anything else is ours to debug.
 */
export function relayError(status: number, body: { error?: { message?: string } } | null): Error {
  const said = body?.error?.message;
  if (said && (status === 429 || status === 503)) return new Error(said);
  return new Error(said ? `relay ${status}: ${said}` : `relay ${status}`);
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

/** Renewed a minute early, so a line never waits on the round trip. */
const RENEW_BEFORE_MS = 60_000;

const fresh = (at: number): boolean => ticket !== null && ticket.expiresAt - at > RENEW_BEFORE_MS;

async function mint(): Promise<string | null> {
  try {
    const res = await relayFetch('/api/ticket', { method: 'POST' });
    if (!res.ok) return null;
    const body = (await res.json()) as { ticket?: unknown; expiresAt?: unknown };
    if (typeof body.ticket !== 'string' || typeof body.expiresAt !== 'number') return null;
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

/** Drop the remembered ticket. Called on sign-out: it names the old student. */
export function forgetTicket(): void {
  ticket = null;
  minting = null;
  signingIn = null;
}
