import { fail, type RelayRequest, type RelayResponse } from './relays.ts';
import { admitFree } from './gate.ts';
import type { HandlerDeps } from './handler.ts';

/**
 * THE PREP LOCK, WIRED. 0017 shipped take_prep_lock and release_prep_lock
 * live in Postgres with no caller; these routes are the caller's side of the
 * wire. THE CLIENT WIRING IS WAVE 3'S — liveClass.ts does not take this lock
 * yet, so until that lands the lock still protects nothing in the product.
 * That is a named gap, not an oversight: the routes and the contract have to
 * exist first for Wave 3 to code against.
 *
 * THE CONTRACT, exactly:
 *
 *   POST /api/prep/lock     { topicRef }
 *     -> 200 { granted: boolean, reason?: 'held'|'busy',
 *              holder?: string, expiresAt?: string, running: number }
 *   POST /api/prep/renew    { topicRef }
 *     -> 200 { renewed: boolean }
 *   POST /api/prep/release  { topicRef }
 *     -> 200 { released: boolean }
 *   GET  /api/prep/state?topicRefs=a/b/c,d/e/f   (comma-separated, <= 50)
 *     -> 200 { states: { [topicRef]: 'ready'|'preparing'|'absent' } }
 *
 * All four are metered at zero units and still walk through admit — no
 * vendor is paid by a lock, but an identity and the per-minute window are
 * what keep a loop from hammering Postgres. The key is ALWAYS the topicRef,
 * never a derived class id: two students reaching one topic by different
 * derivations must take ONE lock (0017's header owns that argument).
 *
 * WHY THERE IS A RENEW. The TTL is 180 seconds against a preparation
 * measured at ninety-six — on a DEVELOPMENT MACHINE. The stated device is a
 * cheap Android, and a preparation that runs past the TTL loses its lock
 * silently: the next take sweeps the expired row, a second student wins it,
 * and both preparations run and both are paid for in full — the exact
 * N-1-wasted failure 0017 exists to prevent, arriving on the slow phone
 * where it costs most. A holder that heartbeats cannot be mistaken for a
 * dead one. WAVE 3 MUST CALL IT: renew every 60 seconds while preparing,
 * and a `false` means the lock is gone — stop and wait for the winner's
 * class rather than paying for a twin.
 */

export type PrepTopicState = 'ready' | 'preparing' | 'absent';

/** What the lock says back. Field for field what take_prep_lock returns. */
export interface PrepLockAnswer {
  granted: boolean;
  /** 'held': somebody is preparing this topic — wait for their class.
   *  'busy': the project is at its concurrency ceiling — turned away. */
  reason?: 'held' | 'busy';
  holder?: string;
  expiresAt?: string;
  running: number;
}

/**
 * The lock store, pluggable like the ledger and for the same reason. Every
 * method answers null when its backing store is unreachable, and the route
 * turns null into a 503 — FAIL CLOSED, because a lock that disappears in an
 * outage is N preparations paid for at exactly the moment nobody is looking.
 */
export interface PrepLocks {
  take(topicRef: string, userId: string): Promise<PrepLockAnswer | null>;
  /**
   * Push the holder's deadline out by another TTL. HOLDER ONLY — a student
   * who lost the race must not be able to extend the winner's lock, and a
   * renew that matches nothing answers false rather than raising: by the
   * time a slow phone asks, the sweep may already have taken it.
   */
  renew(topicRef: string, userId: string): Promise<boolean | null>;
  release(topicRef: string, userId: string): Promise<boolean | null>;
  state(topicRefs: string[]): Promise<Record<string, PrepTopicState> | null>;
}

/**
 * Mirror of 0017's default TTL: roughly twice the measured ninety-six second
 * preparation, so a slow phone is not mistaken for a dead one.
 */
export const PREP_LOCK_TTL_SECONDS = 180;

/**
 * Mirror of relay_control.max_concurrent_preps' default (0016). The memory
 * ledger cannot read the row a laptop does not have.
 */
export const MEMORY_PREP_CEILING = 8;

/**
 * A chapter screen paints a badge per topic and a chapter holds a few dozen
 * topics at most; fifty is generous headroom. Past it the request is a
 * script, and an unbounded list would become an unbounded IN-clause in
 * somebody else's query plan.
 */
export const MAX_PREP_STATE_REFS = 50;

/**
 * `<syllabus>/<chapter>/<topic>` — three NON-EMPTY SLUG segments, the shape
 * checkSavedClass holds a catalogue entry to, for the same reason: a key
 * nothing can join on locks nothing.
 *
 * THE CHARACTER CLASS IS LOAD-BEARING, not tidiness. `state` below builds a
 * PostgREST in-list by wrapping each ref in double quotes, and a quote
 * inside a ref breaks that list open — with only a length-and-segments check
 * `a"/b/c` passed, produced a malformed filter, and fail-closed the whole
 * batch of up to fifty refs to a 503. This is the fence that makes the
 * comment down there true. Every real topicRef in content/ is already a
 * lowercase hyphenated slug (0004 calls it a slugified id), so nothing is
 * narrowed that the product actually uses.
 */
