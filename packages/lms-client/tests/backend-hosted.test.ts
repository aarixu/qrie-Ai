// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANNOT_REACH, friendlyError, supabaseBackend, type SupabaseLike } from '../src/index.ts';

/**
 * THE HOSTED PROJECT'S ADMIN CALLS FROM THE BROWSER. Written first.
 *
 * On the hosted project the portal's "add people", "new PIN" and "give a
 * parent a sign-in" go to the lms-admin edge function (0046), with the
 * admin's own token; the function checks it. Without the function's address
 * the portal says so plainly instead of failing obscurely.
 */

const fakeSupabase = (token: string | null): SupabaseLike =>
  ({
    auth: {
      getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => undefined,
    },
    storage: { from: () => ({}) },
    schema: () => ({ rpc: async () => ({ data: null, error: null }) }),
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

/**
 * SIGNING OUT ON A SHARED PHONE. auth-js (2.112) leaves the session stored
 * when it cannot load it first (a token past its time, refreshed with no
 * signal), and answers with an error instead of throwing. The next person to
 * open the app online would then be signed in as the last one. So signing out
 * forgets the session on this device whatever supabase-js answers.
 */
describe('signing out on the hosted project', () => {
  it('forgets the session on this device whatever supabase-js answers', async () => {
    const answers: (() => Promise<unknown>)[] = [
      async () => ({ error: null }),
      async () => ({ error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 }) }),
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ];
    for (const [i, answer] of answers.entries()) {
      const supabase = fakeSupabase('student-jwt');
      supabase.auth.signOut = answer;
      const forgetSession = vi.fn();
      await supabaseBackend(supabase, { forgetSession })
        .signOut()
        .catch(() => undefined);
      expect(forgetSession, `answer ${i}`).toHaveBeenCalledOnce();
    }
  });
});

/**
 * A phone that loses its signal, on the calls that go through supabase-js
 * rather than plain fetch. None of its parts throws the fetch's TypeError:
 * storage-js (2.112) answers with a StorageUnknownError holding it as
 * originalError, auth-js with an AuthRetryableFetchError of status 0, and
 * postgrest-js with status 0 and "TypeError: …" as the message. Each must
 * still fail with a TypeError, which is what reads as "Could not reach your
 * school". The guard, lms-admin and the relay are reached with plain fetch,
 * whose TypeError already passes through as it is.
 *
 * Once the token is past its time, auth-js cannot refresh it with no signal:
 * it answers "no session" with an AuthRetryableFetchError of status 0 (the
 * same for a 5xx) and keeps the session stored, and supabase-js would send
 * each call with the anon key instead. That session still counts as held,
 * and those calls fail as offline without being sent.
 */
