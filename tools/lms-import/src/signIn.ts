import { CLOSED, LOCKED, NETWORK_LIMIT, WRONG_PIN } from '../../../packages/lms-client/src/backend.ts';
import { SOMETHING_WENT_WRONG } from '../../../packages/lms-client/src/errors.ts';
import { normalLoginId } from '../../../packages/lms-client/src/login.ts';
import { PIN_LENGTH } from './pin.ts';
import { authPassword, pinMatches, type LmsRpc } from './pinGuard.ts';

/**
 * THE HOSTED SIGN-IN'S GUARD, as the lms-signin edge function serves it
 * (supabase/functions/lms-signin):
 *
 *   POST {loginId, pin} → 200 {password}   the account's Supabase Auth password
 *                       → 401 {error}      WRONG_PIN, LOCKED or CLOSED
 *                       → 429 {error}      NETWORK_LIMIT
 *
 * It answers as the demo server's sign-in does (tools/lms-demo/src/auth.ts),
 * in the same order: an unknown ID gets WRONG_PIN, after the same work as a
 * wrong PIN; a locked ID gets LOCKED, right PIN or not; the right PIN clears
 * the count and, for an account that has been closed, gets CLOSED; a wrong
 * one counts towards the lock. Five in a row lock the ID for fifteen minutes.
 * The count is kept in lms.sign_in_guard (0046) and taken before the PIN is
 * checked, so tries sent at the same moment get no more than five guesses.
 *
 * On top, a caller address that has had 200 tries not proven right in its
 * current 15-minute window is refused for every ID. Right PINs give their try
 * back, so a school signing in from behind one address is held only to its
 * failures. A request with no address is not held to that limit; the per-ID
 * lockout still applies.
 *
 * The password it returns is made from the ID and PIN with the pepper
 * (pinGuard.ts), so it can be had from here and nowhere else.
 */

export interface SignInDeps {
  /** One of 0046's lms functions, with the service role; its JSON answer. */
  rpc: LmsRpc;
  /** LMS_PIN_PEPPER. */
  pepper: string;
}

export interface SignInRequest {
  method: string;
  /** The request's body, unread. */
  body: string;
  /** The caller's address (clientIp), when there is one. */
  ip?: string;
}

export interface SignInReply {
  status: number;
  body: unknown;
}

/** Characters; an ID and PIN take well under a hundred. */
export const MAX_BODY = 512;

const lengths = Object.values(PIN_LENGTH);
const PIN = new RegExp(`^[0-9]{${Math.min(...lengths)},${Math.max(...lengths)}}$`);

// What pinMatches is given for an ID with no row: it does the same work as
// for a real one, and matches nothing.
const NO_SALT = '0'.repeat(32);
const NO_VERIFIER = '0'.repeat(64);

type Gate = { verdict: 'busy' | 'locked' | 'unknown' } | { verdict: 'check'; salt: string; verifier: string };

/**
 * The caller's address: the first in x-forwarded-for, lower-cased. Undefined
 * when the header is missing, or when its first entry is not 2 to 45 of the
 * characters addresses are written in (hex digits, dots and colons).
 */
export function clientIp(forwardedFor: string | null | undefined): string | undefined {
  const first = (forwardedFor ?? '').split(',')[0].trim();
  return /^[0-9A-Fa-f:.]{2,45}$/.test(first) ? first.toLowerCase() : undefined;
}

const reply = (status: number, error: string): SignInReply => ({ status, body: { error } });

export async function handleSignIn(req: SignInRequest, deps: SignInDeps): Promise<SignInReply> {
  if (req.method !== 'POST') return reply(405, 'POST only.');
  if (req.body.length > MAX_BODY) return reply(413, 'That request is too large.');
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(req.body);
  } catch {
    /* answered below */
  }
  const fields = (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
  if (typeof fields.loginId !== 'string' || typeof fields.pin !== 'string') return reply(400, 'Enter your ID and PIN.');
  const id = normalLoginId(fields.loginId);
  const pin = fields.pin;
  // No ID or PIN of this shape exists, so nothing is looked up or counted.
  if (!id || !PIN.test(pin)) return reply(401, WRONG_PIN);

  try {
    const ip = req.ip ?? null;
    const gate = (await deps.rpc('pin_guard_try', { p_login: id, p_ip: ip })) as Gate | null;
    if (gate?.verdict === 'busy') return reply(429, NETWORK_LIMIT);
    if (gate?.verdict === 'locked') return reply(401, LOCKED);
    if (gate?.verdict === 'unknown') {
      await pinMatches(deps.pepper, id, pin, NO_SALT, NO_VERIFIER);
      return reply(401, WRONG_PIN);
    }
    if (gate?.verdict !== 'check') throw new Error(`pin_guard_try answered ${JSON.stringify(gate)}`);
    if (!(await pinMatches(deps.pepper, id, pin, gate.salt, gate.verifier))) return reply(401, WRONG_PIN);
    // Said only to someone who knows the PIN, so it tells a stranger nothing.
    const passed = (await deps.rpc('pin_guard_passed', { p_login: id, p_ip: ip })) as { closed?: unknown } | null;
    if (passed?.closed !== false) return reply(401, CLOSED);
    return { status: 200, body: { password: await authPassword(deps.pepper, id, pin) } };
  } catch (e) {
    // The server's own words go to its log, not to the person signing in.
    console.error('lms-signin', e);
    return reply(500, SOMETHING_WENT_WRONG);
  }
}
