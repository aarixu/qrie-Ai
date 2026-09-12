import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * HOW THE APP TALKS TO ITS OWN BACKEND.
 *
 * Two things this has to get right, and both were bugs before they were tests:
 *
 *   - ONE identity per device. A class opens several relay calls at once, and
 *     on a fresh phone each of them found no session and asked for an
 *     anonymous account of its own — several users for one student, only one
 *     kept, and a meter counting a fraction of what was spent.
 *   - ONE ticket at a time, renewed early. Her voice is fetched by an <audio>
 *     element that cannot send a header, so it carries a signed pass instead.
 */

const auth = {
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
};

vi.mock('../src/lib/supabase', () => ({
  supabase: () => ({ auth }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let relay: typeof import('../src/lib/relay');

const jsonResponse = (value: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, json: async () => value }) as unknown as Response;

beforeEach(async () => {
  vi.resetModules();
  auth.getSession.mockReset();
  auth.signInAnonymously.mockReset();
  relay = await import('../src/lib/relay');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('relayFetch', () => {
  it('attaches the session the student already has', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok-1' } } });
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push(init);
      return jsonResponse({});
    });

    await relay.relayFetch('/api/llm', { method: 'POST' });

    expect(new Headers(calls[0].headers).get('authorization')).toBe('Bearer tok-1');
  });

  it('starts exactly ONE anonymous session for several calls at once', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    let resolveSignIn: (v: unknown) => void = () => {};
    auth.signInAnonymously.mockReturnValue(
      new Promise((res) => {
        resolveSignIn = res;
      }),
    );
    vi.stubGlobal('fetch', async () => jsonResponse({}));

    const inFlight = [
      relay.relayFetch('/api/llm'),
      relay.relayFetch('/api/llm'),
      relay.relayFetch('/api/icons'),
    ];
    resolveSignIn({ data: { session: { access_token: 'anon-1' } }, error: null });
    await Promise.all(inFlight);

    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('establishes the identity at start-up without a relay call', async () => {
    // The ledger needs a student to attribute rows to. A cached class played
    // with on-device speech makes no relay call at all, so waiting for one
    // meant the outbox filled up reporting "no-account" and then discarded the
    // oldest events it held.
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.signInAnonymously.mockResolvedValue({
      data: { session: { access_token: 'anon-1' } },
      error: null,
    });

    await expect(relay.ensureIdentity()).resolves.toBe(true);
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('still mints ONE user when start-up and a class race each other', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    let resolveSignIn: (v: unknown) => void = () => {};
    auth.signInAnonymously.mockReturnValue(
      new Promise((res) => {
        resolveSignIn = res;
      }),
    );
    vi.stubGlobal('fetch', async () => jsonResponse({}));

    const racing = [relay.ensureIdentity(), relay.relayFetch('/api/llm'), relay.ensureIdentity()];
    resolveSignIn({ data: { session: { access_token: 'anon-1' } }, error: null });
    await Promise.all(racing);

    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('reports false rather than throwing when there is no identity to be had', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.signInAnonymously.mockResolvedValue({ data: { session: null }, error: { message: 'no' } });
    await expect(relay.ensureIdentity()).resolves.toBe(false);
  });

  it('tries again on a later call when signing in failed', async () => {
    // Failing once must not pin the device to "no identity" for the session:
    // that would be one flaky moment costing every class after it.
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.signInAnonymously
      .mockResolvedValueOnce({ data: { session: null }, error: { message: 'offline' } })
      .mockResolvedValueOnce({ data: { session: { access_token: 'anon-2' } }, error: null });
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push(init);
      return jsonResponse({});
    });

    await relay.relayFetch('/api/llm');
    await relay.relayFetch('/api/llm');

    expect(auth.signInAnonymously).toHaveBeenCalledTimes(2);
    expect(new Headers(calls[1].headers).get('authorization')).toBe('Bearer anon-2');
  });

  it('sends no Authorization at all rather than an empty one', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.signInAnonymously.mockResolvedValue({ data: { session: null }, error: { message: 'no' } });
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push(init);
      return jsonResponse({});
    });

    await relay.relayFetch('/api/llm');

    expect(new Headers(calls[0].headers).has('authorization')).toBe(false);
  });
});

describe('the speech ticket', () => {
  beforeEach(() => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  });

  it('asks once and reuses the answer', async () => {
    let minted = 0;
    vi.stubGlobal('fetch', async () => {
      minted += 1;
      return jsonResponse({ ticket: `t-${minted}`, expiresAt: Date.now() + 600_000 });
    });

    expect(await relay.speechTicket()).toBe('t-1');
    expect(await relay.speechTicket()).toBe('t-1');
    expect(minted).toBe(1);
  });

  it('mints once for several lines asking at the same moment', async () => {
    let minted = 0;
    vi.stubGlobal('fetch', async () => {
      minted += 1;
      return jsonResponse({ ticket: 't', expiresAt: Date.now() + 600_000 });
    });

    await Promise.all([relay.speechTicket(), relay.speechTicket(), relay.speechTicket()]);

    expect(minted).toBe(1);
  });

  it('reads as null before there is one, without waiting', () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ ticket: 't', expiresAt: Date.now() + 600_000 }));

    // Synchronous on purpose: it is read while building the URL for an audio
    // element, and an await there would be a pause in the middle of a sentence.
    expect(relay.currentSpeechTicket()).toBeNull();
  });

  it('renews a ticket that is nearly out, rather than serving it', async () => {
    let minted = 0;
    vi.stubGlobal('fetch', async () => {
      minted += 1;
      // The first is already inside the renewal window; the second is fresh.
      return jsonResponse({
        ticket: `t-${minted}`,
        expiresAt: Date.now() + (minted === 1 ? 30_000 : 600_000),
      });
    });

    expect(await relay.speechTicket()).toBe('t-1');
    expect(await relay.speechTicket()).toBe('t-2');
  });

  it('returns null rather than throwing when the relay refuses', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({}, false));

    expect(await relay.speechTicket()).toBeNull();
  });

  it('forgets the ticket and the session on sign-out', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ ticket: 't', expiresAt: Date.now() + 600_000 }));
    await relay.speechTicket();
    expect(relay.currentSpeechTicket()).toBe('t');

    relay.forgetTicket();

    // It names the student who has just left; keeping it would let the next
    // person on a shared phone speak as them.
    expect(relay.currentSpeechTicket()).toBeNull();
  });
});

describe('relayError', () => {
  it('shows a refusal in the words the student should read', () => {
    const said = { error: { message: 'You have used up today’s classes. This resets tomorrow.' } };

    expect(relay.relayError(429, said).message).toBe(said.error.message);
    expect(relay.relayError(503, said).message).toBe(said.error.message);
  });

  it('keeps the technical form for anything that is ours to debug', () => {
    expect(relay.relayError(500, { error: { message: 'boom' } }).message).toBe('relay 500: boom');
    expect(relay.relayError(404, null).message).toBe('relay 404');
  });
});
