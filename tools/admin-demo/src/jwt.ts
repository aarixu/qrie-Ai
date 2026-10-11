import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HS256 JSON Web Tokens, with node:crypto alone: what Supabase Auth signs a
 * session with and PostgREST checks, in the local demo. The demo signs with a
 * secret made fresh on every start (server.ts), so a token from an earlier run
 * is refused.
 */

export type Claims = Record<string, unknown>;

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const mac = (input: string, secret: Buffer) => createHmac('sha256', secret).update(input).digest();

export function signJwt(claims: Claims, secret: Buffer): string {
  const body = `${HEADER}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${body}.${mac(body, secret).toString('base64url')}`;
}

export type Verified = { ok: true; claims: Claims } | { ok: false; why: 'invalid' | 'expired' };

/**
 * The claims of a token this secret signed with HS256 whose `exp` (epoch
 * seconds) is still ahead of `nowSeconds`. Any other token is 'invalid': a
 * different algorithm (alg none included), a changed header or payload, a
 * different secret, or no `exp` at all.
 */
export function verifyJwt(token: string, secret: Buffer, nowSeconds = Math.floor(Date.now() / 1000)): Verified {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => BASE64URL.test(p))) return { ok: false, why: 'invalid' };
  const [header, payload, signature] = parts;
  const expected = mac(`${header}.${payload}`, secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, why: 'invalid' };
  let claims: unknown;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: unknown };
    if (h.alg !== 'HS256') return { ok: false, why: 'invalid' };
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, why: 'invalid' };
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return { ok: false, why: 'invalid' };
  const exp = (claims as Claims).exp;
  if (typeof exp !== 'number') return { ok: false, why: 'invalid' };
  if (exp <= nowSeconds) return { ok: false, why: 'expired' };
  return { ok: true, claims: claims as Claims };
}
