/**
 * WHO IS ASKING.
 *
 * Every relay spends money on somebody's behalf — a model call, a voice, a
 * transcription. Until a caller has a name, none of that can be attributed,
 * limited or cut off, and one leaked URL spends until the balance is gone.
 *
 * Two ways. `createSupabaseVerifier` asks Supabase, which costs a round trip
 * and also refuses a session that has signed out; it is what the deployed
 * relay uses. `createJwksVerifier` checks the signature here against the
 * project's PUBLIC keys; it was measured in production on 2026-10-01 and
 * saved about 15 ms (see its docblock), so it is built and tested but not
 * wired in.
 *
 * This file was written for the LiveKit token server and lives here now
 * because the relays need exactly the same thing. It is fetch-only — no
 * dependencies, no Node built-ins — so the same code runs in the vite dev
 * server, in the Node token server, and inside a Deno Edge Function.
 */

export interface Verified {
  userId: string;
}

export type VerifyResult = { ok: true; user: Verified } | { ok: false; status: number; why: string };

/**
 * The token out of an Authorization header.
 *
 * Pure, and separated because it is the part with edges: a missing header, a
 * scheme that is not Bearer, and the empty string that `"Bearer "` produces
 * are three different failures and all three have been shipped as bugs
 * somewhere.
 */
export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export interface Verifier {
  (authHeader: string | undefined): Promise<VerifyResult>;
}

/**
 * Build a verifier against one Supabase project.
 *
 * `fetchImpl` is injected so the tests need no network and no project.
 */
export function createSupabaseVerifier(
  supabaseUrl: string,
  anonKey: string,
  fetchImpl: typeof fetch = fetch,
): Verifier {
  return async (authHeader) => {
    const token = bearerFrom(authHeader);
    if (token === null) {
      return { ok: false, status: 401, why: 'expected an Authorization: Bearer <token> header' };
    }

    let res: Response;
    try {
      res = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, authorization: `Bearer ${token}` },
      });
    } catch {
      // The identity provider being unreachable is OUR outage, not the
      // student's fault — but it is still a refusal, because serving an
      // unverified caller is the thing this exists to prevent.
      return { ok: false, status: 503, why: 'could not reach the identity service' };
    }

    if (!res.ok) return { ok: false, status: 401, why: 'that sign-in is not valid' };

    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    if (!body || typeof body.id !== 'string' || body.id === '') {
      return { ok: false, status: 401, why: 'that sign-in carries no user' };
    }

    return { ok: true, user: { userId: body.id } };
  };
}

/**
 * WHO IS ASKING, CHECKED HERE (Aarav, 2026-10-01: "login wala 0.1 sec bhi
 * kar do").
 *
 * This project's access tokens are signed with ES256 by Supabase's
 * asymmetric signing keys, and the public half is published at
 * `<project>/auth/v1/.well-known/jwks.json`. So the relay checks the
 * signature and the claims itself, with Web Crypto, instead of asking
 * /auth/v1/user on every call: MEASURED 2026-09-30 that round trip was
 * 53-192 ms of every hear and llm call. No secret lives in this process —
 * only public keys.
 *
 * THE PRICE, SAID OUT LOUD: the network check also refused a session that had
 * signed out. A token checked here stays good until its own expiry (one hour
 * by default) even after sign-out.
 *
 * AND WHAT IT BOUGHT, MEASURED (2026-10-01, deployed, 36 calls each way, the
 * same hour): the check fell to 1-4 ms, but nearly every call lands on a
 * fresh isolate, and the meter's claim — the next call to the same Supabase
 * host — then paid the connection the identity call used to pay. Identity
 * plus meter: median about 91 ms against about 125 ms, mean about 140-150 ms
 * against about 160 ms. 10-35 ms in all. Not worth the hour, so the deployed
 * relay does not use this (supabase/functions/relay/index.ts). It becomes
 * worth it where nothing else needs that connection.
 *
 * Anything this cannot check — a legacy HS256 token, a key id the published
 * set does not have (a rotation newer than the cached keys), or keys that
 * cannot be fetched — goes to `fallback`, the network check. A token it CAN
 * check and finds wrong (bad signature, expired, another project, another
 * audience, not a signed-in user) is refused here and never sent on.
 */
