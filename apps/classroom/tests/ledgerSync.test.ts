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
    expect(result).toEqual({ sent: 0, pending: 0, dropped: 0, refused: 0 });
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

/**
 * THE MOCK THAT BEHAVES LIKE POSTGRES ON THE ONE THING THAT MATTERED.
 *
 * Every test above answers `{ error: null }` whatever it is handed, so a row
 * the real database refuses reads as a row it accepted. That is not a
 * hypothetical gap: the event opening every sitting carried an id of
 * `<uuid>:0` against a `uuid` column, the real database answered
 * `22P02 invalid input syntax for type uuid`, and because a batch is one
 * statement it took every other event with it — on every drain, on every
 * device, for good. This whole file was green over it.
 *
 * So these tests give the mock the column type. It is two lines, and it is the
 * difference between a suite that proves the drain works and one that proves
 * the drain sends whatever it was given.
 */
describe('against a database that checks its column types', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** What Postgres actually answered, verified against the deployed project. */
  const likePostgres = (): void => {
    upsert.mockImplementation((table: string, rows: { id: string; session_id?: string }[]) => {
      if (table !== 'ledger_event') return Promise.resolve({ error: null });
      const bad = rows.find((r) => !UUID.test(r.id) || (r.session_id && !UUID.test(r.session_id)));
      return Promise.resolve(
        bad
          ? { error: { code: '22P02', message: `invalid input syntax for type uuid: "${bad.id}"` } }
          : { error: null },
      );
    });
  };

  it('lands a real class — every id the app mints is one the column accepts', async () => {
    likePostgres();
    aClass();
    const before = store.ledgerOutbox.get().pending.length;
    expect(before).toBeGreaterThan(0);

    const result = await sync.drainLedger();

    expect(result.sent).toBe(before);
    expect(result.refused).toBe(0);
    expect(store.ledgerOutbox.get().pending).toHaveLength(0);
  });

  it('quarantines one malformed row instead of letting it block the queue forever', async () => {
    likePostgres();
    aClass();
    // A poisoned event, the way a future bug would introduce one.
    const outbox = store.ledgerOutbox.get();
    const poisoned = { ...outbox.pending[0], id: `${outbox.pending[0].sessionId}:0` };
    store.ledgerOutbox.set({ ...outbox, pending: [poisoned, ...outbox.pending.slice(1)] });
    const total = store.ledgerOutbox.get().pending.length;

    const result = await sync.drainLedger();

    expect(result.refused).toBe(1);
    expect(result.sent).toBe(total - 1);
    // The queue MOVES. That is the whole point.
    expect(store.ledgerOutbox.get().pending).toHaveLength(0);
    expect(store.ledgerOutbox.get().rejected).toBe(1);
  });

  it('keeps everything when the refusal is about the moment and not the row', async () => {
    // 42501 is an RLS decision — the org may simply not be provisioned yet.
    upsert.mockImplementation((table: string) =>
      Promise.resolve(
        table === 'ledger_event' ? { error: { code: '42501', message: 'row-level security' } } : { error: null },
      ),
    );
    aClass();
    const before = store.ledgerOutbox.get().pending.length;

    const result = await sync.drainLedger();

    expect(result.reason).toBe('rejected');
    expect(result.refused).toBe(0);
    // Not one event discarded. A student's evidence is not thrown away because
    // their token happened to expire mid-flush.
    expect(store.ledgerOutbox.get().pending).toHaveLength(before);
    expect(store.ledgerOutbox.get().rejected).toBe(0);
  });
});

/**
 * A SHARED PHONE.
 *
 * The row this drain writes stamps whoever is signed in NOW, while the queue
 * was filled by whoever was using the device THEN. On a school tablet, or
 * after 'Delete your account' — which signs out and leaves the queue standing
 * — those are different people.
 */
