import { describe, expect, it } from 'vitest';
import { createJwksVerifier, type Verifier } from '../src/auth';

/**
 * WHO IS ASKING, CHECKED HERE (Aarav, 2026-10-01: "login wala 0.1 sec bhi
 * kar do"). Supabase signs this project's access tokens with ES256 and
 * publishes the public keys, so the relay can check the signature itself
 * instead of a round trip to /auth/v1/user (53-192 ms, measured 2026-09-30).
 */

const SUPABASE = 'https://proj.supabase.co';
const ISSUER = `${SUPABASE}/auth/v1`;
const NOW = 1_800_000_000_000;

const b64url = (bytes: Uint8Array | string): string =>
  Buffer.from(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function signer() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1', alg: 'ES256', use: 'sig' };
  const sign = async (payload: Record<string, unknown>, header: Record<string, unknown> = {}) => {
    const head = b64url(JSON.stringify({ alg: 'ES256', kid: 'key-1', typ: 'JWT', ...header }));
    const body = b64url(JSON.stringify(payload));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
  };
  return { jwk, sign };
}

const good = (over: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  aud: 'authenticated',
  role: 'authenticated',
  sub: 'student-1',
  exp: NOW / 1000 + 3600,
  iat: NOW / 1000 - 10,
  ...over,
});

function setup(keys: unknown[], fallback?: Verifier) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const fallbackCalls: string[] = [];
  const verify = createJwksVerifier(SUPABASE, {
    fetchImpl,
    now: () => NOW,
    fallback:
      fallback ??
      (async (h) => {
        fallbackCalls.push(h ?? '');
        return { ok: true, user: { userId: 'from-network' } };
      }),
  });
  return { verify, calls, fallbackCalls };
}

describe('the local check of a Supabase access token', () => {
  it('accepts a token signed by a published key, with no network call per request', async () => {
    const { jwk, sign } = await signer();
    const { verify, calls, fallbackCalls } = setup([jwk]);
    const token = await sign(good());
    expect(await verify(`Bearer ${token}`)).toEqual({ ok: true, user: { userId: 'student-1' } });
    expect(await verify(`Bearer ${token}`)).toEqual({ ok: true, user: { userId: 'student-1' } });
    // The keys are fetched once and kept; the identity service is never asked.
    expect(calls).toEqual([`${ISSUER}/.well-known/jwks.json`]);
    expect(fallbackCalls).toEqual([]);
  });

  it('refuses a token whose signature does not match', async () => {
    const { jwk, sign } = await signer();
    const { verify, fallbackCalls } = setup([jwk]);
    const token = await sign(good());
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64url(JSON.stringify(good({ sub: 'someone-else' })))}.${s}`;
    expect(await verify(`Bearer ${forged}`)).toMatchObject({ ok: false, status: 401 });
    expect(fallbackCalls).toEqual([]);
  });

  it.each([
    ['expired', { exp: NOW / 1000 - 120 }],
    ['from another project', { iss: 'https://other.supabase.co/auth/v1' }],
    ['for another audience', { aud: 'something-else' }],
    ['the anon role (the anon key itself)', { role: 'anon' }],
    ['with no user', { sub: '' }],
  ])('refuses a token %s', async (_, over) => {
    const { jwk, sign } = await signer();
    const { verify } = setup([jwk]);
    expect(await verify(`Bearer ${await sign(good(over))}`)).toMatchObject({ ok: false, status: 401 });
  });

  it('accepts an audience list that includes authenticated', async () => {
    const { jwk, sign } = await signer();
    const { verify } = setup([jwk]);
    expect(await verify(`Bearer ${await sign(good({ aud: ['authenticated', 'x'] }))}`)).toMatchObject({ ok: true });
  });

  it('asks the identity service for a token it cannot check here: a legacy HS256 one, or an unknown key', async () => {
    const { jwk, sign } = await signer();
    const { verify, fallbackCalls } = setup([jwk]);
    const hs = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(good()))}.c2ln`;
    expect(await verify(`Bearer ${hs}`)).toEqual({ ok: true, user: { userId: 'from-network' } });
    expect(await verify(`Bearer ${await sign(good(), { kid: 'rotated-key' })}`)).toEqual({ ok: true, user: { userId: 'from-network' } });
    expect(fallbackCalls).toHaveLength(2);
  });

  it('asks the identity service when the keys cannot be fetched', async () => {
    const { sign } = await signer();
    const fallbackCalls: string[] = [];
    const verify = createJwksVerifier(SUPABASE, {
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      now: () => NOW,
      fallback: async (h) => {
        fallbackCalls.push(h ?? '');
        return { ok: true, user: { userId: 'from-network' } };
      },
    });
    expect(await verify(`Bearer ${await sign(good())}`)).toMatchObject({ ok: true });
    expect(fallbackCalls).toHaveLength(1);
  });

  it('refuses a missing or malformed header without any call', async () => {
    const { verify, calls, fallbackCalls } = setup([]);
    expect(await verify(undefined)).toMatchObject({ ok: false, status: 401 });
    expect(await verify('Bearer not-a-jwt')).toMatchObject({ ok: false, status: 401 });
    expect(calls).toEqual([]);
    expect(fallbackCalls).toEqual([]);
  });
});
