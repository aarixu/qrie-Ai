import { fail, type RelayRequest, type RelayResponse } from './relays.ts';
import type { Verifier } from './auth.ts';
import { readTicket } from './ticket.ts';

/**
 * THE LOCK AND THE METER.
 *
 * Behind every relay is somebody's money. Without this, the URLs are open: one
 * of them in a browser's network tab is a free model endpoint for whoever
 * finds it, and it spends until the balance is gone. There is no alarm at the
 * bottom — the first sign is a class that will not prepare.
 *
 * Three questions, in this order, because each is cheaper than the next:
 *
 *   1. WHO. A verified Supabase user, or nobody. Anonymous sign-in means every
 *      student has an identity from their first launch, so "must be signed in"
 *      costs a student nothing and still makes every call attributable.
 *   2. HOW OFTEN. A per-minute request ceiling, sized so a real class never
 *      touches it and a runaway loop hits it in seconds.
 *   3. HOW MUCH. A per-day budget in units, so a patient attacker with a valid
 *      account cannot spend a month of runway overnight.
 *
 * The counting lives behind `Ledger` rather than in here: in production it is
 * a Postgres function, in the dev server and the tests it is a Map, and this
 * file cannot tell the difference.
 */

export type RelayName = 'llm' | 'speech' | 'hear' | 'class' | 'icons';

/**
 * WHAT EACH CALL COSTS AGAINST THE DAILY BUDGET.
 *
 * Deliberately request-shaped, not token-shaped. The relays stream upstream
 * responses straight through to the student — that is what makes the voice
 * start in a third of a second — so nothing here ever sees a token count. A
 * weight per call is the honest approximation, and the number it protects is
 * a ceiling, not an invoice.
 *
 * Rough sizes from a real prepared class: ten model calls, thirty spoken
 * lines, one icon fetch, one save. That is about 140 units, so the daily cap
 * below is roughly twenty classes.
 */
export const UNITS: Record<RelayName, number> = {
  llm: 10,
  hear: 4,
  speech: 1,
  class: 5,
  icons: 1,
};

export type ClaimResult =
  | { allowed: true }
  | { allowed: false; reason: 'rate' | 'budget' | 'unavailable'; retryAfterSeconds: number };

export interface Ledger {
  claim(userId: string, relay: RelayName, units: number): Promise<ClaimResult>;
}

export interface Gate {
  verify: Verifier;
  ledger: Ledger;
  /**
   * Signing secret for speech tickets. Absent means speech accepts only a
   * header, which is correct for a caller that can send one and closes the
   * relay to `<audio src>` — never a silent fallback to letting anyone in.
   */
  ticketSecret?: string;
  now?: () => number;
}

export type Admission =
  | { ok: true; userId: string }
  | { ok: false; response: RelayResponse };

/**
 * A refusal a client can act on.
 *
 * The message is written for a student, not for a log: they did not do
 * anything wrong, and "you have had a lot of classes today" is the truth in a
 * form somebody can respond to. `Retry-After` is a real header and the client
 * honours it.
 */
const REFUSALS: Record<Extract<ClaimResult, { allowed: false }>['reason'], { status: number; message: string }> = {
  rate: {
    status: 429,
    message: 'That is a lot of asking at once — give it a moment and try again.',
  },
  budget: {
    status: 429,
    message: 'You have used up today’s classes. This resets tomorrow.',
  },
  // The meter is down, which is ours to fix and not the student's fault. It is
  // still a refusal: a limit that disappears during an outage is not a limit,
  // and an outage is exactly when a runaway would go unnoticed.
  unavailable: {
    status: 503,
    message: 'We cannot start a class this second. Try again in a moment.',
  },
};

function refuse(claim: Extract<ClaimResult, { allowed: false }>): RelayResponse {
  const { status, message } = REFUSALS[claim.reason];
  return {
    status,
    headers: {
      'content-type': 'application/json',
      'retry-after': String(claim.retryAfterSeconds),
    },
    body: { kind: 'json', value: { error: { message, reason: claim.reason } } },
  };
}

/**
 * Who may make this call, and may they make it now.
 *
 * The speech relay is the exception and the comment on `ticket.ts` explains
 * why: an `<audio src>` cannot send a header, so it carries a signed
 * minute-scale pass in the query string instead. Every other relay takes the
 * ordinary Authorization header and nothing else.
 */
