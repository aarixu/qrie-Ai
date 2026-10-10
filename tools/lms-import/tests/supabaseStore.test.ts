import { describe, expect, it } from 'vitest';
import { supabaseStore } from '../src/supabaseStore.ts';

const URL_ = 'https://x.supabase.co';
const KEY = 'service-role-secret-key';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeFetch(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      ...(init?.body ? { body: String(init.body) } : {}),
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, impl };
}

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

describe('supabaseStore.createAccount', () => {
  const account = {
    orgId: 'org-1',
    loginId: 'DPS-SR001',
    kind: 'student' as const,
    displayName: 'Riya',
    email: 'dps-sr001@login.qrie.invalid',
    password: '493817',
    appMetadata: { provisioned_by: 'school' as const, school_code: 'DPS' },
  };

  it('creates an auth user the school owns: confirmed, flagged, with the PIN as its password', async () => {
    const { calls, impl } = fakeFetch((c) => (c.url.includes('/auth/v1/admin/users') ? json({ id: 'user-1' }) : json([{}], 201)));
    const id = await supabaseStore(URL_, KEY, impl).createAccount(account);
    expect(id).toBe('user-1');
    const auth = calls.find((c) => c.url === `${URL_}/auth/v1/admin/users`)!;
    expect(auth.method).toBe('POST');
    expect(JSON.parse(auth.body!)).toEqual({
      email: 'dps-sr001@login.qrie.invalid',
      password: '493817',
      email_confirm: true,
      app_metadata: { provisioned_by: 'school', school_code: 'DPS' },
    });
  });

  it('then seats the user in the school and records their login id', async () => {
    const { calls, impl } = fakeFetch((c) => (c.url.includes('/auth/v1/') ? json({ id: 'user-1' }) : json([{}], 201)));
    await supabaseStore(URL_, KEY, impl).createAccount(account);
    const membership = calls.find((c) => c.url === `${URL_}/rest/v1/membership`)!;
    expect(JSON.parse(membership.body!)).toEqual({ org_id: 'org-1', user_id: 'user-1', role: 'student' });
    const acc = calls.find((c) => c.url === `${URL_}/rest/v1/account`)!;
    expect(acc.headers['Content-Profile']).toBe('lms');
    expect(JSON.parse(acc.body!)).toEqual({
      org_id: 'org-1',
      user_id: 'user-1',
      login_id: 'DPS-SR001',
      kind: 'student',
      display_name: 'Riya',
    });
  });

  it('sends the PIN to the auth service and nowhere else', async () => {
    const { calls, impl } = fakeFetch((c) => (c.url.includes('/auth/v1/') ? json({ id: 'user-1' }) : json([{}], 201)));
    await supabaseStore(URL_, KEY, impl).createAccount(account);
    const elsewhere = calls.filter((c) => !c.url.includes('/auth/v1/'));
    for (const c of elsewhere) expect(`${c.url} ${c.body ?? ''}`).not.toContain('493817');
  });
});

describe('supabaseStore requests', () => {
  it('authenticate with the service role, and reach lms tables through the lms profile', async () => {
    const { calls, impl } = fakeFetch(() => json([{ org_id: 'org-1' }]));
    await supabaseStore(URL_, KEY, impl).ensureSchool({
      code: 'DPS',
      displayName: 'DPS',
      board: 'CBSE',
      year: { label: 'y', startsOn: '2026-04-01', endsOn: '2027-03-31' },
    });
    expect(calls[0].url).toBe(`${URL_}/rest/v1/school?code=eq.DPS&select=org_id`);
    expect(calls[0].headers).toMatchObject({ apikey: KEY, authorization: `Bearer ${KEY}`, 'Accept-Profile': 'lms' });
  });

  it('fail loudly on an error, without ever echoing the key', async () => {
    const { impl } = fakeFetch(() => new Response('{"message":"boom"}', { status: 500 }));
    const store = supabaseStore(URL_, KEY, impl);
    const err = await store.findAccount('org-1', 'DPS-1').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/500/);
    expect((err as Error).message).not.toContain(KEY);
  });
});

describe('supabaseStore.mayImport', () => {
  // The sentence of migration 0063 (admin.import_refusal).
  const LAPSED =
    "This school's licence has ended and its grace period is over, so no new people can be added until it is renewed.";

  it('asks lms.import_refusal with the service role and answers its sentence or null', async () => {
    const refusing = fakeFetch(() => json(LAPSED));
    const store = supabaseStore(URL_, KEY, refusing.impl);
    expect(store.mayImport).toBeTypeOf('function');
    expect(await store.mayImport!('org-1')).toBe(LAPSED);
    expect(refusing.calls).toHaveLength(1);
    const [c] = refusing.calls;
    expect(c.url).toBe(`${URL_}/rest/v1/rpc/import_refusal`);
    expect(c.method).toBe('POST');
    expect(c.headers['Content-Profile']).toBe('lms');
    expect(c.headers.apikey).toBe(KEY);
    expect(c.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(c.body).toBe('{"p_org":"org-1"}');

    const allowing = fakeFetch(() => json(null));
    expect(await supabaseStore(URL_, KEY, allowing.impl).mayImport!('org-1')).toBeNull();

    // The import stops rather than going on unasked.
    const failing = fakeFetch(() => json({ message: 'down' }, 500));
    await expect(supabaseStore(URL_, KEY, failing.impl).mayImport!('org-1')).rejects.toThrow(/500/);
  });
});
