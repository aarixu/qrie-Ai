import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DRAINING THE LEDGER WITHOUT LOSING IT.
 *
 * Only one mistake in this file destroys data permanently: acknowledging a
 * batch the server never took. Everything else is recoverable — a repeated
 * insert is a no-op, because the event id is minted on the device and is the
 * table's primary key. So these tests are mostly about the failure paths, and
 * about proving the outbox is untouched on every one of them.
 */

const upsert = vi.fn();
const rpc = vi.fn();
const getUser = vi.fn();
const maybeSingle = vi.fn();

const from = vi.fn((table: string) => {
  if (table === 'membership') {
    return {
      select: () => ({ eq: () => ({ limit: () => ({ maybeSingle }) }) }),
    };
  }
  return { upsert: (rows: unknown, opts: unknown) => upsert(table, rows, opts) };
});

let client: unknown = { from, rpc, auth: { getUser } };

vi.mock('../src/lib/supabase', () => ({
  supabase: () => client,
}));

let store: typeof import('../src/stores/ledger');
let sync: typeof import('../src/lib/ledgerSync');

beforeEach(async () => {
  vi.resetModules();
  upsert.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset().mockResolvedValue({ error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'student-1' } } });
  maybeSingle.mockReset().mockResolvedValue({ data: { org_id: 'org-1' }, error: null });
  from.mockClear();
  client = { from, rpc, auth: { getUser } };
  localStorage.clear();
  store = await import('../src/stores/ledger');
  sync = await import('../src/lib/ledgerSync');
  store.resetLedgerOutbox();
  sync.resetLedgerSync();
});

afterEach(() => {
  localStorage.clear();
});

const aClass = (): void => {
  store.openSession({ source: 'class', topicRef: 'class10-science/life-processes/respiration' });
  store.logAnswer({
    surface: 'voice',
    outcomeIds: ['sci10-lp-respiration-equation'],
    correct: true,
    ms: 5200,
    attempt: 1,
    assistanceRung: 0,
    hintsShown: 0,
  });
};

describe('a successful drain', () => {
  it('sends the queued events and forgets exactly those', async () => {
    aClass();
    expect(store.ledgerOutbox.get().pending).toHaveLength(2);

    const result = await sync.drainLedger();

    expect(result.sent).toBe(2);
    expect(store.ledgerOutbox.get().pending).toHaveLength(0);
    const [table, rows] = upsert.mock.calls.find((c) => c[0] === 'ledger_event')!;
    expect(table).toBe('ledger_event');
    expect(rows).toHaveLength(2);
  });

  it('writes the sitting itself, derived from the session-started event', async () => {
    // Nothing extra is queued for the session row — it is reconstructed here,
    // so a session opened on a plane and closed on the ground still lands.
    aClass();
    await sync.drainLedger();
    const call = upsert.mock.calls.find((c) => c[0] === 'learning_session');
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject([
      { user_id: 'student-1', org_id: 'org-1', source: 'class' },
    ]);
  });

  it('closes a session through the RPC, because there is no update policy', async () => {
    aClass();
    store.closeSession({ activeMs: 9 * 60_000, completed: true });
    await sync.drainLedger();
    expect(rpc).toHaveBeenCalledWith('close_learning_session', {
      p_session: expect.any(String),
      p_ended_at: expect.any(String),
      p_active_ms: 540_000,
    });
  });

  it('sends the id the device minted, which is what makes a replay harmless', async () => {
    aClass();
    const queued = store.ledgerOutbox.get().pending.map((e) => e.id);
    await sync.drainLedger();
    const rows = upsert.mock.calls.find((c) => c[0] === 'ledger_event')![1] as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(queued);
    const opts = upsert.mock.calls.find((c) => c[0] === 'ledger_event')![2];
    expect(opts).toMatchObject({ onConflict: 'id', ignoreDuplicates: true });
  });
});

