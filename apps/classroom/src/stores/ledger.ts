import { useSyncExternalStore } from 'react';
import {
  acknowledge,
  emptyOutbox,
  endSession,
  record,
  recordAnswer,
  startSession,
  type AnswerInput,
  type EndSessionInput,
  type Outbox,
  type RecordInput,
  type StartSessionInput,
} from '@ai-tutor/ledger';

/**
 * THE OUTBOX ON THIS DEVICE.
 *
 * Deliberately NOT built on createLocalStore, and that is the whole point of
 * this file existing separately.
 *
 * createLocalStore registers itself into the map lib/sync.ts walks, and that
 * sync is last-write-wins on a WHOLE BLOB per key. For notes or preferences
 * that is fine. For an append-only queue it is ruinous: a student who answers
 * questions on a phone and a laptop would have one device's entire outbox
 * replace the other's, silently, exactly as quiz attempts are lost today. The
 * ledger is the thing that replaces that design; it must not be carried by it.
 *
 * So this store persists locally and is drained by lib/ledgerSync.ts, which
 * appends rather than overwrites.
 */

const KEY = 'ai-tutor:ledger-outbox';

let cache: Outbox | null = null;
const listeners = new Set<() => void>();

function read(): Outbox {
  if (cache !== null) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    // A stored shape from an older build is loaded as-is, like every other
    // store here. The fields this file writes are all optional-safe: a missing
    // `dropped` reads as undefined and is normalised below rather than
    // crashing a class that is already running.
    const parsed = raw !== null ? (JSON.parse(raw) as Partial<Outbox>) : null;
    cache = parsed
      ? {
          session: parsed.session ?? null,
          nextSeq: parsed.nextSeq ?? 0,
          pending: parsed.pending ?? [],
          dropped: parsed.dropped ?? 0,
        }
      : emptyOutbox();
  } catch {
    cache = emptyOutbox();
  }
  return cache;
}

function write(next: Outbox): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota or a locked-down WebView. The in-memory copy still drains this
    // session, which is the common case; what is lost is only a reload. Every
    // other store here makes the same trade rather than crashing a class.
  }
  for (const cb of [...listeners]) cb();
}

export const ledgerOutbox = {
  get: read,
  set: write,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};

export function useLedgerOutbox(): Outbox {
  return useSyncExternalStore(ledgerOutbox.subscribe, read, read);
}

/**
 * Ids and timestamps are minted HERE rather than in the package, because a
 * package that read a clock could not be replayed in a test.
 */
const mint = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const now = (): string => new Date().toISOString();

export function openSession(input: Omit<StartSessionInput, 'id' | 'at'>): string {
  const id = mint();
  write(startSession(read(), { ...input, id, at: now() }));
  return id;
}

export function closeSession(input: Omit<EndSessionInput, 'id' | 'at'>): void {
  write(endSession(read(), { ...input, id: mint(), at: now() }));
}

export function logEvent(input: Omit<RecordInput, 'id' | 'at'>): void {
  write(record(read(), { ...input, id: mint(), at: now() }));
}

export function logAnswer(input: Omit<AnswerInput, 'id' | 'at'>): void {
  write(recordAnswer(read(), { ...input, id: mint(), at: now() }));
}

/** Called by the drain, and only after the server has confirmed the write. */
export function forgetSent(ids: readonly string[]): void {
  write(acknowledge(read(), ids));
}

/** Test seam. */
export function resetLedgerOutbox(): void {
  cache = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
