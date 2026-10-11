import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
 *
 * AND THE SECOND SILENT FAILURE, measured against the deployed project on
 * 2026-09-13: "Confirm email" is ON there, so `updateUser` answers 200 with no
 * error and a user still reading `email: ''`, `is_anonymous: true`, the address
 * sitting unused in `new_email`. Every assertion below about `awaiting-email`
 * is that reply written down — the screen used to call it success.
 */

const getUser = vi.fn();
const getSession = vi.fn();
const updateUser = vi.fn();
const signUp = vi.fn();
const signInWithPassword = vi.fn();
const resetPasswordForEmail = vi.fn();
const signOut = vi.fn();
const rpc = vi.fn();

/**
 * lib/supabase.ts builds its client only when the project's URL and key are set, and reads them once
 * at import. createClient is mocked below, so any non-empty values do; a real .env keeps its own.
 */
vi.hoisted(() => {
  process.env.VITE_SUPABASE_URL ||= 'https://test-project.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key';
});

let client: unknown;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => client,
}));

/**
 * Leaving the screen is the ONE thing that tells a child they are done, so it
 * is the one thing worth spying on. Everything else the screen does is words.
 */
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

let auth: typeof import('../src/lib/supabase');
/**
 * The REAL relay, not a stand-in.
 *
 * The defect being pinned here is that sign-out and the speech ticket live in
 * two files and nothing joined them. A mocked relay would assert that this file
 * calls a function, which is exactly what the old comment already claimed and
 * what was not true.
 */
let relay: typeof import('../src/lib/relay');

/** What the upgrade returns once the email really is on the identity. */
const attachedTo = (email: string) => ({
  data: { user: { id: 'u1', email, is_anonymous: false } },
  error: null,
});

/** What it returns while the link is still sitting in an inbox. */
const pendingFor = (email: string) => ({
  data: { user: { id: 'u1', email: '', new_email: email, is_anonymous: true } },
  error: null,
});

const ticketResponse = (value: string): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ ticket: value, expiresAt: Date.now() + 600_000 }),
  }) as unknown as Response;

beforeEach(async () => {
  vi.resetModules();
  getUser.mockReset();
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok-1' } } });
  updateUser.mockReset().mockResolvedValue(attachedTo('a@b.com'));
  signUp.mockReset().mockResolvedValue({ data: { user: { id: 'u2' }, session: { access_token: 'tok-2' } }, error: null });
  signInWithPassword.mockReset().mockResolvedValue({ error: null });
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset().mockResolvedValue({ error: null });
  navigate.mockReset();
  client = {
    auth: {
      getUser,
      getSession,
      updateUser,
      signUp,
      signInWithPassword,
      resetPasswordForEmail,
      signOut,
    },
    rpc,
  };
  auth = await import('../src/lib/supabase');
  relay = await import('../src/lib/relay');
});

let mounted: Root | null = null;

afterEach(() => {
  vi.unstubAllGlobals();
  if (mounted) act(() => mounted!.unmount());
  mounted = null;
});

/**
 * Fill a field the way a student does.
 *
 * Through the value setter on the prototype rather than `field.value =`,
 * because React remembers the last value it wrote and would treat a direct
 * assignment as no change at all — the form would stay empty and the test
 * would pass for the wrong reason.
 */
async function type(field: HTMLInputElement, value: string): Promise<void> {
  const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    write?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Mount the sign-up screen and fill it in, exactly as far as tapping. */
async function signUpScreen(address: string): Promise<HTMLElement> {
  const { SignIn } = await import('../src/screens/SignIn');
  const host = document.createElement('div');
  document.body.appendChild(host);
  mounted = createRoot(host);
  await act(async () => mounted!.render(createElement(SignIn)));

  await type(host.querySelector('input[type="email"]') as HTMLInputElement, address);
  await type(host.querySelector('input[type="password"]') as HTMLInputElement, 'longenough');
  return host;
}

const tap = async (host: HTMLElement, label: string): Promise<void> => {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`no button reading "${label}"`);
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

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
    updateUser.mockResolvedValue({ data: { user: null }, error: { message: 'That email is already in use.' } });
    await expect(auth.createAccount('a@b.com', 'longenough')).resolves.toEqual({
      state: 'failed',
      problem: 'That email is already in use.',
    });
  });

  it('says signed-up only when the identity comes back WEARING the email', async () => {
    anonymous();
    await expect(auth.createAccount('a@b.com', 'longenough')).resolves.toEqual({
      state: 'signed-up',
    });
  });

  it('does not call an unconfirmed upgrade an account, however quiet the reply', async () => {
    /**
     * The exact answer the deployed project gives with "Confirm email" on: no
     * error, and an identity that is still anonymous. If this ever reads
     * `signed-up`, a student is being told their term's work is safe while the
     * only thing holding it is one reinstall from gone.
     */
    anonymous();
    updateUser.mockResolvedValue(pendingFor('a@b.com'));
    await expect(auth.createAccount('a@b.com', 'longenough')).resolves.toEqual({
      state: 'awaiting-email',
      email: 'a@b.com',
    });
  });

  it('is not fooled by the capital a student typed in their own address', async () => {
    // The server stores it lowercased. Comparing raw would leave a confirmed
    // account stuck on "check your email" forever.
    anonymous();
    updateUser.mockResolvedValue(attachedTo('a@b.com'));
    await expect(auth.createAccount('A@B.com', 'longenough')).resolves.toEqual({
      state: 'signed-up',
    });
  });

  it('treats a fresh sign-up with no session as unconfirmed too', async () => {
    // Same lie by the other branch: `signUp` with confirmation on returns a
    // user and no session, and nobody is signed in as an account that is not
    // finished yet.
    permanent();
    signUp.mockResolvedValue({ data: { user: { id: 'u2' }, session: null }, error: null });
    await expect(auth.createAccount('a@b.com', 'longenough')).resolves.toEqual({
      state: 'awaiting-email',
      email: 'a@b.com',
    });
  });

  it('is signed-up when the fresh sign-up hands back a session', async () => {
    permanent();
    await expect(auth.createAccount('a@b.com', 'longenough')).resolves.toEqual({
      state: 'signed-up',
    });
  });
});

