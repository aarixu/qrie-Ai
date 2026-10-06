import { describe, expect, it } from 'vitest';
import { isServiceRoleKey } from '../src/lib/public-key.ts';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.${'s'.repeat(43)}`;

describe('the key the console was built with', () => {
  it('accepts the anon key and a publishable key', () => {
    expect(isServiceRoleKey(jwt('anon'))).toBe(false);
    expect(isServiceRoleKey('sb_publishable_abc123')).toBe(false);
  });

  it('recognises a service-role JWT and a new-style secret key', () => {
    expect(isServiceRoleKey(jwt('service_role'))).toBe(true);
    expect(isServiceRoleKey('sb_secret_abc123')).toBe(true);
  });

  it('is not fooled by something that is not a key', () => {
    expect(isServiceRoleKey(undefined)).toBe(false);
    expect(isServiceRoleKey('')).toBe(false);
    expect(isServiceRoleKey('a.b.c')).toBe(false);
  });
});
