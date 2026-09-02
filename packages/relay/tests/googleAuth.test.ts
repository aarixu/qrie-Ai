import { describe, expect, it, vi } from 'vitest';
import {
  REFRESH_MARGIN_MS,
  SCOPE,
  TOKEN_URI,
  createTokenSource,
  pemToBytes,
  readServiceAccount,
  signedAssertion,
} from '../src/googleAuth.ts';

/**
 * The credential that stands between a phone and somebody's Google Cloud
 * balance.
 *
 * A real RSA key is generated here rather than a fixture, because the whole
 * question is whether crypto.subtle actually verifies what this signs — a
 * hand-written JWT that Google rejects would look identical to one it accepts
 * until the day it is deployed. The signature is verified with the matching
 * public key, in the test, on every run.
 */

const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);

const pem = async (): Promise<string> => {
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  let binary = '';
  for (const b of der) binary += String.fromCharCode(b);
  const body = btoa(binary).match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
};

const account = async (over: Record<string, unknown> = {}) => ({
  type: 'service_account',
  project_id: 'curie-credits',
  client_email: 'curie@curie-credits.iam.gserviceaccount.com',
  private_key: await pem(),
  token_uri: TOKEN_URI,
  ...over,
});

const decode = (part: string) =>
  JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));

// ---------------------------------------------------------------- reading --

describe('reading the key file', () => {
  it('takes a real service account JSON', async () => {
    const a = readServiceAccount(JSON.stringify(await account()));
    expect(a.project_id).toBe('curie-credits');
  });

  it('names the missing field rather than failing inside a crypto call', async () => {
    // A secret set from a truncated paste is the likeliest way this goes
    // wrong, and "unsupported key format" sends somebody looking in the wrong
    // place entirely.
    for (const field of ['client_email', 'private_key', 'project_id']) {
      const broken = await account();
      delete (broken as Record<string, unknown>)[field];
      expect(() => readServiceAccount(JSON.stringify(broken))).toThrow(field);
    }
  });

  it('says so when the secret is not JSON at all', () => {
    expect(() => readServiceAccount('AIzaSyNotAKeyFile')).toThrow(/not JSON/);
  });

  it('rejects a key that is not a PEM private key', async () => {
    const p12 = await account({ private_key: 'MIIJ...binary p12 contents...' });
    expect(() => readServiceAccount(JSON.stringify(p12))).toThrow(/PKCS#8/);
  });
});

describe('the PEM the secret actually arrives as', () => {
  it('reads a normal multi-line block', async () => {
    expect(pemToBytes(await pem()).length).toBeGreaterThan(100);
  });

  it('reads one that lost its newlines to a shell', async () => {
    // A private_key pasted through a terminal comes back as one line with
    // literal backslash-n in it, which decodes to nothing useful.
    const flattened = (await pem()).replace(/\n/g, '\\n');
    expect(pemToBytes(flattened)).toEqual(pemToBytes(await pem()));
  });
});

// --------------------------------------------------------------- signing --

describe('the assertion Google is asked to trade', () => {
  it('is signed by the account key, and verifies', async () => {
    const jwt = await signedAssertion(readServiceAccount(JSON.stringify(await account())), 1_700_000_000_000);
    const [h, c, s] = jwt.split('.');

    const signature = Uint8Array.from(
      atob(s.replace(/-/g, '+').replace(/_/g, '/')),
      (ch) => ch.charCodeAt(0),
    );
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      keyPair.publicKey,
      signature,
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it('claims the account, the scope and Google as the audience', async () => {
    const jwt = await signedAssertion(readServiceAccount(JSON.stringify(await account())), 1_700_000_000_000);
    const claims = decode(jwt.split('.')[1]);
    expect(claims.iss).toBe('curie@curie-credits.iam.gserviceaccount.com');
    expect(claims.scope).toBe(SCOPE);
    expect(claims.aud).toBe(TOKEN_URI);
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('says RS256, which is the only algorithm Google takes here', async () => {
    const jwt = await signedAssertion(readServiceAccount(JSON.stringify(await account())), Date.now());
    expect(decode(jwt.split('.')[0])).toEqual({ alg: 'RS256', typ: 'JWT' });
  });
});

// ---------------------------------------------------------------- minting --

const tokenReply = (token: string, expiresIn = 3600) =>
  ({ ok: true, json: async () => ({ access_token: token, expires_in: expiresIn }) }) as unknown as Response;

describe('minting and reusing', () => {
  const source = async (fetchMock: unknown, now: () => number) =>
    createTokenSource(readServiceAccount(JSON.stringify(await account())), {
      fetch: fetchMock as typeof globalThis.fetch,
      now,
    });

  it('mints once and reuses it', async () => {
    const fetchMock = vi.fn(async () => tokenReply('tok-1'));
    let clock = 1_000_000;
    const s = await source(fetchMock, () => clock);

    expect(await s.token()).toBe('tok-1');
    clock += 60_000;
    expect(await s.token()).toBe('tok-1');
    // Minting is an RSA signature and a round trip; a class makes a dozen
    // model calls and none of them should pay for it twice.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mints again before the old one expires, not after', async () => {
    // A counter of its own: mock.calls has already grown by the time the
    // implementation runs, so reading it here numbers the first token 2.
    let minted = 0;
    const fetchMock = vi.fn(async () => tokenReply(`tok-${(minted += 1)}`));
    let clock = 1_000_000;
    const s = await source(fetchMock, () => clock);

    expect(await s.token()).toBe('tok-1');
    // Inside the margin: still valid to Google, but too close to risk on a
    // request that might take a few seconds.
    clock += 3600_000 - REFRESH_MARGIN_MS + 1;
    expect(await s.token()).toBe('tok-2');
  });

  it('shares one mint between callers that arrive together', async () => {
    // A class fires its planner and its artist at the same moment.
    const fetchMock = vi.fn(async () => {
      await new Promise((go) => setTimeout(go, 5));
      return tokenReply('tok-1');
    });
    const s = await source(fetchMock, () => 1_000_000);

    const [a, b, c] = await Promise.all([s.token(), s.token(), s.token()]);
    expect([a, b, c]).toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure forever', async () => {
    // A rejected promise left in the slot would answer every later call with
    // the same error for as long as the function lives.
    let fail = true;
    const fetchMock = vi.fn(async () => {
      if (fail) return { ok: false, status: 401, text: async () => 'bad key' } as unknown as Response;
      return tokenReply('tok-ok');
    });
    const s = await source(fetchMock, () => 1_000_000);

    await expect(s.token()).rejects.toThrow(/401/);
    fail = false;
    expect(await s.token()).toBe('tok-ok');
  });

  it('refuses a 200 that carried no token', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response);
    const s = await source(fetchMock, () => 1_000_000);
    await expect(s.token()).rejects.toThrow(/no access_token/);
  });

  it('carries the project id, which Vertex needs in the URL', async () => {
    const s = await source(vi.fn(async () => tokenReply('t')), () => 1);
    expect(s.projectId).toBe('curie-credits');
  });

  it('asks Google for a JWT bearer grant', async () => {
    const seen: RequestInit[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init);
      return tokenReply('t');
    });
    const s = await source(fetchMock, () => 1_000_000);
    await s.token();

    expect(String(seen[0].body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(String(seen[0].body)).toContain('assertion=');
  });
});
