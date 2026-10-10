import { batch, type LedgerEvent } from '@ai-tutor/ledger';
import { rememberSent } from './sentLog';
import { onAccountChange, supabase } from './supabase';
import { track } from './telemetry';
import { claimOutbox, forgetRefused, forgetSent, ledgerOutbox } from '../stores/ledger';

/**
 * DRAINING THE OUTBOX.
 *
 * The one piece of the ledger that does I/O, kept apart from the package and
 * from the store for the same reason every external dependency in this repo
 * sits behind an adapter.
 *
 * Everything goes through one server function, public.record_evidence
 * (0107). It decides who the learner is and which org their evidence belongs
 * to from the token, stamps the server's clock, and answers every event on its
 * own: recorded, duplicate, or refused with a reason. Nothing here names an
 * org or a user.
 *
 * Two rules, and both are about not losing a student's evidence:
 *
 *   1. ACKNOWLEDGE ONLY AFTER A CONFIRMED WRITE. Optimistic acknowledgement is
 *      the single mistake here that destroys data permanently. A batch that was
 *      received but whose response was lost costs one harmless repeat; a batch
 *      that was acknowledged and never arrived is gone.
 *   2. REPLAY IS FREE. Event ids are minted on the device and are the table's
 *      primary key, so a repeat comes back 'duplicate' rather than as a second
 *      answer inflating mastery.
 */

/** Big enough to clear a whole class in one request, small enough to retry. */
const BATCH = 200;

let inFlight: Promise<DrainResult> | null = null;

export interface DrainResult {
  sent: number;
  pending: number;
  /** Set when nothing could be sent. The outbox is untouched in that case. */
  reason?: 'offline' | 'no-account' | 'rejected';
  /**
   * How many events the server refused outright this drain.
   *
   * Distinct from `dropped`: that is this device overflowing, this is us
   * having written an event Postgres will never accept.
   */
  refused: number;
  /**
   * How many events this device has discarded to the cap, ever.
   *
   * Carried out of the drain because losing events is bad and losing them
   * QUIETLY is worse. A learner model rebuilt from a ledger with a non-zero
   * count here is reading an incomplete story, and it should be possible to
   * know that rather than to wonder.
   */
  dropped: number;
}

/**
 * Reported once per session, and only when it is not zero.
 *
 * A counter nothing ever reads is a counter that does not exist. This is the
 * one number that says "the record you are about to trust has holes in it", and
 * it costs one event with no student data in it at all.
 */
let droppedReported = 0;
let orphanedReported = 0;
function reportLoss(dropped: number, orphaned: number): void {
  if (dropped <= droppedReported && orphaned <= orphanedReported) return;
  droppedReported = Math.max(droppedReported, dropped);
  orphanedReported = Math.max(orphanedReported, orphaned);
  // `orphaned` rides along rather than getting its own event because it
  // answers the same question — how holed is this record — and because a
  // counter nothing ever reads is a counter that does not exist. Unlike
  // `dropped` it should never move at all: it counts events recorded when no
  // sitting was open to hold them, which the classroom now makes impossible by
  // reopening one first. A non-zero value is a bug in us, not a busy student.
  track('ledger_dropped', { dropped, orphaned });
}

/**
 * The sittings these events open, as record_evidence reads them. The session
 * row is derivable from `session-started`, so nothing extra is queued for it;
 * the function makes the row when the first event that needs it arrives, so a
 * session that opened on a plane and closed on the ground still lands.
 */
const sittingsOf = (events: readonly LedgerEvent[]) =>
  events
    .filter((e) => e.kind === 'session-started')
    .map((e) => ({ id: e.sessionId, source: e.source, topicRef: e.topicRef ?? null, startedAt: e.at }));

