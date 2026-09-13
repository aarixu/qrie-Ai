import { batch, type LedgerEvent } from '@ai-tutor/ledger';
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
 * Two rules, and both are about not losing a student's evidence:
 *
 *   1. ACKNOWLEDGE ONLY AFTER A CONFIRMED WRITE. Optimistic acknowledgement is
 *      the single mistake here that destroys data permanently. A batch that was
 *      received but whose response was lost costs one harmless repeat; a batch
 *      that was acknowledged and never arrived is gone.
 *   2. REPLAY IS FREE. Event ids are minted on the device and are the table's
 *      primary key, so a repeat insert is a no-op rather than a duplicate
 *      answer inflating mastery.
 */

/** Big enough to clear a whole class in one request, small enough to retry. */
const BATCH = 200;

/**
 * The student's organization, resolved once per session in memory.
 *
 * Every account has exactly one today — a private "solo" org created by the
 * trigger in migration 0005 — so this is a single lookup rather than something
 * to thread through the app. The moment a student can belong to a school as
 * well, this becomes a choice and moves out of here.
 */
let orgId: string | null = null;
/**
 * WHICH user that org belongs to.
 *
 * Without this the cache is a trap rather than an optimisation: sign in as
 * somebody else and every drain is sent with the previous student's org, which
 * RLS refuses — silently, forever, until the page is reloaded.
 */
let orgUser: string | null = null;
let inFlight: Promise<DrainResult> | null = null;

