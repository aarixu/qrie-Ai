import { describe, expect, it } from 'vitest';
import { provisionOwner } from '../src/provision.ts';
/** The error a promise rejects with; fails the test if it does not reject. */
async function failure(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a rejection');
}

const KEY = 'service-role-key-that-must-never-leak';
const PASSWORD = 'a-long-owner-password';

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function stub(answers: { status: number; body: unknown }[]) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const a = answers[seen.length - 1] ?? { status: 200, body: null };
    return { ok: a.status < 400, status: a.status, text: async () => (a.body === null ? '' : JSON.stringify(a.body)) };
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const input = (fetchImpl: typeof fetch) => ({
  url: 'https://p.supabase.co/',
  serviceKey: KEY,
  email: 'owner@example.com',
  password: PASSWORD,
  name: ' Aarav ',
  environment: 'HOSTED' as const,
  fetchImpl,
});

describe('making the first owner', () => {
  it('creates a staff-marked account, sets the environment, then makes the owner, in that order', async () => {
    const { seen, fetchImpl } = stub([{ status: 200, body: { id: 'u-1' } }, { status: 200, body: null }, { status: 200, body: null }]);
    expect(await provisionOwner(input(fetchImpl))).toEqual({ userId: 'u-1' });
    expect(seen.map((s) => s.url)).toEqual([
      'https://p.supabase.co/auth/v1/admin/users',
      'https://p.supabase.co/rest/v1/rpc/set_environment',
      'https://p.supabase.co/rest/v1/rpc/bootstrap_owner',
    ]);
    expect(seen[0].body).toMatchObject({ email: 'owner@example.com', email_confirm: true, app_metadata: { provisioned_by: 'staff' } });
    expect(seen[1].body).toEqual({ p_env: 'HOSTED' });
    expect(seen[2].body).toEqual({ p_user: 'u-1', p_name: 'Aarav' });
  });

  it('sends the key only as headers, and selects the admin schema for the two functions', async () => {
    const { seen, fetchImpl } = stub([{ status: 200, body: { id: 'u-1' } }, { status: 200, body: null }, { status: 200, body: null }]);
    await provisionOwner(input(fetchImpl));
    for (const s of seen) {
      expect(s.headers.apikey).toBe(KEY);
      expect(JSON.stringify(s.body)).not.toContain(KEY);
    }
    expect(seen[1].headers['content-profile']).toBe('admin');
    expect(seen[2].headers['content-profile']).toBe('admin');
  });

  it('puts neither the key nor the password in an error', async () => {
    const { fetchImpl } = stub([{ status: 422, body: { msg: 'a user with this email address has already been registered' } }]);
    const err = await failure(provisionOwner(input(fetchImpl)));
    expect(err.message).toMatch(/creating the account failed: 422/);
    expect(err.message).not.toContain(KEY);
    expect(err.message).not.toContain(PASSWORD);
  });

  it('stops before touching the database when the second step fails', async () => {
    const { seen, fetchImpl } = stub([{ status: 200, body: { id: 'u-1' } }, { status: 500, body: { message: 'boom' } }]);
    await expect(provisionOwner(input(fetchImpl))).rejects.toThrow(/setting the environment failed: 500/);
    expect(seen).toHaveLength(2);
  });

  it.each([
    [{ email: 'not-an-email' }, /not an email/],
    [{ password: 'short' }, /at least 12/],
    [{ name: '   ' }, /give the owner a name/],
  ])('refuses bad input %j before any request', async (over, re) => {
    const { seen, fetchImpl } = stub([]);
    await expect(provisionOwner({ ...input(fetchImpl), ...over })).rejects.toThrow(re);
    expect(seen).toHaveLength(0);
  });
});
