// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabaseBackend, type SupabaseLike } from '../src/index.ts';

/**
 * THE HOSTED PROJECT'S ADMIN CALLS FROM THE BROWSER. Written first.
 *
 * On the hosted project the portal's "add people", "new PIN" and "give a
 * parent a sign-in" go to the lms-admin edge function (0046), with the
 * admin's own token; the function checks it. Without the function's address
 * the portal says so plainly instead of failing obscurely.
 */

/** The school admin's billing notice as lms.school_billing answers it (0064). */
const BILLING = { state: 'grace', graceUntil: '2026-10-22', openInvoices: 1, duePaise: 1180000, earliestDueOn: '2026-10-20' };

/** Each rpc reached, with the schema it was asked in. */
const rpcs: { schema: string; fn: string; args: unknown }[] = [];

const fakeSupabase = (token: string | null): SupabaseLike =>
  ({
    auth: {
      getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => undefined,
    },
    storage: { from: () => ({}) },
    schema: (name: string) => ({
      rpc: async (fn: string, args: unknown) => {
        rpcs.push({ schema: name, fn, args });
        if (fn === 'app_config') return { data: { 'banner.message': 'x' }, error: null };
        if (fn === 'school_billing') return { data: BILLING, error: null };
        return { data: null, error: null };
      },
    }),
  }) as unknown as SupabaseLike;

afterEach(() => vi.unstubAllGlobals());

describe('the admin calls on the hosted project', () => {
  it('go to the lms-admin function with the admin’s own token', async () => {
    const calls: { url: string; auth: string | null; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ loginId: 'HOS-P1', displayName: 'Sunita', pin: '12345678' }), { status: 200 });
    });
    const b = supabaseBackend(fakeSupabase('admin-jwt'), { adminUrl: 'https://p.supabase.co/functions/v1/lms-admin/' });
    expect(await b.addParent({ studentLoginId: 'HOS-101', displayName: 'Sunita' })).toEqual({
      loginId: 'HOS-P1',
      displayName: 'Sunita',
      pin: '12345678',
    });
    await b.resetPin('HOS-101');
    await b.importPeople({ students: 'grade,section,roll,name\n', commit: false });
    expect(calls.map((c) => [c.url, c.auth])).toEqual([
      ['https://p.supabase.co/functions/v1/lms-admin/add-parent', 'Bearer admin-jwt'],
      ['https://p.supabase.co/functions/v1/lms-admin/reset-pin', 'Bearer admin-jwt'],
      ['https://p.supabase.co/functions/v1/lms-admin/import', 'Bearer admin-jwt'],
    ]);
    expect(calls[1].body).toEqual({ loginId: 'HOS-101' });
  });

  it("show the function's own words when it refuses", async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Only the school admin can add people.' }), { status: 403 }));
    const b = supabaseBackend(fakeSupabase('teacher-jwt'), { adminUrl: 'https://p.supabase.co/functions/v1/lms-admin' });
    await expect(b.importPeople({ students: '' })).rejects.toThrow('Only the school admin can add people.');
  });

  it('say plainly when the function is not set up, or nobody is signed in', async () => {
    await expect(supabaseBackend(fakeSupabase('x')).resetPin('A-1')).rejects.toThrow(/not set up for this school yet/);
    const b = supabaseBackend(fakeSupabase(null), { adminUrl: 'https://p.supabase.co/functions/v1/lms-admin' });
    await expect(b.resetPin('A-1')).rejects.toThrow(/sign in again/);
  });
});

describe('what Qrie control says, on the hosted project', () => {
  it("the hosted backend reads app_config in the public schema with the school's code, or none", async () => {
    const b = supabaseBackend(fakeSupabase(null));
    rpcs.length = 0;
    expect(await b.appConfig('HOS')).toEqual({ 'banner.message': 'x' });
    expect(rpcs).toEqual([{ schema: 'public', fn: 'app_config', args: { p_school: 'HOS' } }]);
    await b.appConfig(null);
    expect(rpcs[1]).toEqual({ schema: 'public', fn: 'app_config', args: { p_school: null } });
    await expect(b.appConfig('bad code')).rejects.toThrow(/not a school code/);
    expect(rpcs).toHaveLength(2);
  });

  it('schoolBilling() is lms.school_billing as one value', async () => {
    const b = supabaseBackend(fakeSupabase('admin-jwt'));
    rpcs.length = 0;
    expect(await b.api.schoolBilling()).toEqual(BILLING);
    expect(rpcs).toEqual([{ schema: 'lms', fn: 'school_billing', args: {} }]);
  });
});