describe('when the device changes hands', () => {
  it('does not upload the previous student\u2019s answers under the new name', async () => {
    aClass();
    await sync.drainLedger(); // student-1 claims the device and their work lands
    expect(store.ledgerOutbox.get().ownerId).toBe('student-1');

    // student-1 answers more, and leaves before it drains.
    aClass();
    const waiting = store.ledgerOutbox.get().pending.length;
    expect(waiting).toBeGreaterThan(0);

    upsert.mockClear();
    getUser.mockResolvedValue({ data: { user: { id: 'student-2' } } });
    sync.resetLedgerSync();
    const result = await sync.drainLedger();

    expect(result.sent).toBe(0);
    expect(upsert.mock.calls.filter((c) => c[0] === 'ledger_event')).toHaveLength(0);
    expect(store.ledgerOutbox.get().pending).toEqual([]);
    expect(store.ledgerOutbox.get().ownerId).toBe('student-2');
  });

  it('keeps the work when an anonymous student becomes a named one', async () => {
    // The upgrade path preserves the user id, so nothing is a handover.
    aClass();
    await sync.drainLedger();
    aClass();
    const waiting = store.ledgerOutbox.get().pending.length;

    sync.resetLedgerSync();
    const result = await sync.drainLedger();
    expect(result.sent).toBe(waiting);
  });

  it('re-resolves the organization for a new identity instead of reusing the last one', async () => {
    aClass();
    await sync.drainLedger();

    maybeSingle.mockResolvedValue({ data: { org_id: 'org-2' }, error: null });
    getUser.mockResolvedValue({ data: { user: { id: 'student-2' } } });
    // student-2 takes the device and does their own work.
    store.claimOutbox('student-2');
    aClass();
    await sync.drainLedger();

    const rows = upsert.mock.calls.filter((c) => c[0] === 'ledger_event').at(-1)![1] as { org_id: string }[];
    // The cached org used to be kept across identities, and RLS then refused
    // every drain silently until the page was reloaded.
    expect(rows.every((r) => r.org_id === 'org-2')).toBe(true);
  });

  /**
   * The ordering that the drain alone cannot get right: ownership has to move
   * when the IDENTITY changes, not when there is next something to send. A
   * student who signs in on a school tablet and only then starts their first
   * class would otherwise have that class discarded as the previous
   * occupant's — which is a worse bug than the one being fixed.
   */
  it('hands the device over on sign-in, so the new student’s own first class is kept', async () => {
    aClass();
    await sync.drainLedger(); // student-1 owns the device

    getUser.mockResolvedValue({ data: { user: { id: 'student-2' } } });
    store.claimOutbox('student-2'); // what the account-change listener does
    aClass(); // student-2's first class, recorded AFTER they signed in

    const waiting = store.ledgerOutbox.get().pending.length;
    const result = await sync.drainLedger();
    expect(result.sent).toBe(waiting);
  });
});

/**
 * THE SITTING ITSELF, AND THE NUMBER THE WHOLE SYSTEM IS JUDGED ON.
 *
 * learning_session.active_ms is the DENOMINATOR of "unassisted mastery gain
 * per learning minute". Both writes that maintain it used to have their errors
 * dropped, after which the events describing them were acknowledged anyway —
 * so one transient failure lost a sitting permanently and the outbox forgot it
 * had ever had it.
 */
describe('when the sitting cannot be written', () => {
  it('keeps the session-ended event rather than losing time on task', async () => {
    aClass();
    store.closeSession({ activeMs: 240_000, completed: true });
    rpc.mockResolvedValue({ error: { code: '40001', message: 'serialization failure' } });

    const result = await sync.drainLedger();

    const left = store.ledgerOutbox.get().pending;
    expect(left.map((e) => e.kind)).toEqual(['session-ended']);
    expect(result.sent).toBe(2); // the other two landed and were acknowledged

    // And it goes on the next drain, harmlessly — the ledger row is already
    // there and the id makes the repeat a no-op.
    rpc.mockResolvedValue({ error: null });
    await sync.drainLedger();
    expect(store.ledgerOutbox.get().pending).toEqual([]);
  });

  it('keeps the session-started event when the sitting row will not write', async () => {
    aClass();
    upsert.mockImplementation((table: string) =>
      Promise.resolve(
        table === 'learning_session' ? { error: { code: '40001', message: 'deadlock' } } : { error: null },
      ),
    );

    await sync.drainLedger();
    expect(store.ledgerOutbox.get().pending.map((e) => e.kind)).toContain('session-started');
  });
});
