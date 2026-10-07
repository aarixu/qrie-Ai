import { describe, expect, it } from 'vitest';
import { AdminError, adminApiUrl, fetchAdminApi, readReply } from '../src/index.ts';

/**
 * THE CONSOLE'S CALLS TO THE admin-api EDGE FUNCTION. Written first.
 *
 * Every reply is read by readReply, so a screen gets the same typed AdminError
 * from the staff service as from a database function; no token means no call.
 */

const failure = (fn: () => unknown): AdminError => {
  try {
    fn();
  } catch (e) {
    return e as AdminError;
  }
  throw new Error('expected a refusal');
};

describe('readReply', () => {
  it('readReply returns the body of a 2xx', () => {
    expect(readReply(200, { pin: '123456' })).toEqual({ pin: '123456' });
    expect(readReply(204, null)).toBeNull();
  });

  it('readReply turns {error, code} into a typed AdminError', () => {
    for (const code of ['needs-mfa', 'not-allowed', 'wrong-environment', 'other'] as const) {
      const e = failure(() => readReply(code === 'wrong-environment' ? 409 : 403, { error: `said ${code}`, code }));
      expect(e).toBeInstanceOf(AdminError);
      expect(e.code).toBe(code);
      expect(e.message).toBe(`said ${code}`);
    }
  });

  it('readReply says not-allowed for 401 or 403 without a code, and other for the rest', () => {
    expect(failure(() => readReply(401, { error: 'Please sign in again.' })).code).toBe('not-allowed');
    expect(failure(() => readReply(403, { error: 'No.', code: 'made-up' })).code).toBe('not-allowed');
    expect(failure(() => readReply(500, { error: 'Something went wrong.' })).code).toBe('other');
    expect(failure(() => readReply(404, { error: 'There is no such call.' })).code).toBe('other');
  });

  it('readReply has a plain message when the body is not what it should be', () => {
    for (const body of [null, 'text', 42, { error: '' }, { message: 'x' }]) {
      const e = failure(() => readReply(502, body));
      expect(e.code).toBe('other');
      expect(e.message).toBe('The admin service did not answer properly.');
    }
  });
});

describe('fetchAdminApi', () => {
  it('fetchAdminApi posts JSON to <base>/<route> with the bearer token, and asks nothing without one', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ userId: 'u1', blocked: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = fetchAdminApi('https://x.supabase.co/functions/v1/admin-api', async () => 'tok-1', fake);
    expect(await api.post('user-block', { userId: 'u1', blocked: true })).toEqual({ userId: 'u1', blocked: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://x.supabase.co/functions/v1/admin-api/user-block');
    expect(seen[0].init.method).toBe('POST');
    expect(seen[0].init.headers).toEqual({ authorization: 'Bearer tok-1', 'content-type': 'application/json' });
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ userId: 'u1', blocked: true });

    const noToken = await fetchAdminApi('https://x', async () => null, fake).post('import', {}).catch((e: unknown) => e);
    expect(noToken).toBeInstanceOf(AdminError);
    expect((noToken as AdminError).code).toBe('not-allowed');
    expect(seen).toHaveLength(1);

    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const unreachable = await fetchAdminApi('https://x', async () => 'tok', down).post('import', {}).catch((e: unknown) => e);
    expect((unreachable as AdminError).code).toBe('other');
    expect((unreachable as AdminError).message).toBe('Could not reach the admin service.');
  });

  it('adminApiUrl trims trailing slashes', () => {
    expect(adminApiUrl('https://x.supabase.co/')).toBe('https://x.supabase.co/functions/v1/admin-api');
    expect(adminApiUrl('https://x.supabase.co')).toBe('https://x.supabase.co/functions/v1/admin-api');
  });
});
