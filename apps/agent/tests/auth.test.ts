import { describe, expect, it } from 'vitest';
import { bearerFrom, createSupabaseVerifier } from '../src/auth';

/**
 * This server mints join tokens and dispatches a paid agent. It used to take
 * `identity` from the request body, so anyone who could reach it could join
 * any room as anyone — and spend money doing it.
 */

describe('reading the header', () => {
  it('takes a well-formed bearer token', () => {
    expect(bearerFrom('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerFrom('bearer abc')).toBe('abc');
  });

  it('refuses the three empties that get shipped as bugs', () => {
    expect(bearerFrom(undefined)).toBeNull();
    expect(bearerFrom('')).toBeNull();
    expect(bearerFrom('Bearer ')).toBeNull();
  });

  it('refuses a scheme that is not Bearer', () => {
    expect(bearerFrom('Basic abc')).toBeNull();
    expect(bearerFrom('abc')).toBeNull();
  });
});

const ok = (id: string) =>
  (async () => ({ ok: true, json: async () => ({ id }) })) as unknown as typeof fetch;

describe('verifying with the identity service', () => {
  it('returns the user id the service says, never one from the caller', async () => {
    const verify = createSupabaseVerifier('https://p.supabase.co', 'anon', ok('user-real'));
    const out = await verify('Bearer token');
    expect(out).toEqual({ ok: true, user: { userId: 'user-real' } });
  });

  it('refuses with 401 when there is no header at all', async () => {
    const verify = createSupabaseVerifier('https://p.supabase.co', 'anon', ok('x'));
    const out = await verify(undefined);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(401);
  });

  it('refuses a token the service rejects', async () => {
    const bad = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    const out = await createSupabaseVerifier('https://p.supabase.co', 'anon', bad)('Bearer t');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(401);
  });

  it('refuses a reply carrying no user, rather than minting for nobody', async () => {
    const empty = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    const out = await createSupabaseVerifier('https://p.supabase.co', 'anon', empty)('Bearer t');
    expect(out.ok).toBe(false);
  });

  it('refuses — with 503 — when the identity service cannot be reached', async () => {
    const dead = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    const out = await createSupabaseVerifier('https://p.supabase.co', 'anon', dead)('Bearer t');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(503);
  });

  it('sends the token to the service, and the anon key beside it', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const spy = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return { ok: true, json: async () => ({ id: 'u' }) };
    }) as unknown as typeof fetch;

    await createSupabaseVerifier('https://p.supabase.co', 'anon-key', spy)('Bearer the-token');
    expect(seen[0].url).toBe('https://p.supabase.co/auth/v1/user');
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer the-token');
    expect(headers.apikey).toBe('anon-key');
  });
});
