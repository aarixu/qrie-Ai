import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DRAINING THE LEDGER WITHOUT LOSING IT.
 *
 * Only one mistake in this file destroys data permanently: acknowledging a
 * batch the server never took. Everything else is recoverable — a repeated
 * event comes back 'duplicate', because the event id is minted on the device
 * and is the table's primary key. So these tests are mostly about the failure
 * paths, and about proving the outbox is untouched on every one of them.
 *
 * The drain writes through public.record_evidence (0107, lam-one-brain Task
 * 7a), which answers every event on its own: recorded, duplicate or refused.
 */

interface Sent {
  p_sessions: { id: string; source: string; topicRef: string | null; startedAt: string }[];
  p_events: { id: string; sessionId: string; kind: string }[];
}

/** The function's answer when it takes every event. */
const recordedAll = (args: Sent) => ({
  data: args.p_events.map((e) => ({ id: e.id, status: 'recorded', reason: null, received_at: '2026-10-08T00:00:00Z' })),
  error: null,
});

/** record_evidence's answer, by default every event recorded. */
const record = vi.fn();
/** close_learning_session's answer. */
const close = vi.fn();
const rpc = vi.fn((name: string, args: unknown) =>
  name === 'record_evidence'
    ? record(args)
    : name === 'close_learning_session'
      ? close(args)
      : Promise.resolve({ error: { message: `no ${name}` } }),
);
const getUser = vi.fn();
const from = vi.fn();

let client: unknown = { from, rpc, auth: { getUser } };

vi.mock('../src/lib/supabase', () => ({
  supabase: () => client,
}));

let store: typeof import('../src/stores/ledger');
let sync: typeof import('../src/lib/ledgerSync');

beforeEach(async () => {
  vi.resetModules();
  record.mockReset().mockImplementation((args: Sent) => Promise.resolve(recordedAll(args)));
  close.mockReset().mockResolvedValue({ error: null });
  rpc.mockClear();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'student-1' } } });
  from.mockReset();
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

const sent = (): Sent[] => record.mock.calls.map((c) => c[0] as Sent);
const lastSent = (): Sent => sent().at(-1)!;

describe('a successful drain', () => {
  it('sends the queued events and forgets exactly those', async () => {
    aClass();
    expect(store.ledgerOutbox.get().pending).toHaveLength(2);

    const result = await sync.drainLedger();

    expect(result.sent).toBe(2);
    expect(store.ledgerOutbox.get().pending).toHaveLength(0);
    expect(rpc).toHaveBeenCalledWith('record_evidence', expect.anything());
    expect(lastSent().p_events).toHaveLength(2);
  });

  it('writes through record_evidence only, never into the tables', async () => {
    aClass();
    await sync.drainLedger();
    expect(from).not.toHaveBeenCalled();
  });

  it('describes the sitting from its session-started event, and leaves the org and the learner to the server', async () => {
    // Nothing extra is queued for the session row — it is described here, so
    // a session opened on a plane and closed on the ground still lands. Who
    // and which school are the token's, decided by the function.
    aClass();
    const opened = store.ledgerOutbox.get().pending.find((e) => e.kind === 'session-started')!;
    await sync.drainLedger();
    expect(lastSent().p_sessions).toEqual([
      { id: opened.sessionId, source: 'class', topicRef: 'class10-science/life-processes/respiration', startedAt: opened.at },
    ]);
    expect(JSON.stringify(lastSent())).not.toMatch(/org_?id|user_?id/i);
  });

  it('closes a session through the RPC, after the sitting is written', async () => {
    aClass();
    store.closeSession({ activeMs: 9 * 60_000, completed: true });
    await sync.drainLedger();
    expect(rpc).toHaveBeenCalledWith('close_learning_session', {
      p_session: expect.any(String),
      p_ended_at: expect.any(String),
      p_active_ms: 540_000,
    });
    // A close before record_evidence has made the sitting finds no row and
    // closes nothing.
    const names = rpc.mock.calls.map((c) => c[0]);
    expect(names.indexOf('record_evidence')).toBeLessThan(names.indexOf('close_learning_session'));
  });

  it('sends the id the device minted, which is what makes a replay harmless', async () => {
    aClass();
    const queued = store.ledgerOutbox.get().pending.map((e) => e.id);
    await sync.drainLedger();
    expect(lastSent().p_events.map((e) => e.id)).toEqual(queued);
  });

  it('acknowledges an event the server already holds', async () => {
    // The response to the last drain was lost; the server answers the repeat
    // 'duplicate', and the event is done with.
    aClass();
    record.mockImplementation((args: Sent) =>
      Promise.resolve({ data: args.p_events.map((e) => ({ id: e.id, status: 'duplicate', reason: null })), error: null }),
    );
    const result = await sync.drainLedger();
    expect(result.sent).toBe(2);
    expect(store.ledgerOutbox.get().pending).toHaveLength(0);
  });
});