/**
 * Close the sittings whose `session-ended` event the server now holds.
 * Returns the ids of those events that must NOT be acknowledged this drain.
 *
 * Closing goes through the RPC rather than an update, because a phone may not
 * update the table: there is no update policy, and since 0110 no update grant
 * either. ended_at/active_ms are the one legitimate exception. It runs after
 * record_evidence because a close of a sitting the server has no row for
 * closes nothing.
 *
 * This write used to be awaited and its error dropped on the floor, after
 * which the event was acknowledged anyway. A transient failure therefore lost
 * the sitting's `active_ms`, which is the DENOMINATOR of the one metric this
 * whole system exists to optimise. Holding the event back instead costs one
 * harmless repeat: the server answers it 'duplicate', and a close of a sitting
 * already closed is a no-op.
 */
async function closeSittings(
  db: NonNullable<ReturnType<typeof supabase>>,
  events: readonly LedgerEvent[],
  landed: ReadonlySet<string>,
): Promise<Set<string>> {
  const held = new Set<string>();
  for (const e of events.filter((x) => x.kind === 'session-ended' && landed.has(x.id))) {
    const payload = e.payload as { activeMs?: number };
    const { error } = await db.rpc('close_learning_session', {
      p_session: e.sessionId,
      p_ended_at: e.at,
      p_active_ms: Math.max(0, Math.round(payload.activeMs ?? 0)),
    });
    if (error) held.add(e.id);
  }
  return held;
}

