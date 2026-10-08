// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { adminRpc, RpcError } from '../src/rest.ts';

/**
 * THE DATABASE, FROM AN EDGE FUNCTION. Written first.
 *
 * A call to an admin.* function through PostgREST: with the caller's own
 * Authorization (so the database decides who they are) or with the service
 * role's. The anon key goes as the apikey the gateway asks for.
 */

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}
function recorder(status: number, text: string) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ANON = 'anon-key-value';
const USER_JWT = 'Bearer user.jwt.value';

describe('adminRpc', () => {
  it('a user call sends the caller\'s Authorization, the anon apikey and Content-Profile: admin to /rest/v1/rpc/<fn>', async () => {
    const { calls, fetchImpl } = recorder(200, '{"linkId":"QRIE-26-27-0001"}');
    const rpc = adminRpc('https://p.supabase.co/', ANON, fetchImpl);
    expect(await rpc(USER_JWT, 'billing_link_prepare', { p_invoice: 'i', p_reason: 'r', p_env: 'TEST' })).toEqual({
      linkId: 'QRIE-26-27-0001',
    });
    expect(calls[0].url).toBe('https://p.supabase.co/rest/v1/rpc/billing_link_prepare');
    expect(calls[0].headers).toMatchObject({
      apikey: ANON,
      authorization: USER_JWT,
      'content-profile': 'admin',
      'content-type': 'application/json',
    });
    expect(calls[0].body).toEqual({ p_invoice: 'i', p_reason: 'r', p_env: 'TEST' });
    const empty = recorder(204, '');
    expect(await adminRpc('https://p.supabase.co', ANON, empty.fetchImpl)(USER_JWT, 'billing_link_failed', {})).toBeNull();
    await expect(rpc(USER_JWT, 'billing; drop', {})).rejects.toThrow(/not an admin function name/);
  });

  it('a refusal becomes RpcError with the database\'s message and the HTTP status, and no message carries a key', async () => {
    const refused = recorder(403, '{"message":"not allowed","code":"42501","details":null,"hint":null}');
    let e: unknown;
    try {
      await adminRpc('https://p.supabase.co', ANON, refused.fetchImpl)(USER_JWT, 'billing_link_prepare', {});
    } catch (err) {
      e = err;
    }
    expect(e).toBeInstanceOf(RpcError);
    expect((e as RpcError).message).toBe('not allowed');
    expect((e as RpcError).status).toBe(403);

    const html = recorder(500, '<html>upstream connect error</html>');
    try {
      await adminRpc('https://p.supabase.co', ANON, html.fetchImpl)('Bearer service-role-secret', 'billing_reconcile_due', {});
    } catch (err) {
      e = err;
    }
    expect((e as RpcError).message).toBe('the database did not answer (500)');
    expect((e as RpcError).status).toBe(500);
    for (const key of [ANON, 'service-role-secret', 'user.jwt.value']) expect(`${(e as Error).message}`).not.toContain(key);
  });
});
