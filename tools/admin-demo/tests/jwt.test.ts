// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { signJwt, verifyJwt } from '../src/jwt.ts';

const SECRET = Buffer.from('a test secret, made up for this file only');
const NOW = 1_800_000_000;

const claims = { sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', iat: NOW, exp: NOW + 3600 };

describe('HS256 JWT', () => {
  it('signs a token that verifies and carries the claims back', () => {
    const token = signJwt(claims, SECRET);
    expect(token.split('.')).toHaveLength(3);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(verifyJwt(token, SECRET, NOW)).toEqual({ ok: true, claims });
  });

  it('refuses a token whose payload was changed after signing', () => {
    const [h, , s] = signJwt(claims, SECRET).split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, role: 'service_role' })).toString('base64url');
    expect(verifyJwt(`${h}.${forged}.${s}`, SECRET, NOW)).toEqual({ ok: false, why: 'invalid' });
  });

  it('refuses a token signed with another secret', () => {
    expect(verifyJwt(signJwt(claims, Buffer.from('another secret')), SECRET, NOW)).toEqual({ ok: false, why: 'invalid' });
  });

  it('refuses a token that is not HS256, including alg none', () => {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(verifyJwt(`${none}.${body}.`, SECRET, NOW)).toEqual({ ok: false, why: 'invalid' });
  });

  it('refuses an expired token, and one with no expiry', () => {
    expect(verifyJwt(signJwt(claims, SECRET), SECRET, NOW + 3600)).toEqual({ ok: false, why: 'expired' });
    const { exp: _exp, ...noExp } = claims;
    expect(verifyJwt(signJwt(noExp, SECRET), SECRET, NOW)).toEqual({ ok: false, why: 'invalid' });
  });

  it('refuses something that is not a JWT at all', () => {
    expect(verifyJwt('not-a-token', SECRET, NOW)).toEqual({ ok: false, why: 'invalid' });
    expect(verifyJwt('a.b.c', SECRET, NOW)).toEqual({ ok: false, why: 'invalid' });
  });
});
