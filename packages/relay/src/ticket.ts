/**
 * A SHORT-LIVED PASS FOR THE ONE REQUEST THAT CANNOT CARRY A HEADER.
 *
 * Her voice arrives as `new Audio(url)`. That is not a stylistic choice: the
 * audio element starts playing on the first chunk off the wire, which is why a
 * line begins at 0.36 s instead of 2.5 s and why a class does not pause
 * between sentences. An `<audio src>` cannot send an Authorization header, and
 * fetching the whole file first to get one back would undo the entire reason
 * the streaming relay exists.
 *
 * So `/relay/speech` takes a ticket in its query string instead. A ticket is
 * NOT the student's Supabase token — putting that in a URL would spread a
 * full session across edge logs, referrers and browser history. It is a
 * signed, minute-scale, single-purpose string that says only "this user id may
 * ask for speech until this moment". Leaking one costs a few minutes of
 * text-to-speech; leaking a session costs the account.
 *
 * Signed with HMAC-SHA256 through Web Crypto, which Deno, Node and browsers
 * all have — so this file, like the rest of the package, runs anywhere.
 */

export interface Ticket {
  userId: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** Ten minutes: longer than any class beat, shorter than a session. */
export const TICKET_TTL_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();

const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64url = (text: string): Uint8Array | null => {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}

/**
 * Constant-time comparison.
 *
 * A `===` on a signature leaks, through timing, how many leading bytes were
 * right — which is enough to forge one byte at a time given enough attempts.
 * The relay is rate-limited, which makes that impractical rather than
 * impossible; this makes it neither.
 */
function sameSignature(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function mintTicket(userId: string, secret: string, expiresAt: number): Promise<string> {
  const payload = `${base64url(encoder.encode(userId))}.${Math.floor(expiresAt)}`;
  return `${payload}.${await sign(payload, secret)}`;
}

/**
 * Read a ticket, or null for anything wrong with it — bad shape, bad
 * signature, expired. One null rather than three reasons on purpose: a caller
 * holding a forged ticket learns nothing from the difference.
 */
export async function readTicket(
  token: string | null | undefined,
  secret: string,
  now: number,
): Promise<Ticket | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedUser, encodedExpiry, signature] = parts;

  const expected = await sign(`${encodedUser}.${encodedExpiry}`, secret);
  if (!sameSignature(signature, expected)) return null;

  const expiresAt = Number(encodedExpiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  const raw = fromBase64url(encodedUser);
  if (!raw) return null;
  const userId = new TextDecoder().decode(raw);
  return userId === '' ? null : { userId, expiresAt };
}