const TOPIC_SEGMENT = /^[A-Za-z0-9._~-]+$/;
export const isTopicRef = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > 200) return false;
  const parts = v.split('/');
  return parts.length === 3 && parts.every((part) => TOPIC_SEGMENT.test(part));
};

/**
 * The most a lock or a release body can weigh. A topicRef is ~60 bytes and
 * the whole object under a hundred; this is three orders of magnitude of
 * headroom and still nothing like a memory bill. Checked BEFORE the decode
 * for report.ts's reason exactly: a refusal should not cost the memory of
 * decoding what it is refusing, and an identity is free.
 */
export const MAX_CONTROL_BYTES = 8 * 1024;

/**
 * A lock that counts in memory — the dev server and the tests. The same
 * shape 0017 has: sweep expired, admission ceiling first, one winner per
 * topic, holder-only release. NOT usable in production for the ledger's
 * reason exactly: many Edge Function instances would each hold their own
 * map, and a per-instance lock is no lock.
 *
 * `state` never answers 'ready' here: the dev host's catalogue is content/
 * on disk, served by vite, and this store deliberately does not reach around
 * the plugin to read it. 'absent' sends the dev client down the same
 * prepare-it-yourself path it takes today, which is the honest degradation.
 */
export function createMemoryPrepLocks(now: () => number = Date.now): PrepLocks {
  const locks = new Map<string, { userId: string; expiresAt: number }>();
  const sweep = () => {
    const at = now();
    for (const [topic, held] of locks) {
      if (held.expiresAt <= at) locks.delete(topic);
    }
  };

  return {
    async take(topicRef, userId) {
      sweep();
      if (locks.size >= MEMORY_PREP_CEILING) {
        return { granted: false, reason: 'busy', running: locks.size };
      }
      const held = locks.get(topicRef);
      if (held) {
        return {
          granted: false,
          reason: 'held',
          holder: held.userId,
          expiresAt: new Date(held.expiresAt).toISOString(),
          running: locks.size,
        };
      }
      const expiresAt = now() + PREP_LOCK_TTL_SECONDS * 1000;
      locks.set(topicRef, { userId, expiresAt });
      return {
        granted: true,
        holder: userId,
        expiresAt: new Date(expiresAt).toISOString(),
        running: locks.size,
      };
    },
    async renew(topicRef, userId) {
      sweep();
      const held = locks.get(topicRef);
      if (!held || held.userId !== userId) return false;
      held.expiresAt = now() + PREP_LOCK_TTL_SECONDS * 1000;
      return true;
    },
    async release(topicRef, userId) {
      sweep();
      const held = locks.get(topicRef);
      if (!held || held.userId !== userId) return false;
      locks.delete(topicRef);
      return true;
    },
    async state(topicRefs) {
      sweep();
      const states: Record<string, PrepTopicState> = {};
      for (const ref of topicRefs) {
        states[ref] = locks.has(ref) ? 'preparing' : 'absent';
      }
      return states;
    },
  };
}

/**
 * The deployed locks: 0017's definer functions plus two reads, all with the
 * service role over plain HTTP, like the ledger and the class store — no
 * SDK, so it runs unchanged in Deno.
 */