export interface DrainResult {
  sent: number;
  pending: number;
  /** Set when nothing could be sent. The outbox is untouched in that case. */
  reason?: 'offline' | 'no-account' | 'no-org' | 'rejected';
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
 * Postgres classes 22 (data exception) and 23 (integrity violation) mean the
 * ROW is wrong, and it will be just as wrong in an hour. Everything else — an
 * expired token, an RLS refusal at 42501, a gateway hiccup, PostgREST's own
 * codes — is about the moment, and the event must be kept and retried.
 *
 * Getting this test wrong in the permissive direction would be far worse than
 * the bug it exists for: it would throw away a student's evidence every time
 * their token happened to expire mid-flush.
 */
const isMalformed = (code: unknown): boolean => typeof code === 'string' && /^(22|23)/.test(code);

async function resolveOrg(userId: string): Promise<string | null> {
  if (orgId && orgUser === userId) return orgId;
  const db = supabase();
  if (!db) return null;
  const { data, error } = await db
    .from('membership')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  orgId = (data as { org_id: string }).org_id;
  orgUser = userId;
  return orgId;
}

const rowOf = (e: LedgerEvent, userId: string, org: string) => ({
  id: e.id,
  org_id: org,
  user_id: userId,
  session_id: e.sessionId,
  seq: e.seq,
  at: e.at,
  kind: e.kind,
  source: e.source,
  surface: e.surface,
  outcome_ids: e.outcomeIds,
  topic_ref: e.topicRef ?? null,
  payload: e.payload,
});

/**
 * Write the sitting itself, from the events that describe it.
 *
 * The session row is derivable from `session-started` and `session-ended`, so
 * nothing extra is queued for it. Doing it this way means a session that opened
 * on a plane and closed on the ground still lands complete and in order.
 */
async function writeSessions(
  events: LedgerEvent[],
  userId: string,
  org: string,
): Promise<Set<string>> {
  /**
   * Event ids that must NOT be acknowledged this drain.
   *
   * Both writes below used to be awaited and their errors dropped on the
   * floor, after which the events were acknowledged anyway. A transient
   * failure on either one therefore lost the sitting — and `active_ms` with
   * it, which is the DENOMINATOR of the one metric this whole system exists
   * to optimise. Holding the event back instead costs one harmless repeat:
   * the row is keyed on the client-minted id, so re-sending it is a no-op.
   */
  const held = new Set<string>();
  const db = supabase();
  if (!db) return held;

  const opened = events.filter((e) => e.kind === 'session-started');
  if (opened.length > 0) {
    const { error } = await db.from('learning_session').upsert(
      opened.map((e) => ({
        id: e.sessionId,
        org_id: org,
        user_id: userId,
        source: e.source,
        topic_ref: e.topicRef ?? null,
        started_at: e.at,
      })),
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (error) for (const e of opened) held.add(e.id);
  }

  // Closing goes through the RPC rather than an update, because there is no
  // update policy on the table — append-only is enforced by its absence, and
  // ended_at/active_ms are the one legitimate exception.
  for (const e of events.filter((x) => x.kind === 'session-ended')) {
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

  const org = await resolveOrg(userId);
  if (!org) return { sent: 0, pending, dropped, refused: 0, reason: 'no-org' };

  const slice = batch(ledgerOutbox.get(), BATCH);
  let outcome: SendOutcome;
  let held: Set<string>;
  try {
    held = await writeSessions(slice, userId, org);
    outcome = await send(db, slice, userId, org);
  } catch {
    // A dead network mid-flush. The outbox is untouched, so the next drain
    // sends exactly this batch again.
    return { sent: 0, pending, dropped, refused: 0, reason: 'offline' };
  }

  if (outcome.kind === 'transient') {
    // Keep everything. The token expires, RLS says no while the org is still
    // being provisioned, a gateway blips — all of them pass.
    return { sent: 0, pending, dropped, refused: 0, reason: 'rejected' };
  }

  // Everything that landed, EXCEPT the events whose sitting could not be
  // written or closed. Those stay queued and are sent again; the ledger row
  // itself is already there and the repeat is a no-op.
  const acknowledged = outcome.ok.filter((id) => !held.has(id));
  forgetSent(acknowledged);
  if (outcome.poison.length > 0) {
    forgetRefused(outcome.poison);
    // Loudly. A malformed event is OUR bug, and the whole reason this path
    // exists is that the last one was silent for as long as it took to measure
    // a class by hand. No student data goes with it — a count and a code.
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
  | { kind: 'settled'; ok: string[]; poison: string[]; code?: string };

/**
 * Send a slice, and if the server refuses it, find out which rows it is
 * actually refusing.
 *
 * A batch goes as ONE statement, so a single malformed row fails all two
 * hundred. Left there, the outbox is untouched, the next drain sends the same
 * batch, and that device never writes another event as long as it is
 * installed. That is not a hypothetical: the event opening every session
 * carried an id of `<uuid>:0` against a `uuid` column, so this was the
 * behaviour in production and 2,472 green tests had nothing to say about it.
 *
 * So a refusal is bisected rather than retried. Halves that write are kept;
 * a row still refused alone is refused permanently and is quarantined. Cost on
 * the healthy path: nothing, one request. Cost with one bad row in two
 * hundred: about sixteen requests, once, and then the queue moves again.
 */
async function send(
  db: NonNullable<ReturnType<typeof supabase>>,
  rows: LedgerEvent[],
  userId: string,
  org: string,
): Promise<SendOutcome> {
  const { error } = await db
    .from('ledger_event')
    .upsert(rows.map((e) => rowOf(e, userId, org)), {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  if (!error) return { kind: 'settled', ok: rows.map((e) => e.id), poison: [] };
  if (!isMalformed((error as { code?: string }).code)) return { kind: 'transient' };
  if (rows.length === 1) {
    return { kind: 'settled', ok: [], poison: [rows[0].id], code: (error as { code?: string }).code };
  }

  const mid = Math.floor(rows.length / 2);
  const left = await send(db, rows.slice(0, mid), userId, org);
  const right = await send(db, rows.slice(mid), userId, org);
  // If either half turned out to be a passing problem after all, the whole
  // slice is treated as one — better to retry good rows than to bin them.
  if (left.kind === 'transient' || right.kind === 'transient') return { kind: 'transient' };
  return {
    kind: 'settled',
    ok: [...left.ok, ...right.ok],
    poison: [...left.poison, ...right.poison],
    code: left.code ?? right.code,
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

/** Test seam: forget the cached organization. */
export function resetLedgerSync(): void {
  orgId = null;
  orgUser = null;
  inFlight = null;
  droppedReported = 0;
}
