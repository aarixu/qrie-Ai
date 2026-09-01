/**
 * WHO IS ASKING.
 *
 * This server mints LiveKit join tokens and dispatches a paid agent. Until
 * now it took `identity` straight out of the request body, which means anyone
 * who could reach it could join any room as anyone, and could spend money
 * doing it. The body is a claim; this turns it into a fact.
 *
 * Verified by ASKING SUPABASE rather than by checking a signature here. That
 * costs one round trip per class — tokens are minted once, not per beat — and
 * buys two things worth more than the milliseconds: the project's JWT secret
 * never has to live in this process, and a token revoked at sign-out stops
 * working immediately instead of at its own expiry.
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
      // student's fault — but it is still a refusal, because minting a token
      // for an unverified caller is the thing this exists to prevent.
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