export function createSupabasePrepLocks(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): PrepLocks {
  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
  };
  const rpc = async (name: string, body: Record<string, unknown>): Promise<unknown> => {
    try {
      const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  };
  const select = async (pathAndQuery: string): Promise<unknown[] | null> => {
    try {
      const res = await fetchImpl(`${supabaseUrl}/rest/v1/${pathAndQuery}`, { headers });
      if (!res.ok) return null;
      const rows = (await res.json().catch(() => null)) as unknown;
      return Array.isArray(rows) ? rows : null;
    } catch {
      return null;
    }
  };

  /**
   * The organisation take_prep_lock wants: the caller's membership, earliest
   * created_at first — the SAME tie-break fill_org_id (0018) uses, written
   * down there as a decision. Every user has a solo org from the 0005
   * trigger, so an empty answer is a broken account, and the route fails
   * closed rather than lock under a made-up org.
   */
  const orgOf = async (userId: string): Promise<string | null> => {
    const rows = await select(
      `membership?user_id=eq.${encodeURIComponent(userId)}&select=org_id&order=created_at.asc&limit=1`,
    );
    const org = rows?.[0] as { org_id?: unknown } | undefined;
    return typeof org?.org_id === 'string' ? org.org_id : null;
  };

  return {
    async take(topicRef, userId) {
      const org = await orgOf(userId);
      if (!org) return null;
      const rows = await rpc('take_prep_lock', { p_topic: topicRef, p_user: userId, p_org: org });
      const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown>) : null;
      if (!row || typeof row.granted !== 'boolean') return null;
      const reason = row.reason === 'held' || row.reason === 'busy' ? row.reason : undefined;
      return {
        granted: row.granted,
        ...(reason ? { reason } : {}),
        ...(typeof row.holder === 'string' ? { holder: row.holder } : {}),
        ...(typeof row.expires_at === 'string' ? { expiresAt: row.expires_at } : {}),
        running: typeof row.running === 'number' ? row.running : 0,
      };
    },
    async renew(topicRef, userId) {
      const answer = await rpc('extend_prep_lock', {
        p_topic: topicRef,
        p_user: userId,
        p_ttl_seconds: PREP_LOCK_TTL_SECONDS,
      });
      return typeof answer === 'boolean' ? answer : null;
    },
    async release(topicRef, userId) {
      const answer = await rpc('release_prep_lock', { p_topic: topicRef, p_user: userId });
      return typeof answer === 'boolean' ? answer : null;
    },
    async state(topicRefs) {
      // PostgREST in-list, each value quoted because a topicRef carries
      // slashes. Safe because isTopicRef's character class admits only
      // [A-Za-z0-9._~-] per segment — no quote and no comma can reach this
      // list, so no caller can add members to it or malform the filter.
      const list = `(${topicRefs.map((r) => `"${r}"`).join(',')})`;
      const inList = `topic_ref=in.${encodeURIComponent(list)}`;
      // Only a PUBLISHED class is ready: a retracted one must send the next
      // student to prepare, not to a recording that was pulled on purpose.
      //
      // HONESTLY, THOUGH: nothing writes review_status yet. 0018 added the
      // column with default 'published' and backfilled it; keepClass does
      // not set it, and no route, tool or script can retract. So this
      // filter is a no-op TODAY and retraction is a hand-written UPDATE by
      // an operator. It is written this way now so that the day a reviewer
      // can retract, the badge follows with no relay change.
      const prepared = await select(`prepared_class?${inList}&review_status=eq.published&select=topic_ref`);
      if (prepared === null) return null;
      const locked = await select(
        `prep_lock?${inList}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=topic_ref`,
      );
      if (locked === null) return null;

      const ready = new Set(prepared.map((r) => (r as { topic_ref?: unknown }).topic_ref));
      const preparing = new Set(locked.map((r) => (r as { topic_ref?: unknown }).topic_ref));
      const states: Record<string, PrepTopicState> = {};
      for (const ref of topicRefs) {
        states[ref] = ready.has(ref) ? 'ready' : preparing.has(ref) ? 'preparing' : 'absent';
      }
      return states;
    },
  };
}

const readTopicRef = (
  body: Uint8Array,
): { ok: true; topicRef: string } | { ok: false; response: RelayResponse } => {
  if (body.byteLength > MAX_CONTROL_BYTES) {
    return { ok: false, response: fail(413, 'that request is larger than any lock this app takes') };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { ok: false, response: fail(400, 'that is not JSON') };
  }
  const topicRef = (parsed as { topicRef?: unknown })?.topicRef;
  if (!isTopicRef(topicRef)) {
    return { ok: false, response: fail(400, 'a lock needs a "<syllabus>/<chapter>/<topic>" topicRef') };
  }
  return { ok: true, topicRef };
};

/** The three routes. Admission first, fail closed on a silent store. */
export async function handlePrep(
  route: 'prep/lock' | 'prep/renew' | 'prep/release' | 'prep/state',
  req: RelayRequest,
  deps: HandlerDeps,
): Promise<RelayResponse> {
  if (!deps.prepLocks) return fail(501, 'this host cannot hold a preparation lock');
  if (route === 'prep/state') {
    // A read: it must be callable from a badge-painting screen without side
    // effects, so it is a GET and takes no lock — asserted by the tests.
    if (req.method !== 'GET') return fail(405, 'GET only');
  } else if (req.method !== 'POST') {
    return fail(405, 'POST only');
  }

  const admitted = await admitFree(req, 'prep', deps.gate);
  if (!admitted.ok) return admitted.response;

  const unavailable = (): RelayResponse => {
    const out = fail(503, 'we cannot answer this second — try again in a moment');
    out.headers['retry-after'] = '5';
    return out;
  };
  const ok = (value: unknown): RelayResponse => ({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { kind: 'json', value },
  });

  if (route === 'prep/state') {
    const asked = new URL(req.url, 'http://relay.local').searchParams.get('topicRefs') ?? '';
    const refs = asked.split(',').filter((r) => r !== '');
    if (refs.length === 0 || refs.length > MAX_PREP_STATE_REFS || !refs.every(isTopicRef)) {
      return fail(400, `state takes 1 to ${MAX_PREP_STATE_REFS} comma-separated topicRefs`);
    }
    const states = await deps.prepLocks.state(refs);
    return states === null ? unavailable() : ok({ states });
  }

  const read = readTopicRef(req.body);
  if (!read.ok) return read.response;

  if (route === 'prep/lock') {
    const answer = await deps.prepLocks.take(read.topicRef, admitted.userId);
    return answer === null ? unavailable() : ok(answer);
  }

  if (route === 'prep/renew') {
    const renewed = await deps.prepLocks.renew(read.topicRef, admitted.userId);
    return renewed === null ? unavailable() : ok({ renewed });
  }

  const released = await deps.prepLocks.release(read.topicRef, admitted.userId);
  return released === null ? unavailable() : ok({ released });
}
