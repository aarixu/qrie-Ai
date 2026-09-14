import { useSyncExternalStore } from 'react';
import {
  acknowledge,
  claim,
  emptyOutbox,
  quarantine,
  endSession,
  record,
  recordAnswer,
  recordReflection,
  startSession,
  type AnswerInput,
  type EndSessionInput,
  type Outbox,
  type RecordInput,
  type ReflectionInput,
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

import { recordLocally } from '../lib/learnerModel';

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
          rejected: parsed.rejected ?? 0,
          orphaned: parsed.orphaned ?? 0,
          ownerId: parsed.ownerId ?? null,
        }
      : emptyOutbox();
  } catch {
    cache = emptyOutbox();
  }
  return cache;
}

/**
 * BELIEF IS FOLDED WHERE THE EVENT IS RECORDED, AND NOWHERE ELSE.
 *
 * One call site rather than a second pass somewhere else, because two would
 * eventually disagree about what happened and the disagreement would be
 * invisible — the record saying one thing and the model another, with nothing
 * to say which was right.
 *
 * Only APPENDED events are folded. A drain removes acknowledged rows and hands
 * this the same outbox minus them; nothing there is new, so nothing is folded
 * twice. `foldSession`'s cursor would catch a repeat anyway, and this is the
 * cheaper half of that guarantee.
 *
 * It never throws into the caller. A class in progress must not stop because a
 * derived cache could not be updated: the ledger is the record, this is a view
 * of it, and a view can always be rebuilt.
 */
function foldAppended(prev: Outbox, next: Outbox): void {
  const session = next.session;
  if (!session) return;
  const had = new Set(prev.pending.map((e) => e.id));
  const fresh = next.pending.filter((e) => !had.has(e.id));
  if (fresh.length === 0) return;
  try {
    recordLocally(session, fresh);
  } catch {
    // Deliberately swallowed. See above.
  }
}

function write(next: Outbox): void {
  const prev = cache;
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota or a locked-down WebView. The in-memory copy still drains this
    // session, which is the common case; what is lost is only a reload. Every
    // other store here makes the same trade rather than crashing a class.
  }
  if (prev !== null) foldAppended(prev, next);
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
const mint = (): string => {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // A v4 uuid by hand, because the FALLBACK has to be one too.
  //
  // `crypto.randomUUID` exists only in a secure context, and http-on-a-LAN is
  // exactly how this gets opened on a school tablet or a phone pointed at a
  // dev laptop. The fallback here used to mint `l3k2j1-a8f92bc1`, which
  // `ledger_event.id` and `session_id` — both `uuid` columns — refuse with
  // 22P02, so every event such a device recorded would have been rejected for
  // the life of the install, and the drain would have retried it forever.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
};

const now = (): string => new Date().toISOString();

export function openSession(input: Omit<StartSessionInput, 'id' | 'eventId' | 'at'>): string {
  const id = mint();
  // Two ids, deliberately: the sitting's, and the opening event's own. They
  // used to be one, with `:0` glued on — see StartSessionInput for what that
  // cost.
  write(startSession(read(), { ...input, id, eventId: mint(), at: now() }));
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

export function logReflection(input: Omit<ReflectionInput, 'id' | 'at'>): void {
  write(recordReflection(read(), { ...input, id: mint(), at: now() }));
}

/**
 * The sitting in progress, for the relay's usage record.
 *
 * Every model call, spoken line and transcription made during a class is
 * stamped with this on the server, which is what lets "cost per class" and
 * "cost per student-hour" be computed from real rows instead of estimated.
 * Null outside a session, which is ordinary: a call from the Home screen
 * belongs to no sitting.
 */
export const currentSessionId = (): string | null => {
  const session = read().session;
  // ENDED IS NOT OPEN. `endSession` keeps the session object so the sitting it
  // describes can still be read, and this used to hand that id out forever
  // after: on a device's second cold class, every preparation call was stamped
  // with the PREVIOUS class's session. `session_cost` then reported one
  // sitting carrying another sitting's ten rupees of prep, and
  // `cost_per_student_hour` divided one session's spend by a different
  // session's time on task — so the prep/play split this product prices a
  // credit from was not reproducible from the app that earns it.
  return session && !session.endedAt ? session.id : null;
};

/** Called by the drain, and only after the server has confirmed the write. */
export function forgetSent(ids: readonly string[]): void {
  write(acknowledge(read(), ids));
}

/**
 * Called by the drain before it sends anything: whose queue is this?
 *
 * Returns how many events belonged to a previous occupant of this device and
 * were therefore discarded rather than uploaded under the wrong name.
 */
export function claimOutbox(userId: string): number {
  const { outbox, handedOver } = claim(read(), userId);
  if (handedOver > 0 || outbox !== read()) write(outbox);
  return handedOver;
}

/**
 * Called by the drain for events the server will never accept.
 *
 * Unlike forgetSent, these are discarded WITHOUT having been stored — see
 * `quarantine` in the package for why that is nonetheless the right call.
 */
export function forgetRefused(ids: readonly string[]): void {
  write(quarantine(read(), ids));
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