export function createJwksVerifier(
  supabaseUrl: string,
  opts: {
    fallback: Verifier;
    fetchImpl?: typeof fetch;
    now?: () => number;
    /** How long a fetched key set is kept. */
    keysTtlMs?: number;
    /**
     * The published keys, given up front (the relay's RELAY_JWKS setting).
     * MEASURED 2026-10-01: nearly every call to the deployed relay lands on a
     * fresh isolate (11 of 12 in a row), so a key set fetched and cached per
     * isolate cost a 33-87 ms fetch on almost every call. Keys given here are
     * used without fetching; a key id they do not have (a rotation) is
     * fetched, and failing that sent to `fallback`.
     */
    keys?: readonly JsonWebKey[];
  },
): Verifier {
  const issuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const ttl = opts.keysTtlMs ?? 10 * 60_000;
  const given: { byKid: Map<string, Promise<CryptoKey | null>>; jwks: JsonWebKey[] } | null = opts.keys?.length
    ? { byKid: new Map(), jwks: [...opts.keys] }
    : null;
  let keys: { at: number; byKid: Map<string, Promise<CryptoKey | null>>; jwks: JsonWebKey[] } | null = null;
  let fetching: Promise<boolean> | null = null;

  const loadKeys = async (): Promise<boolean> => {
    try {
      const res = await doFetch(`${issuer}/.well-known/jwks.json`);
      if (!res.ok) return false;
      const body = (await res.json().catch(() => null)) as { keys?: unknown } | null;
      if (!body || !Array.isArray(body.keys)) return false;
      keys = { at: now(), byKid: new Map(), jwks: body.keys as JsonWebKey[] };
      return true;
    } catch {
      return false;
    }
  };
  const ensureKeys = async (): Promise<boolean> => {
    if (keys && now() - keys.at < ttl) return true;
    fetching ??= loadKeys().finally(() => (fetching = null));
    return fetching;
  };
  const keyFor = (
    set: { byKid: Map<string, Promise<CryptoKey | null>>; jwks: JsonWebKey[] } | null,
    kid: string,
  ): Promise<CryptoKey | null> | null => {
    if (!set) return null;
    const cached = set.byKid.get(kid);
    if (cached) return cached;
    const jwk = set.jwks.find((k) => (k as { kid?: unknown }).kid === kid);
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') return null;
    const imported = crypto.subtle
      .importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      .catch(() => null);
    set.byKid.set(kid, imported);
    return imported;
  };

  const refuse = (why: string): VerifyResult => ({ ok: false, status: 401, why });

  return async (authHeader) => {
    const token = bearerFrom(authHeader);
    if (token === null) return refuse('expected an Authorization: Bearer <token> header');
    const parts = token.split('.');
    if (parts.length !== 3) return refuse('that sign-in is not valid');
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    const signature = decodeBase64Url(parts[2]);
    if (!header || !claims || !signature) return refuse('that sign-in is not valid');

    if (header.alg !== 'ES256' || typeof header.kid !== 'string') return opts.fallback(authHeader);
    let key = await keyFor(given, header.kid);
    if (!key) {
      if (!(await ensureKeys())) return opts.fallback(authHeader);
      key = await keyFor(keys, header.kid);
    }
    if (!key) return opts.fallback(authHeader);

    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle
      .verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signed)
      .catch(() => false);
    if (!valid) return refuse('that sign-in is not valid');

    const seconds = now() / 1000;
    // Thirty seconds of leeway either side: clocks on an Edge isolate and on
    // the auth server are not the same clock.
    if (typeof claims.exp !== 'number' || claims.exp + 30 < seconds) return refuse('that sign-in has expired');
    if (typeof claims.nbf === 'number' && claims.nbf - 30 > seconds) return refuse('that sign-in is not valid yet');
    if (claims.iss !== issuer) return refuse('that sign-in is for another project');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes('authenticated')) return refuse('that sign-in is not for this app');
    if (claims.role !== 'authenticated') return refuse('that sign-in is not a signed-in user');
    if (typeof claims.sub !== 'string' || claims.sub === '') return refuse('that sign-in carries no user');
    return { ok: true, user: { userId: claims.sub } };
  };
}

function decodeBase64Url(part: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function decodeJson(part: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(part);
  if (!bytes) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Remember an answer for a short while.
 *
 * The LiveKit token server could afford a round trip per call because it
 * mints once per class. `/api/speech` is called once per SPOKEN LINE, and the
 * streaming relay exists to put the first byte on the wire in 0.36 s — a
 * round trip to the identity service before every line would be most of a
 * second of silence between sentences.
 *
 * Thirty seconds is the trade: a revoked session keeps working for at most
 * that long on a relay it was already using, which is a far smaller risk than
 * the alternative of never checking at all. Failures are NOT cached, so an
 * outage does not pin a refusal in place.
 */
export function cacheVerifier(inner: Verifier, ttlMs = 30_000, now: () => number = Date.now): Verifier {
  const seen = new Map<string, { at: number; user: Verified }>();

  return async (authHeader) => {
    const token = bearerFrom(authHeader);
    if (token === null) {
      return { ok: false, status: 401, why: 'expected an Authorization: Bearer <token> header' };
    }

    const hit = seen.get(token);
    if (hit && now() - hit.at < ttlMs) return { ok: true, user: hit.user };

    const result = await inner(authHeader);
    if (result.ok) {
      // Bounded: an Edge Function instance is long-lived and this map would
      // otherwise grow with every token it ever saw.
      if (seen.size > 1000) seen.clear();
      seen.set(token, { at: now(), user: result.user });
    } else {
      seen.delete(token);
    }
    return result;
  };
}
