/**
 * A SERVICE ACCOUNT, TURNED INTO A TOKEN VERTEX WILL ACCEPT.
 *
 * Vertex will take a plain API key in express mode, and that is what the
 * measurement runs used. A SERVICE ACCOUNT is a different credential and needs
 * a different dance: sign a JWT with the account's private key, trade it at
 * Google's token endpoint for an OAuth2 access token, and use that. The token
 * lasts an hour, so something has to notice when it is about to expire.
 *
 * WHY BOTHER, when a key is simpler. Because the credits are attached to a
 * project, and a service account is the credential a project actually hands
 * out — an API key that can be pasted into a curl command is not something to
 * put in front of a balance somebody paid for.
 *
 * WEB CRYPTO ONLY. This runs inside a Supabase Edge Function, which is Deno:
 * there is no `node:crypto`, no `jsonwebtoken`, no `google-auth-library`. Web
 * Crypto is the one signing API both Deno and Node have, so it is the one used
 * here — and it means the same file is testable in the repo's own Node test
 * run rather than only in production.
 *
 * WHAT THIS IS NOT. It never touches the browser. The service account JSON is
 * a Supabase secret, the token is minted server-side, and the phone only ever
 * sees the relay's own answer. A credential that reaches a WebView is a
 * credential on every student's device.
 */

/** The fields this needs out of a service account JSON. The file has more. */
export interface ServiceAccount {
  client_email: string;
  private_key: string;
  /** Which project the credits sit in. Vertex puts it in the URL path. */
  project_id: string;
  /** Google's token endpoint. Present in every key file; defaulted anyway. */
  token_uri?: string;
}

export const TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** Everything Vertex needs; nothing an Editor role would give away. */
export const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * How long before expiry to mint a fresh one.
 *
 * A token that expires in flight fails the request that is carrying it, and
 * the student waiting on it does not care whose clock was right. Ninety
 * seconds covers a slow class-prep call and any clock skew between here and
 * Google.
 */
export const REFRESH_MARGIN_MS = 90_000;

/** A token is good for an hour; Google says so in the reply, and this is the floor. */
const DEFAULT_TTL_S = 3600;

// --------------------------------------------------------------- parsing --

/**
 * Read the JSON a Supabase secret holds.
 *
 * Throws with the FIELD NAME when something is missing rather than failing
 * later inside a crypto call: a secret set from a truncated paste is the most
 * likely way this ever goes wrong, and "unsupported key format" would send
 * somebody looking in the wrong place entirely.
 */
export function readServiceAccount(json: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('service account: not JSON. Set the whole key file as the secret.');
  }
  const a = parsed as Partial<ServiceAccount> & { type?: string };
  for (const field of ['client_email', 'private_key', 'project_id'] as const) {
    if (typeof a[field] !== 'string' || !a[field]) {
      throw new Error(`service account: no ${field}`);
    }
  }
  if (!a.private_key!.includes('BEGIN PRIVATE KEY')) {
    // The P12/JSON distinction, caught here rather than in importKey. A key
    // file downloaded as P12 is a different format and no amount of base64
    // handling will make it work.
    throw new Error('service account: private_key is not a PEM PKCS#8 block');
  }
  return a as ServiceAccount;
}

const b64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const utf8 = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

/**
 * PEM to the bytes importKey wants.
 *
 * The newlines matter and they are the thing most often lost: a private_key
 * pasted into a shell becomes one line with literal backslash-n in it, which
 * base64-decodes to nothing useful. Both spellings are accepted here, because
 * the alternative is a confusing failure at the far end of a deploy.
 */
export function pemToBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

// --------------------------------------------------------------- signing --

export async function signedAssertion(
  account: ServiceAccount,
  now: number,
  scope: string = SCOPE,
): Promise<string> {
  const iat = Math.floor(now / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope,
    aud: account.token_uri ?? TOKEN_URI,
    // An hour is the maximum Google accepts, and the assertion is used once.
    exp: iat + DEFAULT_TTL_S,
    iat,
  };
  const unsigned = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(claims)))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(signature))}`;
}

// ---------------------------------------------------------------- minting --

export interface TokenSource {
  /** A valid access token, minted or reused. */
  token(): Promise<string>;
  /** Which project the credits are in — Vertex needs it in the URL. */
  readonly projectId: string;
}

export interface TokenOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/**
 * A token source that mints once and reuses until the token is nearly out.
 *
 * The cache is the point. Minting is an RSA signature and a round trip to
 * Google, and a class makes a dozen model calls: doing it per call would add
 * that to every one of them, for a token that was already valid.
 *
 * Concurrent callers share ONE mint. A class fires its planner and its artist
 * at the same moment, and two cold calls would otherwise sign two assertions
 * and race to store the second one.
 */
export function createTokenSource(
  account: ServiceAccount,
  options: TokenOptions = {},
): TokenSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  const clock = options.now ?? Date.now;

  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  const mint = async (): Promise<string> => {
    const assertion = await signedAssertion(account, clock());
    const response = await doFetch(account.token_uri ?? TOKEN_URI, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!response.ok) {
      throw new Error(`google token ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('google token: reply carried no access_token');

    cached = {
      token: body.access_token,
      expiresAt: clock() + (body.expires_in ?? DEFAULT_TTL_S) * 1000,
    };
    return cached.token;
  };

  return {
    projectId: account.project_id,
    async token() {
      if (cached && clock() < cached.expiresAt - REFRESH_MARGIN_MS) return cached.token;
      // A failed mint must not leave the promise cached, or every later call
      // returns the same rejection for as long as the process lives.
      inFlight ??= mint().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
