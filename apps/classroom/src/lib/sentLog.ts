import type { LedgerEvent } from '@ai-tutor/ledger';
import { createLocalStore } from '../stores/localStore';

/**
 * WHAT THE SERVER TOOK THAT ITS BRAIN MAY NOT HAVE READ YET (lam-one-brain
 * Task 11, review SF4).
 *
 * The outbox forgets an event once the server acknowledges it. But the
 * brain (packages/lms-brain think.ts) folds the ledger into the learner's
 * model only when it runs, so for a while an acknowledged event is in the
 * ledger and not in the model the tutor reads back. Each one is kept here
 * with the received_at record_evidence answered for it (0107), so the model
 * store can fold it on top of the server's model until the brain's cursor
 * passes it (learnerModel.ts `refreshFromServer`), and is let go then.
 *
 * Kept on this device only (`neverSync`), for the learner who sent it
 * (`owner`); a device handed to someone else is wiped with every other store
 * (stores/localStore.ts `handOverDevice`). At most SENT_CAP events, the oldest
 * let go first: while the brain is not running, an event let go is in neither
 * the server's model nor here, and the model store keeps its own model when
 * the server's comes up short of it on any outcome (learnerModel.ts
 * `coversDevice`). An acknowledgement with no received_at is not kept.
 */
export interface SentEntry {
  event: LedgerEvent;
  receivedAt: string;
}

export interface SentLog {
  owner: string | null;
  entries: SentEntry[];
}

export const SENT_CAP = 500;

const sentStore = createLocalStore<SentLog>('ai-tutor:ledger-sent', { owner: null, entries: [] }, { neverSync: true });

/** The events `owner` sent that are kept here; none when the log is someone else's. */
export function sentFor(owner: string): SentEntry[] {
  const log = sentStore.get();
  return log.owner === owner ? log.entries : [];
}

/** The server acknowledged these for `owner`, at these receipts. */
export function rememberSent(owner: string, sent: readonly SentEntry[]): void {
  if (sent.length === 0) return;
  const log = sentStore.get();
  const kept = log.owner === owner ? log.entries : [];
  const known = new Set(kept.map((e) => e.event.id));
  const entries = [...kept, ...sent.filter((e) => !known.has(e.event.id))];
  sentStore.set({ owner, entries: entries.slice(-SENT_CAP) });
}

/** The brain has read these: they need not be kept. */
export function forgetHeld(owner: string, ids: readonly string[]): void {
  const log = sentStore.get();
  if (log.owner !== owner || ids.length === 0) return;
  const held = new Set(ids);
  sentStore.set({ owner, entries: log.entries.filter((e) => !held.has(e.event.id)) });
}

/** Test seam. */
export function resetSentLog(): void {
  sentStore.set({ owner: null, entries: [] });
}