describe('the hosted calls through supabase-js, with no signal', () => {
  const unreachedStorage = () => {
    const fetchError = new TypeError('Failed to fetch');
    return Object.assign(new Error(fetchError.message), { name: 'StorageUnknownError', originalError: fetchError });
  };
  const offline = (): SupabaseLike =>
    ({
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'student-jwt' } } }),
        signInWithPassword: async () => ({
          error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 }),
        }),
        signOut: async () => ({ error: null }),
      },
      storage: {
        from: () => ({
          upload: async () => ({ data: null, error: unreachedStorage() }),
          createSignedUrl: async () => ({ data: null, error: unreachedStorage() }),
        }),
      },
      schema: () => ({
        rpc: async () => ({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }),
      }),
    }) as unknown as SupabaseLike;
  const failure = (call: Promise<unknown>) => call.then(() => null, (e: unknown) => e);

  it('fail with a TypeError, read as "Could not reach your school"', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ password: 'made-from-the-pin' }), { status: 200 }));
    const b = supabaseBackend(offline(), { signInUrl: 'https://p.supabase.co/functions/v1/lms-signin' });
    const photo = new Blob(['x'], { type: 'image/jpeg' });
    for (const [name, call] of [
      ['uploadWork', () => b.uploadWork('org/a/s/photo.jpg', photo)],
      ['workUrl', () => b.workUrl('org/a/s/photo.jpg')],
      ['schoolBrand', () => b.schoolBrand('DEMO')],
      ['signIn', () => b.signIn('DEMO-8A-1', '493817')],
    ] as const) {
      const error = await failure(call());
      expect(error, name).toBeInstanceOf(TypeError);
      expect(friendlyError(error), name).toBe(CANNOT_REACH);
    }
  });

  it('keep a session supabase-js could not refresh, and never call with the anon key in its place', async () => {
    // Were these sent, the school would refuse each as from nobody.
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      sent.push(url);
      return new Response('{}', { status: 200 });
    });
    // No answer to the refresh, or a 5xx: auth-js keeps the session for both.
    for (const kept of [
      Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 }),
      Object.assign(new Error('HTTP 503'), { name: 'AuthRetryableFetchError', status: 503 }),
    ]) {
      const supabase = {
        auth: {
          getSession: async () => ({ data: { session: null }, error: kept }),
          signInWithPassword: async () => ({ error: null }),
          signOut: async () => ({ error: null }),
        },
        storage: {
          from: () => ({
            upload: async () => (sent.push('upload'), { data: null, error: { message: 'new row violates row-level security policy' } }),
            createSignedUrl: async () => (sent.push('createSignedUrl'), { data: null, error: { message: 'Object not found' } }),
          }),
        },
        schema: () => ({
          rpc: async (fn: string) => (sent.push(fn), { data: null, error: { message: `permission denied for function ${fn}` }, status: 401 }),
        }),
      } as unknown as SupabaseLike;
      const b = supabaseBackend(supabase, {
        adminUrl: 'https://p.supabase.co/functions/v1/lms-admin',
        relayUrl: 'https://p.supabase.co/functions/v1/relay',
      });

      expect(await b.hasSession(), kept.message).toBe(true);
      for (const [name, call] of [
        ['api.me', () => b.api.me()],
        ['api.myClasses', () => b.api.myClasses()],
        ['uploadWork', () => b.uploadWork('org/a/s/photo.jpg', new Blob(['x']))],
        ['workUrl', () => b.workUrl('org/a/s/photo.jpg')],
        ['resetPin', () => b.resetPin('HOS-101')],
        ['askAi', () => b.askAi({ model: 'm', messages: [{ role: 'user', content: 'Draft two questions.' }], response_format: { type: 'json_object' }, temperature: 0, max_tokens: 100 })],
      ] as const) {
        const error = await failure(call());
        expect(error, `${name} after ${kept.message}`).toBeInstanceOf(TypeError);
        expect(friendlyError(error), name).toBe(CANNOT_REACH);
      }
    }
    expect(sent).toEqual([]);
  });

  it('still call as nobody, and say "sign in again", when no session is held', async () => {
    const rpc = vi.fn(async (fn: string) => ({ data: null, error: { message: `permission denied for function ${fn}` }, status: 401 }));
    for (const answer of [
      { data: { session: null }, error: null },
      // The refresh token refused: auth-js has removed the session.
      { data: { session: null }, error: Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400 }) },
    ]) {
      const supabase = { ...offline(), schema: () => ({ rpc }) } as unknown as SupabaseLike;
      supabase.auth.getSession = async () => answer as never;
      const b = supabaseBackend(supabase, { adminUrl: 'https://p.supabase.co/functions/v1/lms-admin' });
      expect(await b.hasSession()).toBe(false);
      await expect(b.api.me()).rejects.toThrow('permission denied for function me');
      await expect(b.resetPin('HOS-101')).rejects.toThrow('Please sign in again.');
    }
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("keep the storage's own refusal a plain Error", async () => {
    const supabase = offline();
    supabase.storage.from = () =>
      ({
        upload: async () => ({ data: null, error: Object.assign(new Error('The resource already exists'), { name: 'StorageApiError', status: 409 }) }),
      }) as never;
    const error = await failure(supabaseBackend(supabase).uploadWork('org/a/s/photo.jpg', new Blob(['x'])));
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('The resource already exists');
  });
});
