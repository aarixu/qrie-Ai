import { batch, type LedgerEvent } from '@ai-tutor/ledger';
import { supabase } from './supabase';
import { track } from './telemetry';
import { forgetSent, ledgerOutbox } from '../stores/ledger';

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
let inFlight: Promise<DrainResult> | null = null;

export interface DrainResult {
  sent: number;
  pending: number;
  /** Set when nothing could be sent. The outbox is untouched in that case. */
  reason?: 'offline' | 'no-account' | 'no-org' | 'rejected';
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
function reportDropped(dropped: number): void {
  if (dropped <= droppedReported) return;
  droppedReported = dropped;
  track('ledger_dropped', { dropped });
}

async function resolveOrg(userId: string): Promise<string | null> {
  if (orgId) return orgId;
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
async function writeSessions(events: LedgerEvent[], userId: string, org: string): Promise<void> {
  const db = supabase();
  if (!db) return;

  const opened = events.filter((e) => e.kind === 'session-started');
  if (opened.length > 0) {
    await db.from('learning_session').upsert(
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
  }

  // Closing goes through the RPC rather than an update, because there is no
  // update policy on the table — append-only is enforced by its absence, and
  // ended_at/active_ms are the one legitimate exception.
  for (const e of events.filter((x) => x.kind === 'session-ended')) {
    const payload = e.payload as { activeMs?: number };
    await db.rpc('close_learning_session', {
      p_session: e.sessionId,
      p_ended_at: e.at,
      p_active_ms: Math.max(0, Math.round(payload.activeMs ?? 0)),
    });
  }
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
  reportDropped(dropped);
  if (pending === 0) return { sent: 0, pending: 0, dropped };

  const db = supabase();
  if (!db) return { sent: 0, pending, dropped, reason: 'offline' };

  const { data: auth } = await db.auth.getUser();
  const userId = auth?.user?.id;
  // No account yet is an ordinary state, not an error: the events wait. A class
  // must never block on sign-in.
  if (!userId) return { sent: 0, pending, dropped, reason: 'no-account' };

  const org = await resolveOrg(userId);
  if (!org) return { sent: 0, pending, dropped, reason: 'no-org' };

  const slice = batch(outbox, BATCH);
  try {
    await writeSessions(slice, userId, org);
    const { error } = await db
      .from('ledger_event')
      .upsert(slice.map((e) => rowOf(e, userId, org)), {
        onConflict: 'id',
        ignoreDuplicates: true,
      });
    if (error) return { sent: 0, pending, dropped, reason: 'rejected' };
  } catch {
    // A dead network mid-flush. The outbox is untouched, so the next drain
    // sends exactly this batch again.
    return { sent: 0, pending, dropped, reason: 'offline' };
  }

  forgetSent(slice.map((e) => e.id));
  return { sent: slice.length, pending: ledgerOutbox.get().pending.length, dropped };
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

  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', onVisible);
  flush();

  return () => {
    window.removeEventListener('online', flush);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** How many events are waiting, for anything that wants to show it. */
export const pendingCount = (): number => ledgerOutbox.get().pending.length;

/** Test seam: forget the cached organization. */
export function resetLedgerSync(): void {
  orgId = null;
  inFlight = null;
  droppedReported = 0;
}