export async function admit(
  req: RelayRequest,
  relay: RelayName,
  gate: Gate,
): Promise<Admission> {
  const now = gate.now ?? Date.now;

  let userId: string | null = null;

  if (relay === 'speech' && gate.ticketSecret) {
    const asked = new URL(req.url, 'http://relay.local');
    const ticket = await readTicket(asked.searchParams.get('ticket'), gate.ticketSecret, now());
    if (ticket) userId = ticket.userId;
  }

  if (userId === null) {
    const verified = await gate.verify(req.headers['authorization'] ?? req.headers['Authorization']);
    if (!verified.ok) return { ok: false, response: fail(verified.status, verified.why) };
    userId = verified.user.userId;
  }

  const claim = await gate.ledger.claim(userId, relay, UNITS[relay]);
  if (!claim.allowed) return { ok: false, response: refuse(claim) };

  return { ok: true, userId };
}

// ---------------------------------------------------------------------------
// The limits themselves, in one place so the SQL and the in-memory ledger
// cannot drift apart. Both read these numbers.
// ---------------------------------------------------------------------------

/**
 * A class asks for a lot in a short burst — a dozen model calls while it
 * prepares, then a line of speech every few seconds. This is set well above
 * that and well below a loop.
 */
export const REQUESTS_PER_MINUTE = 120;

/** About twenty prepared classes. Nobody studies that much; a script does. */
export const UNITS_PER_DAY = 3000;

/**
 * A ledger that counts in memory.
 *
 * Used by the dev server and the tests. NOT usable in production: an Edge
 * Function is many short-lived instances, so a Map in one of them counts a
 * fraction of the traffic and the real limit becomes "per instance, roughly".
 * That is exactly why the deployed one is a Postgres function.
 */
export function createMemoryLedger(now: () => number = Date.now): Ledger {
  const seen = new Map<
    string,
    { day: number; units: number; windowStart: number; windowCount: number }
  >();
  const dayOf = (at: number) => Math.floor(at / 86_400_000);

  return {
    async claim(userId, _relay, units) {
      const at = now();
      const today = dayOf(at);
      const row = seen.get(userId) ?? { day: today, units: 0, windowStart: at, windowCount: 0 };

      if (row.day !== today) {
        row.day = today;
        row.units = 0;
      }
      if (at - row.windowStart >= 60_000) {
        row.windowStart = at;
        row.windowCount = 0;
      }

      if (row.windowCount >= REQUESTS_PER_MINUTE) {
        seen.set(userId, row);
        return {
          allowed: false,
          reason: 'rate',
          retryAfterSeconds: Math.max(1, Math.ceil((row.windowStart + 60_000 - at) / 1000)),
        };
      }
      if (row.units + units > UNITS_PER_DAY) {
        seen.set(userId, row);
        // Until midnight UTC, which is when the day column rolls over.
        const endOfDay = (today + 1) * 86_400_000;
        return {
          allowed: false,
          reason: 'budget',
          retryAfterSeconds: Math.max(1, Math.ceil((endOfDay - at) / 1000)),
        };
      }

      row.windowCount += 1;
      row.units += units;
      seen.set(userId, row);
      return { allowed: true };
    },
  };
}

/**
 * The real ledger: one Postgres round trip per relay call.
 *
 * Called with the project's SERVICE ROLE key and an EXPLICIT user id, which is
 * the one shape that serves both doors. Most relays know the caller from a
 * verified Authorization header; the speech relay knows them from a signed
 * ticket and has no token to forward, because an `<audio src>` cannot send
 * one. Either way this code has already established who the caller is, and the
 * id it passes is never taken from the request.
 *
 * Supabase hands SUPABASE_SERVICE_ROLE_KEY to an Edge Function itself, so this
 * needs nothing set up. The key never leaves the server; the function it calls
 * is granted to service_role alone, so a student holding the anon key cannot
 * reach it and cannot meter anybody.
 *
 * A ledger that cannot be reached REFUSES, with 'unavailable'. Failing open
 * would mean the one outage that matters is also the moment every limit
 * disappears.
 */
export function createSupabaseLedger(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): Ledger {
  /** Long enough to be worth honouring, short enough not to end a session. */
  const UNAVAILABLE_RETRY_SECONDS = 5;
  const down = (): ClaimResult => ({
    allowed: false,
    reason: 'unavailable',
    retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS,
  });

  return {
    async claim(userId, relay, units) {
      let res: Response;
      try {
        res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/claim_relay`, {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ p_user: userId, p_relay: relay, p_units: units }),
        });
      } catch {
        return down();
      }
      if (!res.ok) return down();

      // PostgREST returns a set-returning function as an array of rows.
      const rows = (await res.json().catch(() => null)) as
        | { allowed?: unknown; reason?: unknown; retry_after?: unknown }[]
        | null;
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row || typeof row.allowed !== 'boolean') return down();
      if (row.allowed) return { allowed: true };

      return {
        allowed: false,
        reason: row.reason === 'budget' ? 'budget' : 'rate',
        retryAfterSeconds:
          typeof row.retry_after === 'number' && row.retry_after > 0 ? row.retry_after : 60,
      };
    },
  };
}