export async function drainLedger(): Promise<DrainResult> {
  // One drain at a time. Two concurrent flushes would each send the same batch
  // and then both acknowledge it — harmless server-side thanks to the id, but
  // it would double the requests for no reason.
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<DrainResult> {
  const outbox = ledgerOutbox.get();
  const pending = outbox.pending.length;
  const dropped = outbox.dropped;
  reportLoss(dropped, outbox.orphaned);
  if (pending === 0) return { sent: 0, pending: 0, dropped, refused: 0 };

  const db = supabase();
  if (!db) return { sent: 0, pending, dropped, refused: 0, reason: 'offline' };

  const { data: auth } = await db.auth.getUser();
  const userId = auth?.user?.id;
  // No account yet is an ordinary state, not an error: the events wait. A class
  // must never block on sign-in.
  if (!userId) return { sent: 0, pending, dropped, refused: 0, reason: 'no-account' };

  // Whose queue is this? On a shared phone, or after 'Delete your account'
  // (which signs out and leaves the queue standing), the events waiting here
  // may belong to the person who used it before — and the row this drain
  // writes stamps whoever is signed in NOW.
  const handedOver = claimOutbox(userId);
  if (handedOver > 0) {
    track('ledger_handover', { discarded: handedOver });
    return { sent: 0, pending: 0, dropped, refused: 0 };
  }

  const slice = batch(ledgerOutbox.get(), BATCH);
  let outcome: SendOutcome;
  let held: Set<string>;
  try {
    outcome = await send(db, slice);
    held = outcome.kind === 'settled' ? await closeSittings(db, slice, new Set(outcome.ok)) : new Set();
  } catch {
    // A dead network mid-flush. The outbox is untouched, so the next drain
    // sends exactly this batch again.
    return { sent: 0, pending, dropped, refused: 0, reason: 'offline' };
  }

  if (outcome.kind === 'transient') {
    // Keep everything. The token expires, the org is still being provisioned,
    // a gateway blips — all of them pass.
    return { sent: 0, pending, dropped, refused: 0, reason: 'rejected' };
  }

  // Everything that landed, EXCEPT the closing events whose sitting could not
  // be closed. Those stay queued and are sent again; the ledger row itself is
  // already there and the repeat comes back 'duplicate'. An event the server
  // gave no answer for is neither, and stays queued too.
  const acknowledged = outcome.ok.filter((id) => !held.has(id));
  // Kept, with their receipts, until the brain has read them (sentLog.ts):
  // before the outbox lets them go, so no event is in neither.
  const done = new Set(acknowledged);
  rememberSent(
    userId,
    slice
      .filter((e) => done.has(e.id) && outcome.receipts.has(e.id))
      .map((event) => ({ event, receivedAt: outcome.receipts.get(event.id)! })),
  );
  forgetSent(acknowledged);
  if (outcome.poison.length > 0) {
    forgetRefused(outcome.poison);
    // Loudly. A refused event is OUR bug, and the whole reason this path
    // exists is that the last one was silent for as long as it took to measure
    // a class by hand. No student data goes with it — a count and the first
    // refusal's reason.
    track('ledger_refused', { refused: outcome.poison.length, code: outcome.code ?? 'unknown' });
  }
  return {
    sent: acknowledged.length,
    pending: ledgerOutbox.get().pending.length,
    dropped,
    refused: outcome.poison.length,
  };
}

type SendOutcome =
  | { kind: 'transient' }
  | { kind: 'settled'; ok: string[]; poison: string[]; code?: string; receipts: Map<string, string> };

/**
 * record_evidence's answer for one event (0107). `received_at` is when the
 * server received it — for a duplicate, the first time — and null for a
 * refused one.
 */
interface EventAnswer {
  id: string;
  status: 'recorded' | 'duplicate' | 'refused';
  reason: string | null;
  received_at?: string | null;
}

/**
 * Send a slice through record_evidence, and sort its answer.
 *
 * The drain used to be one insert of the whole slice, so a single malformed
 * row failed all two hundred, and the next drain sent the same batch: that
 * device never wrote another event as long as it was installed. That is not a
 * hypothetical: the event opening every session carried an id of `<uuid>:0`
 * against a `uuid` column, so this was the behaviour in production and 2,472
 * green tests had nothing to say about it. The function answers each event on
 * its own, so a refused event is quarantined and the rest are acknowledged in
 * the same request.
 *
 * An error on the call itself is never about one event: an expired token, no
 * org yet (42501), a gateway, or a call it could not read (22023). All of them
 * keep the whole slice — throwing away a student's evidence because their
 * token expired mid-flush would be far worse than one more retry.
 */
async function send(db: NonNullable<ReturnType<typeof supabase>>, events: LedgerEvent[]): Promise<SendOutcome> {
  const { data, error } = await db.rpc('record_evidence', {
    p_sessions: sittingsOf(events),
    p_events: events,
  });
  if (error || !Array.isArray(data)) return { kind: 'transient' };
  const answers = data as EventAnswer[];
  const refused = answers.filter((a) => a.status === 'refused');
  const ok = answers.filter((a) => a.status === 'recorded' || a.status === 'duplicate');
  return {
    kind: 'settled',
    ok: ok.map((a) => a.id),
    poison: refused.map((a) => a.id),
    code: refused[0]?.reason ?? undefined,
    receipts: new Map(ok.filter((a) => typeof a.received_at === 'string').map((a) => [a.id, a.received_at as string])),
  };
}

/**
 * Drain on the moments a phone actually has signal: when the app comes back to
 * the foreground, and when the browser says the network returned. Returns a
 * detach function, in the shape App.tsx already uses for startAccountSync.
 */
export function startLedgerDrain(): () => void {
  const flush = (): void => {
    void drainLedger();
  };
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') flush();
  };

  /**
   * WHO THIS DEVICE BELONGS TO NOW.
   *
   * Ownership is settled the moment the identity changes rather than the next
   * time there is something to send, and that ordering is the whole point: a
   * student who signs in on a school tablet and only then starts a class would
   * otherwise have their OWN first class discarded, because the queue would
   * still be recorded as the previous occupant's when it finally drained.
   *
   * The drain keeps its own claim as a backstop — this listener does not exist
   * when the project is unconfigured, and the rule has to hold either way.
   */
  const detachAccount = onAccountChange((account) => {
    if (account) {
      const handedOver = claimOutbox(account.id);
      if (handedOver > 0) track('ledger_handover', { discarded: handedOver });
    }
    flush();
  });

  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', onVisible);
  flush();

  return () => {
    detachAccount();
    window.removeEventListener('online', flush);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** How many events are waiting, for anything that wants to show it. */
export const pendingCount = (): number => ledgerOutbox.get().pending.length;

/** Test seam: forget the drain in flight and what has been reported. */
export function resetLedgerSync(): void {
  inFlight = null;
  droppedReported = 0;
}
