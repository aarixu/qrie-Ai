import { flagStore, UNKNOWN_OWNER } from '../stores/flags';
import { createLocalStore, type Store } from '../stores/localStore';
import { relayFetch } from './relay';
import { accountFromStoredSession, type WhoIsHere } from './supabase';
import { mayPersist as workspaceMayPersist } from './workspace';
import { isNative } from './platform';

/**
 * EACH DISTRESS FLAG GOES TO THE SERVER, AND THE WORDS STAY BEHIND. (Plan 5.)
 *
 * The safety screen (lib/safety.ts) records a 'distress' flag in the local
 * flag log (stores/flags.ts) when a child's words, or the tutor's own line,
 * read as distress. Until this module, nothing about it left the phone, so
 * nobody could know a child at a school might need help. This module watches
 * the log and sends each NEW distress flag to the relay's /api/flag
 * (packages/relay/src/safetyFlag.ts), which keeps it in admin.safety_event.
 *
 * WHAT TRAVELS: a fresh id, the category 'distress', whose words matched
 * (from-student or to-student), the time the screen flagged it, the platform
 * and the build. SafetyFlagBody has no field for words, a lesson or a
 * session, and the relay refuses a body that carries any other key.
 *
 * NOT DURING A TRIAL. A /try child is promised that nothing about them is
 * kept, so while `mayPersist()` is false nothing is queued or sent (ruling R4
 * of the plan; Aarav decides whether that changes).
 *
 * A FLAG THAT CANNOT GO NOW WAITS, under the child it belongs to, with the
 * same three owner answers a kept report has (stores/flags.ts, PendingReport):
 * a user id, null for nobody signed in, or UNKNOWN_OWNER when the stored
 * session could not be read. At most MAX_WAITING wait; the oldest go first
 * when more arrive. The queue is drained when the capture starts (every app
 * open) and after each new flag.
 */

export interface SafetyFlagBody {
  id: string;
  category: 'distress';
  direction: 'from-student' | 'to-student';
  at: string;
  platform: 'web' | 'android';
  release: string;
}

export interface Waiting {
  flag: SafetyFlagBody;
  /** The user id from the stored session; null for nobody; UNKNOWN_OWNER when it could not be read. */
  owner: string | null;
}

export const MAX_WAITING = 20;

/** Never synced: a list of a child's distress moments does not go to student_state. */
export const captureStore: Store<{ waiting: Waiting[] }> = createLocalStore<{ waiting: Waiting[] }>(
  'distress-capture',
  { waiting: [] },
  { neverSync: true },
);

export type SendOutcome = 'sent' | 'kept' | 'refused';

/** Stamped on each flag so the server knows which build sent it, as the report sheet does. */
const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined) || 'dev';

/** The relay's verdicts on the body itself: the same bytes get the same answer every time. */
const PERMANENT = new Set([400, 405, 413]);

export async function sendDistress(flag: SafetyFlagBody, fetchImpl: typeof relayFetch = relayFetch): Promise<SendOutcome> {
  try {
    const res = await fetchImpl('/api/flag', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(flag),
    });
    if (res.ok) return 'sent';
    return PERMANENT.has(res.status) ? 'refused' : 'kept';
  } catch {
    return 'kept';
  }
}

const forget = (id: string): void => {
  captureStore.update((s) => ({ waiting: s.waiting.filter((w) => w.flag.id !== id) }));
};

/**
 * Send what is waiting. `who` is who is signed in now:
 *   - a flag whose owner could not be read waits;
 *   - a flag of a named child waits while nobody, or nobody we can tell, is
 *     here, and is discarded when a DIFFERENT child is here (it must not go
 *     under another child's sign-in, which would name the wrong school);
 *   - a flag with no owner, or this child's own, is sent.
 * 'sent' and 'refused' leave the queue; 'kept' waits for the next drain.
 */
export async function drainDistress(
  who: WhoIsHere,
  send: typeof sendDistress = sendDistress,
): Promise<{ sent: number; discarded: number }> {
  const here = who.known ? (who.account?.id ?? null) : undefined;
  let sent = 0;
  let discarded = 0;
  for (const w of [...captureStore.get().waiting]) {
    if (w.owner === UNKNOWN_OWNER) continue;
    if (w.owner !== null) {
      if (here === undefined || here === null) continue;
      if (w.owner !== here) {
        forget(w.flag.id);
        discarded += 1;
        continue;
      }
    }
    let outcome: SendOutcome;
    try {
      outcome = await send(w.flag);
    } catch {
      outcome = 'kept';
    }
    if (outcome === 'kept') continue;
    forget(w.flag.id);
    if (outcome === 'sent') sent += 1;
  }
  return { sent, discarded };
}

export interface CaptureDeps {
  send?: typeof sendDistress;
  /** Default: accountFromStoredSession (no network). */
  whoIsHere?: () => Promise<WhoIsHere>;
  /** Default: lib/workspace mayPersist (false during a trial). */
  mayPersist?: () => boolean;
  /** Default: crypto.randomUUID. */
  newId?: () => string;
  /** Default: 'android' inside the native shell, else 'web'. */
  platform?: () => 'web' | 'android';
  /** Default: VITE_RELEASE, or 'dev'. */
  release?: string;
}

/** Subscribes to flagStore; returns the unsubscribe. Flags already in the log when it starts are not sent. */
export function startDistressCapture(deps: CaptureDeps = {}): () => void {
  const send = deps.send ?? sendDistress;
  const whoIsHere = deps.whoIsHere ?? accountFromStoredSession;
  const persist = deps.mayPersist ?? workspaceMayPersist;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const platformOf = deps.platform ?? ((): 'web' | 'android' => (isNative() ? 'android' : 'web'));
  const release = deps.release ?? RELEASE;
  const ask = (): Promise<WhoIsHere> => whoIsHere().catch((): WhoIsHere => ({ known: false }));

  // One task at a time, so a drain never races another drain into a double send.
  let chain: Promise<unknown> = Promise.resolve();
  const run = (task: () => Promise<unknown>): void => {
    chain = chain.then(task).catch(() => undefined);
  };

  const seen = new Set(flagStore.get().flags.filter((f) => f.kind === 'distress').map((f) => f.at));

  const onChange = (): void => {
    const fresh = flagStore.get().flags.filter((f) => f.kind === 'distress' && !seen.has(f.at));
    if (fresh.length === 0) return;
    for (const f of fresh) seen.add(f.at);
    if (!persist()) return;
    // The log is newest first; the queue is oldest first.
    const bodies: SafetyFlagBody[] = fresh.reverse().map((f) => ({
      id: newId(),
      category: 'distress',
      direction: f.direction ?? 'from-student',
      at: f.at,
      platform: platformOf(),
      release,
    }));
    run(async () => {
      const who = await ask();
      const owner = who.known ? (who.account?.id ?? null) : UNKNOWN_OWNER;
      captureStore.update((s) => ({
        waiting: [...s.waiting, ...bodies.map((flag) => ({ flag, owner }))].slice(-MAX_WAITING),
      }));
      await drainDistress(who, send);
    });
  };

  const unsubscribe = flagStore.subscribe(onChange);
  // A flag queued on an earlier open, while offline.
  if (persist()) run(async () => drainDistress(await ask(), send));
  return unsubscribe;
}
