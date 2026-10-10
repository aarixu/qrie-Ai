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
 * failures. The address is counted under callerKey (below), which a caller
 * cannot set to someone else's by naming it in x-forwarded-for. A request
 * with no address is not held to that limit; the per-ID lockout still
 * applies.
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
  /** The key the per-address limit counts this try under (callerKey), when there is one. */
  ip?: string;
}

export interface SignInReply {
  status: number;
  body: unknown;
}

/**
 * The most a sign-in's body may be: bytes as serveSignIn reads it, characters
 * once read. An ID and PIN take well under a hundred.
 */
export const MAX_BODY = 512;

const lengths = Object.values(PIN_LENGTH);
const PIN = new RegExp(`^[0-9]{${Math.min(...lengths)},${Math.max(...lengths)}}$`);

// What pinMatches is given for an ID with no row: it does the same work as
// for a real one, and matches nothing.
const NO_SALT = '0'.repeat(32);
const NO_VERIFIER = '0'.repeat(64);

type Gate = { verdict: 'busy' | 'locked' | 'unknown' } | { verdict: 'check'; salt: string; verifier: string };

const TOO_LARGE = 'That request is too large.';

/** The headers callerKey reads: a fetch Request's, or any with get. */
export interface HeaderSource {
  get(name: string): string | null;
}

/** The longest key lms.sign_in_ip keeps (0046 cuts a longer one short). */
const KEY_MAX = 64;

const utf8 = new TextEncoder();

function ipv4(text: string): number[] | undefined {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)?.slice(1).map(Number);
  return parts && parts.every((n) => n <= 255) ? parts : undefined;
}

/** An IPv6 address's eight 16-bit groups; undefined when the text is not one. */
function ipv6(text: string): number[] | undefined {
  let rest = text;
  const tail: number[] = [];
  // The last 32 bits may be written as IPv4 (::ffff:198.51.100.5).
  const dotted = /^(.*:)([^:]+\.[^:]+)$/.exec(text);
  if (dotted) {
    const v4 = ipv4(dotted[2]);
    if (!v4) return undefined;
    tail.push(v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]);
    rest = dotted[1].endsWith('::') ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = rest.split('::');
  if (halves.length > 2) return undefined;
  const groupsOf = (half: string) => (half === '' ? [] : half.split(':'));
  const head = groupsOf(halves[0]);
  const back = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (![...head, ...back].every((g) => /^[0-9A-Fa-f]{1,4}$/.test(g))) return undefined;
  const room = 8 - tail.length;
  const given = head.length + back.length;
  // Without '::' every group is written; '::' stands for one or more.
  if (halves.length === 1 ? given !== room : given >= room) return undefined;
  const zeros = Array<string>(room - given).fill('0');
  return [...head, ...zeros, ...back].map((g) => parseInt(g, 16)).concat(tail);
}

/** One address, written the one way callerKey counts it; undefined when the text is not an address. */
function addressKey(text: string): string | undefined {
  const written = text.trim();
  // The longest way to write an IPv6 address is 45 characters.
  if (written.length > 45) return undefined;
  const v4 = ipv4(written);
  if (v4) return v4.join('.');
  const g = ipv6(written);
  if (!g) return undefined;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  return `${g
    .slice(0, 4)
    .map((n) => n.toString(16))
    .join(':')}::/64`;
}

/**
 * The key the per-address limit counts a try under, read from headers a
 * caller cannot fill with somebody else's address:
 *
 * - cf-connecting-ip, when it holds an address. Cloudflare sets it to the
 *   address that connected to Cloudflare. If a request could reach the
 *   function without Cloudflare setting it, its caller could write any
 *   address there; whether that can happen on the deployed project has not
 *   been checked (the security review's finding 1 says how to check).
 * - Otherwise the whole x-forwarded-for chain, never its first entry alone.
 *   Each proxy appends the address it was reached from to whatever the
 *   caller sent, so a caller who names someone else's address first still
 *   has a chain of their own and spends only that chain's budget. Naming a
 *   new address each time dodges the limit; the per-ID lockout still holds.
 *
 * Each address is written one way: IPv4 as four numbers, IPv4 written as
 * IPv6 (::ffff:198.51.100.5) as IPv4, and IPv6 as its /64
 * (2001:db8:1:2::/64), because an IPv6 customer is usually given a whole /64
 * and can use any address in it. Entries of x-forwarded-for that are not
 * addresses are left out. A chain longer than the 64 characters
 * lms.sign_in_ip keeps is replaced by its SHA-256 in hex: 64 hex digits,
 * which no written chain is (each address in one has a dot or a colon), and
 * never cut short to an opening someone else's chain could begin with.
 *
 * Undefined when neither header holds an address.
 */
export async function callerKey(headers: HeaderSource): Promise<string | undefined> {
  const connecting = addressKey(headers.get('cf-connecting-ip') ?? '');
  if (connecting) return connecting;
  const chain = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => addressKey(entry))
    .filter((address): address is string => address !== undefined)
    .join(',');
  if (!chain) return undefined;
  if (chain.length <= KEY_MAX) return chain;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(chain)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

const reply = (status: number, error: string): SignInReply => ({ status, body: { error } });

export async function handleSignIn(req: SignInRequest, deps: SignInDeps): Promise<SignInReply> {
  if (req.method !== 'POST') return reply(405, 'POST only.');
  if (req.body.length > MAX_BODY) return reply(413, TOO_LARGE);
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

/** What the lms-signin function sends with every answer: JSON, never cached, open to the apps' pages. */
export const SIGN_IN_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

/** A request as the lms-signin function receives it; a fetch Request is one. */
export interface SignInHttpRequest {
  method: string;
  headers: HeaderSource;
  body: ReadableStream<Uint8Array> | null;
}

/**
 * A body, read no further than the chunk that takes it past `max` bytes:
 * undefined, and the rest of the stream cancelled, when it is longer than
 * that. Throws what the stream throws, as when the caller hangs up halfway.
 */
async function readCapped(stream: ReadableStream<Uint8Array> | null, max: number): Promise<string | undefined> {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * The lms-signin function's answer to a request, with SIGN_IN_HEADERS on
 * every one. A POST's body is refused unread when its declared length is over
 * MAX_BODY, and otherwise read through readCapped inside a try: too long gets
 * 413, unreadable gets 400. The rest is handleSignIn's, with the caller's
 * callerKey. The function itself answers OPTIONS and a missing setup.
 */
export async function serveSignIn(request: SignInHttpRequest, deps: SignInDeps): Promise<Response> {
  const send = (out: SignInReply) => new Response(JSON.stringify(out.body), { status: out.status, headers: SIGN_IN_HEADERS });
  let body = '';
  if (request.method === 'POST') {
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY) return send(reply(413, TOO_LARGE));
    try {
      const read = await readCapped(request.body, MAX_BODY);
      if (read === undefined) return send(reply(413, TOO_LARGE));
      body = read;
    } catch {
      return send(reply(400, 'That request could not be read.'));
    }
  }
  return send(await handleSignIn({ method: request.method, body, ip: await callerKey(request.headers) }, deps));
}
