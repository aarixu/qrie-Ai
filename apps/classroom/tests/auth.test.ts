import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SIGNING UP MUST NOT ABANDON THE STUDENT'S WORK.
 *
 * Every install already has an anonymous identity, created at start-up so the
 * ledger has somewhere to write from the first beat. That identity owns rows:
 * the organization Postgres provisioned for it, every ledger event, the plan.
 *
 * `signUp` would mint a SECOND user and silently orphan the first — the work
 * would still be in Postgres, attached to an id nobody can ever sign in as, and
 * nothing would throw. `updateUser` attaches the email to the identity they
 * already have: same user id, same rows.
 *
 * That distinction is one branch, it is invisible when it is wrong, and it is
 * the reason this file exists.
 */

const getUser = vi.fn();
const updateUser = vi.fn();
const signUp = vi.fn();
const signInWithPassword = vi.fn();
const resetPasswordForEmail = vi.fn();

let client: unknown;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => client,
}));

let auth: typeof import('../src/lib/supabase');

beforeEach(async () => {
  vi.resetModules();
  getUser.mockReset();
  updateUser.mockReset().mockResolvedValue({ error: null });
  signUp.mockReset().mockResolvedValue({ error: null });
  signInWithPassword.mockReset().mockResolvedValue({ error: null });
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  client = {
    auth: { getUser, updateUser, signUp, signInWithPassword, resetPasswordForEmail },
  };
  auth = await import('../src/lib/supabase');
});

const anonymous = () => getUser.mockResolvedValue({ data: { user: { id: 'u1', is_anonymous: true } } });
const permanent = () => getUser.mockResolvedValue({ data: { user: { id: 'u1', is_anonymous: false } } });

describe('creating an account', () => {
  it('UPGRADES the anonymous identity instead of minting a second user', async () => {
    anonymous();
    await auth.createAccount('a@b.com', 'longenough');
    expect(updateUser).toHaveBeenCalledWith({ email: 'a@b.com', password: 'longenough' });
    expect(signUp).not.toHaveBeenCalled();
  });

  it('creates one only when there is no anonymous session to upgrade', async () => {
    // A second device, or a cleared browser: there is nothing here to carry.
    permanent();
    await auth.createAccount('a@b.com', 'longenough');
    expect(signUp).toHaveBeenCalledWith({ email: 'a@b.com', password: 'longenough' });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('passes the reason back rather than swallowing it', async () => {
    anonymous();
    updateUser.mockResolvedValue({ error: { message: 'That email is already in use.' } });
    await expect(auth.createAccount('a@b.com', 'longenough')).resolves.toBe(
      'That email is already in use.',
    );
  });

  it('resolves to null when it worked', async () => {
    anonymous();
    await expect(auth.createAccount('a@b.com', 'longenough')).resolves.toBeNull();
  });
});

describe('isAnonymous', () => {
  it('is true only when Supabase says so', async () => {
    anonymous();
    await expect(auth.isAnonymous()).resolves.toBe(true);
    permanent();
    await expect(auth.isAnonymous()).resolves.toBe(false);
  });

  it('is false when nobody is signed in at all', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(auth.isAnonymous()).resolves.toBe(false);
  });
});

describe('signing in and resetting', () => {
  it('signs in with the password', async () => {
    await auth.signInWithPassword('a@b.com', 'longenough');
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'longenough' });
  });

  it('starts the reset mail', async () => {
    await auth.sendPasswordReset('a@b.com');
    expect(resetPasswordForEmail).toHaveBeenCalledWith('a@b.com');
  });

  it('reports a bad password rather than pretending it worked', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    await expect(auth.signInWithPassword('a@b.com', 'nope')).resolves.toBe(
      'Invalid login credentials',
    );
  });
});