describe('every way it can fail', () => {
  it('keeps everything when the write is rejected', async () => {
    aClass();
    record.mockResolvedValue({ data: null, error: { message: 'nope' } });
    const result = await sync.drainLedger();
    expect(result.reason).toBe('rejected');
    expect(result.sent).toBe(0);
    expect(store.ledgerOutbox.get().pending).toHaveLength(2);
  });

  it('keeps everything when the network dies mid-flush', async () => {
    aClass();
    record.mockRejectedValue(new Error('offline'));
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

  it('waits when the server has no organization for the student yet', async () => {
    // record_evidence answers 42501 while the account's org is provisioned.
    aClass();
    record.mockResolvedValue({ data: null, error: { code: '42501', message: 'record_evidence: no organization yet' } });
    const result = await sync.drainLedger();
    expect(result.reason).toBe('rejected');
    expect(store.ledgerOutbox.get().pending).toHaveLength(2);
  });

  it('keeps everything when the call itself is refused as malformed, rather than binning a whole batch', async () => {
    // A call-level 22023 is about the call (not a list, over 500 events), not
    // any one event: each event's own fault comes back in its own row.
    aClass();
    record.mockResolvedValue({ data: null, error: { code: '22023', message: 'at most 500 events' } });
    const result = await sync.drainLedger();
    expect(result.reason).toBe('rejected');
    expect(store.ledgerOutbox.get().pending).toHaveLength(2);
    expect(store.ledgerOutbox.get().rejected).toBe(0);
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
    record.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    await sync.drainLedger();
    const firstIds = store.ledgerOutbox.get().pending.map((e) => e.id);

    const second = await sync.drainLedger();

    expect(second.sent).toBe(2);
    expect(lastSent().p_events.map((e) => e.id)).toEqual(firstIds);
  });
});

describe('concurrency', () => {
  it('collapses two simultaneous drains into one', async () => {
    aClass();
    const [a, b] = await Promise.all([sync.drainLedger(), sync.drainLedger()]);
    expect(a).toBe(b);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when the outbox is empty', async () => {
    const result = await sync.drainLedger();
    expect(result).toEqual({ sent: 0, pending: 0, dropped: 0, refused: 0 });
    expect(rpc).not.toHaveBeenCalled();
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
 * THE MOCK THAT BEHAVES LIKE THE FUNCTION ON THE ONE THING THAT MATTERED.
 *
 * Most tests above answer every event 'recorded' whatever it is handed, so an
 * event the real database refuses reads as one it accepted. That is not a
 * hypothetical gap: the event opening every sitting once carried an id of
 * `<uuid>:0` against a `uuid` column, and when the drain was one insert of the
 * whole batch the real database's 22P02 took every other event with it — on
 * every drain, on every device, for good. This whole file was green over it.
 *
 * record_evidence (0107) answers that event alone: refused, 'bad-id'. So these
 * tests give the mock that check, as the function makes it.
 */
describe('against a function that checks each event', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** What record_evidence answers for an id or a sitting id that is not a uuid. */
  const likeTheFunction = (): void => {
    record.mockImplementation((args: Sent) =>
      Promise.resolve({
        data: args.p_events.map((e) =>
          !UUID.test(e.id)
            ? { id: e.id, status: 'refused', reason: 'bad-id', received_at: null }
            : !UUID.test(e.sessionId)
              ? { id: e.id, status: 'refused', reason: 'bad-session', received_at: null }
              : { id: e.id, status: 'recorded', reason: null, received_at: '2026-10-08T00:00:00Z' },
        ),
        error: null,
      }),
    );
  };

  it('lands a real class — every id the app mints is one the column accepts', async () => {
    likeTheFunction();
    aClass();
    const before = store.ledgerOutbox.get().pending.length;
    expect(before).toBeGreaterThan(0);

    const result = await sync.drainLedger();

    expect(result.sent).toBe(before);
    expect(result.refused).toBe(0);
    expect(store.ledgerOutbox.get().pending).toHaveLength(0);
  });

  it('quarantines one malformed row instead of letting it block the queue forever', async () => {
    likeTheFunction();
    aClass();
    // A poisoned event, the way a future bug would introduce one.
    const outbox = store.ledgerOutbox.get();
    const poisoned = { ...outbox.pending[0], id: `${outbox.pending[0].sessionId}:0` };
    store.ledgerOutbox.set({ ...outbox, pending: [poisoned, ...outbox.pending.slice(1)] });
    const total = store.ledgerOutbox.get().pending.length;

    const result = await sync.drainLedger();

    expect(result.refused).toBe(1);
    expect(result.sent).toBe(total - 1);
    expect(record).toHaveBeenCalledTimes(1);
    // The queue MOVES. That is the whole point.
    expect(store.ledgerOutbox.get().pending).toHaveLength(0);
    expect(store.ledgerOutbox.get().rejected).toBe(1);
  });

  it('keeps everything when the refusal is about the moment and not the row', async () => {
    // 42501 — the org may simply not be provisioned yet.
    record.mockResolvedValue({ data: null, error: { code: '42501', message: 'record_evidence: no organization yet' } });
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

    record.mockClear();
    getUser.mockResolvedValue({ data: { user: { id: 'student-2' } } });
    sync.resetLedgerSync();
    const result = await sync.drainLedger();

    expect(result.sent).toBe(0);
    expect(record).not.toHaveBeenCalled();
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

  it('carries no org from one identity to the next, because it never names one', async () => {
    // The drain used to cache the org it looked up and send it with every
    // row; kept across identities, RLS then refused every drain silently until
    // the page was reloaded. The function now takes the org from the token.
    aClass();
    await sync.drainLedger();

    getUser.mockResolvedValue({ data: { user: { id: 'student-2' } } });
    // student-2 takes the device and does their own work.
    store.claimOutbox('student-2');
    aClass();
    const waiting = store.ledgerOutbox.get().pending.length;
    const result = await sync.drainLedger();

    expect(result.sent).toBe(waiting);
    expect(from).not.toHaveBeenCalled();
    expect(JSON.stringify(sent())).not.toMatch(/org/i);
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
    close.mockResolvedValue({ error: { code: '40001', message: 'serialization failure' } });

    const result = await sync.drainLedger();

    const left = store.ledgerOutbox.get().pending;
    expect(left.map((e) => e.kind)).toEqual(['session-ended']);
    expect(result.sent).toBe(2); // the other two landed and were acknowledged

    // And it goes on the next drain, harmlessly — the ledger row is already
    // there and the server answers the repeat 'duplicate'.
    close.mockResolvedValue({ error: null });
    await sync.drainLedger();
    expect(store.ledgerOutbox.get().pending).toEqual([]);
  });

  it('does not close a sitting whose closing event the server refused', async () => {
    aClass();
    store.closeSession({ activeMs: 240_000, completed: true });
    record.mockImplementation((args: Sent) =>
      Promise.resolve({
        data: args.p_events.map((e) =>
          e.kind === 'session-ended'
            ? { id: e.id, status: 'refused', reason: 'not-your-session', received_at: null }
            : { id: e.id, status: 'recorded', reason: null, received_at: '2026-10-08T00:00:00Z' },
        ),
        error: null,
      }),
    );

    const result = await sync.drainLedger();
    expect(result.refused).toBe(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('keeps an event the server gave no answer for', async () => {
    aClass();
    record.mockImplementation((args: Sent) =>
      Promise.resolve({
        data: args.p_events
          .filter((e) => e.kind !== 'session-started')
          .map((e) => ({ id: e.id, status: 'recorded', reason: null, received_at: '2026-10-08T00:00:00Z' })),
        error: null,
      }),
    );

    await sync.drainLedger();
    expect(store.ledgerOutbox.get().pending.map((e) => e.kind)).toEqual(['session-started']);
  });
});

/**
 * WHICH SITTING A RELAY CALL IS BILLED TO.
 *
 * Every model call, spoken line and transcription is stamped server-side with
 * `currentSessionId()`, and that is what makes "cost per class" and "cost per
 * student-hour" real numbers rather than estimates. `endSession` keeps the
 * session object so the sitting it describes can still be read — and this
 * getter used to hand its id out forever after. On a device's second cold
 * class, every preparation call was billed to the FIRST class, so one sitting
 * carried another sitting's ten rupees of prep and the per-hour figure divided
 * one session's spend by a different session's time on task.
 */
describe('the sitting a relay call is attributed to', () => {
  it('is the one that is open', () => {
    const id = store.openSession({ source: 'class', topicRef: 'class10-science/heredity/mendel' });
    expect(store.currentSessionId()).toBe(id);
  });

  it('is nobody once the class has ended', () => {
    store.openSession({ source: 'class', topicRef: 'class10-science/heredity/mendel' });
    store.closeSession({ activeMs: 240_000, completed: true });
    expect(store.currentSessionId()).toBeNull();
  });

  it('is the NEW class, not the one before it', () => {
    const first = store.openSession({ source: 'class', topicRef: 'a' });
    store.closeSession({ activeMs: 1000, completed: true });
    const second = store.openSession({ source: 'class', topicRef: 'b' });

    expect(store.currentSessionId()).toBe(second);
    expect(store.currentSessionId()).not.toBe(first);
  });

  it('is nobody at all before the first class of an install', () => {
    expect(store.currentSessionId()).toBeNull();
  });
});