describe('the screen a child actually signs up on', () => {
  /**
   * A SCREEN MAY NOT CLAIM AN ACCOUNT THAT DOES NOT EXIST.
   *
   * This is the defect end to end rather than in the library: the upgrade came
   * back quiet, the screen read quiet as done, and it navigated home. A student
   * who is shown the way out believes they are finished — and the identity
   * holding their term of work is still the anonymous one a reinstall deletes.
   */
  it('keeps the student here, and says why, when the email is only sent', async () => {
    anonymous();
    updateUser.mockResolvedValue(pendingFor('kid@school.in'));
    const host = await signUpScreen('kid@school.in');

    await tap(host, 'Create my account');

    expect(navigate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Check your email');
    // The address they typed, so a typo is visible to the one person who can
    // spot it.
    expect(host.textContent).toContain('kid@school.in');
  });

  it('promises the work is safe meanwhile, rather than that the account is made', async () => {
    anonymous();
    updateUser.mockResolvedValue(pendingFor('kid@school.in'));
    const host = await signUpScreen('kid@school.in');

    await tap(host, 'Create my account');

    expect(host.textContent).toContain('still here on this device');
    expect(host.textContent).not.toContain('Keep your progress');
  });

  it('does send them on when the email really did attach', async () => {
    // The other half of the pair: without this, a screen that never navigates
    // would pass the test above and be just as wrong.
    anonymous();
    updateUser.mockResolvedValue(attachedTo('kid@school.in'));
    const host = await signUpScreen('kid@school.in');

    await tap(host, 'Create my account');

    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });
});

describe('ending a session', () => {
  /**
   * THE NEXT STUDENT ON A SHARED PHONE MUST NOT SPEAK AS THE LAST ONE.
   *
   * The speech ticket is a signed pass naming one student, held in memory for
   * ten minutes, and the relay meters every spoken line against whoever it
   * names. `forgetTicket` was written for this and had no caller at all.
   */
  it('leaves no speech ticket behind when the student signs out', async () => {
    vi.stubGlobal('fetch', async () => ticketResponse('pass-for-u1'));
    await relay.speechTicket();
    expect(relay.currentSpeechTicket()).toBe('pass-for-u1');

    await auth.signOut();

    expect(relay.currentSpeechTicket()).toBeNull();
  });

  it('drops the ticket even if the sign-out itself fails', async () => {
    // A pass that outlives a failed sign-out is the same hole; the order of
    // these two lines in signOut is the whole guarantee.
    vi.stubGlobal('fetch', async () => ticketResponse('pass-for-u1'));
    await relay.speechTicket();
    signOut.mockRejectedValue(new Error('offline'));

    await expect(auth.signOut()).rejects.toThrow('offline');

    expect(relay.currentSpeechTicket()).toBeNull();
  });

  it('a ticket already on the wire when they sign out never lands', async () => {
    // Clearing the in-flight promise does not cancel the request it names, so
    // without the era check the reply would quietly restore the pass a moment
    // after the student left.
    let deliver: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', () => new Promise<Response>((res) => (deliver = res)));
    const inFlight = relay.speechTicket();

    await auth.signOut();
    deliver(ticketResponse('pass-for-u1'));

    await expect(inFlight).resolves.toBeNull();
    expect(relay.currentSpeechTicket()).toBeNull();
  });

  it('deleting the account drops the ticket as well', async () => {
    // Deletion ends a session too, and it ended it by its own route until the
    // two were made one — which is how a safety measure gets wired in one path
    // and forgotten in the other.
    vi.stubGlobal('fetch', async () => ticketResponse('pass-for-u1'));
    await relay.speechTicket();

    await expect(auth.deleteOwnAccount()).resolves.toBeNull();

    expect(relay.currentSpeechTicket()).toBeNull();
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
