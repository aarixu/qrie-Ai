// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSED, LOCKED, NEEDS_NEW_PIN, NETWORK_LIMIT, WRONG_PIN, supabaseBackend, type SupabaseLike } from '../src/index.ts';

/**
 * SIGNING IN ON THE HOSTED PROJECT. Written first.
 *
 * Supabase Auth has no per-ID lockout, and on the hosted project its password
 * is not the PIN. The browser asks the sign-in guard (the lms-signin edge
 * function) first; only for the right PIN does the guard answer with the
 * account's password, which the browser then gives Supabase Auth. Without the
 * guard's address there is no sign-in at all — never the PIN as a password.
 */

const URL_ = 'https://p.supabase.co/functions/v1/lms-signin';

function fakeSupabase(refusal: string | null = null) {
  const tries: { email: string; password: string }[] = [];
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInWithPassword: async (c: { email: string; password: string }) => {
        tries.push(c);
        return { error: refusal ? { message: refusal } : null };
      },
      signOut: async () => undefined,
    },
    storage: { from: () => ({}) },
    schema: () => ({ rpc: async () => ({ data: null, error: null }) }),
  } as unknown as SupabaseLike;
  return { supabase, tries };
}

const answer = (status: number, body: unknown) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('signing in on the hosted project', () => {
  it('asks the guard with the ID and PIN, then gives Supabase Auth the password the guard sent back', async () => {
    const posts: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      posts.push({ url, init });
      return new Response(JSON.stringify({ password: 'made-from-the-pin' }), { status: 200 });
    });
    const { supabase, tries } = fakeSupabase();
    await supabaseBackend(supabase, { signInUrl: `${URL_}/` }).signIn(' hos-101 ', '493817');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(URL_);
    expect(posts[0].init.method).toBe('POST');
    expect(JSON.parse(String(posts[0].init.body))).toEqual({ loginId: 'hos-101', pin: '493817' });
    expect(new Headers(posts[0].init.headers).get('authorization')).toBeNull();
    expect(tries).toEqual([{ email: 'hos-101@login.qrie.invalid', password: 'made-from-the-pin' }]);
  });

  it("shows the guard's own words when it refuses, and does not try Supabase Auth", async () => {
    for (const [status, words] of [
      [401, WRONG_PIN],
      [401, LOCKED],
      [401, CLOSED],
      [429, NETWORK_LIMIT],
    ] as const) {
      vi.stubGlobal('fetch', answer(status, { error: words }));
      const { supabase, tries } = fakeSupabase();
      await expect(supabaseBackend(supabase, { signInUrl: URL_ }).signIn('HOS-101', '000000')).rejects.toThrow(words);
      expect(tries).toEqual([]);
    }
  });

  it('says the sign-in needs a new PIN when Supabase Auth refuses the password the guard sent', async () => {
    vi.stubGlobal('fetch', answer(200, { password: 'stale' }));
    const refused = fakeSupabase('Invalid login credentials');
    await expect(supabaseBackend(refused.supabase, { signInUrl: URL_ }).signIn('HOS-101', '493817')).rejects.toThrow(NEEDS_NEW_PIN);
    expect(NEEDS_NEW_PIN).toBe('Your sign-in needs a new PIN. Ask your school office.');
    // Any other refusal is shown in Supabase Auth's own words.
    const other = fakeSupabase('Request rate limit reached');
    await expect(supabaseBackend(other.supabase, { signInUrl: URL_ }).signIn('HOS-101', '493817')).rejects.toThrow('Request rate limit reached');
  });

  it('says what the server answered when it sends no words of its own', async () => {
    vi.stubGlobal('fetch', answer(502, '<html>Bad gateway</html>'));
    const { supabase, tries } = fakeSupabase();
    await expect(supabaseBackend(supabase, { signInUrl: URL_ }).signIn('HOS-101', '493817')).rejects.toThrow(/said 502/);
    expect(tries).toEqual([]);
  });

  it("refuses to sign in without the guard's address, and never sends the PIN to Supabase Auth", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { supabase, tries } = fakeSupabase();
    await expect(supabaseBackend(supabase).signIn('HOS-101', '493817')).rejects.toThrow('Signing in is not set up for this school yet.');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tries).toEqual([]);
  });
});