describe('every way it can fail', () => {
  it('keeps everything when the write is rejected', async () => {
    aClass();
    upsert.mockImplementation((table: string) =>
      table === 'ledger_event' ? Promise.resolve({ error: { message: 'nope' } }) : Promise.resolve({ error: null }),
    );
    const result = await sync.drainLedger();
    expect(result.reason).toBe('rejected');
    expect(result.sent).toBe(0);
    expect(store.ledgerOutbox.get().pending).toHaveLength(2);
  });

  it('keeps everything when the network dies mid-flush', async () => {
    aClass();
    upsert.mockImplementation((table: string) =>
      table === 'ledger_event' ? Promise.reject(new Error('offline')) : Promise.resolve({ error: null }),
    );
    const result = await sync.drainLedger();
    expect(result.reason).toBe('offline');
    expect(store.ledgerOutbox.get().pending).toHaveLength(2);
  });

  it('waits rather than losing events when there is no account yet', async () => {
    // A class must never block on sign-in, so this is an ordinary state.
    aClass();
    getUser.mockResolvedValue({ data: { user: null } });
    const result = await sync.drainLedger();
    expect(result.reason).toBe('no-account');
    expect(store.ledgerOutbox.get().pending).toHaveLength(2);
  });

  it('waits when the organization cannot be resolved', async () => {
    aClass();
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await sync.drainLedger();
    expect(result.reason).toBe('no-org');
    expect(store.ledgerOutbox.get().pending).toHaveLength(2);
  });

  it('waits when there is no project configured at all', async () => {
    aClass();
    client = null;
    const result = await sync.drainLedger();
    expect(result.reason).toBe('offline');
    expect(store.ledgerOutbox.get().pending).toHaveLength(2);
  });

  it('re-sends the identical batch after a failure', async () => {
    aClass();
    upsert.mockImplementationOnce(() => Promise.resolve({ error: null })) // learning_session
      .mockImplementationOnce(() => Promise.resolve({ error: { message: 'nope' } })); // ledger_event
    await sync.drainLedger();
    const firstIds = store.ledgerOutbox.get().pending.map((e) => e.id);

    upsert.mockReset().mockResolvedValue({ error: null });
    const second = await sync.drainLedger();

    expect(second.sent).toBe(2);
    const rows = upsert.mock.calls.find((c) => c[0] === 'ledger_event')![1] as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(firstIds);
  });
});

describe('concurrency', () => {
  it('collapses two simultaneous drains into one', async () => {
    aClass();
    const [a, b] = await Promise.all([sync.drainLedger(), sync.drainLedger()]);
    expect(a).toBe(b);
    expect(upsert.mock.calls.filter((c) => c[0] === 'ledger_event')).toHaveLength(1);
  });

  it('does nothing at all when the outbox is empty', async () => {
    const result = await sync.drainLedger();
    expect(result).toEqual({ sent: 0, pending: 0, dropped: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('carries the dropped count out, so a holed record can say so', async () => {
    // The cap discards the oldest events when a device has been offline for a
    // very long time. A learner model rebuilt from a ledger with a non-zero
    // count here is reading an incomplete story, and nothing should have to
    // guess that.
    aClass();
    const outbox = store.ledgerOutbox.get();
    store.ledgerOutbox.set({ ...outbox, dropped: 7 });
    const result = await sync.drainLedger();
    expect(result.dropped).toBe(7);
  });
});

describe('the outbox store', () => {
  it('does NOT join the key-value sync registry', async () => {
    // That sync is last-write-wins on a whole blob per key. Carrying an
    // append-only queue on it would let one device's outbox replace another's
    // — which is the failure this whole table exists to end.
    const { registeredStores } = await import('../src/stores/localStore');
    aClass();
    expect([...registeredStores().keys()]).not.toContain('ai-tutor:ledger-outbox');
  });

  it('survives a reload', async () => {
    aClass();
    const before = store.ledgerOutbox.get().pending.map((e) => e.id);
    vi.resetModules();
    const reloaded = await import('../src/stores/ledger');
    expect(reloaded.ledgerOutbox.get().pending.map((e) => e.id)).toEqual(before);
  });
});
