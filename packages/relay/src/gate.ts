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
 * The route families that spend no vendor money: a report, a prep lock, an
 * enrolment, a distress flag (plan 5). Named apart from RelayName on purpose — they have no row in
 * UNITS, because a price table entry of zero would contradict the table's
 * own rule, and these are not priced calls; they are control traffic that
 * still has to answer to WHO and HOW OFTEN.
 */
export type FreeRoute = 'report' | 'prep' | 'enroll' | 'flag';

/**
 * WHAT EACH CALL COSTS AGAINST THE DAILY BUDGET.
 *
 * ONE UNIT IS ONE PAISA OF VENDOR SPEND. That is the whole rule, and it is
 * written down because the first table broke it: `llm: 10, hear: 4,
 * speech: 1` was the exact inverse of the bill. Speech is 86% of what a class
 * costs and was the cheapest line in the meter; the judge call that costs
 * fourteen paise was the most expensive. A measurement run on 2026-09-14 was
 * cut off mid-way after about 120 model calls while the speech beside it —
 * far more money — barely moved the counter.
 *
 * MEASURED, tools/measure/last-class.json, 2026-09-13: one class of the
 * committed Class 10 heredity topic, 18 beats, 4 asks, 38 calls.
 *
 *   relay    what one call actually costs           priced here
 *   ------   ------------------------------------   -----------------------
 *   llm      ₹0.14 a judge call (8 of them)          85 units per call
 *            ₹2.27 a prep call (4 of them)             — the 12-call mean
 *   speech   ₹0.00287 a character                     0.29 units a character
 *            deepgram/aura-2, $30/M characters
 *   hear     ₹0.00685 a second of audio               0.69 units a second
 *            deepgram/nova-3, $0.0043/minute
 *   class    ≤₹0.10 — one Storage write, capped       10 units per call
 *            at MAX_CLASS_BYTES = 12 MB
 *   icons    ₹0 — a public icon, no vendor             1 unit per call
 *
 * Prices from tools/sql/model_price.sql at ₹95.6/USD — the same constants
 * tools/measure/model-cost.mjs prices a class with. If those move, these move.
 *
 * SPEECH AND HEAR ARE SIZED, NOT FLAT, and that cost no machinery: the words
 * are already in `?text=` and the audio is already the request body, so
 * `admit` can read the exact billable quantity before a paisa is spent. A
 * flat unit per call would have been a lie worth two orders of magnitude —
 * a one-word "haan" and an eight-thousand-character paste both charged one
 * unit, which is the hole the old table left open.
 *
 * LLM IS FLAT, AND IT IS AN APPROXIMATION. 87% of an llm bill is output and
 * thinking tokens — 24,836 of them against 18,141 in — and none of that
 * exists when `admit` runs. Nothing in the request predicts it, either: the
 * artist's calls send 650 prompt tokens and get 5,000 back, so body size says
 * the opposite of the truth. So every llm call is charged the mean of the
 * measured class, which OVERCHARGES a judge call 6x and UNDERCHARGES a prep
 * call 2.7x, and is right to within 0.1% across a whole class.
 *
 * The exact fix is known and is not this file's. `usage.record` already
 * receives the real token counts after every call, so a settlement pass could
 * charge the difference to the next day. Until somebody builds it, this stays
 * a ceiling and not an invoice.
 */

/**
 * How a relay's price is expressed.
 *
 * A bare number could not say whether it meant a call or a character, and the
 * two differ by two orders of magnitude here — so it does not get to be a
 * bare number.
 */
export type Price =
  | { per: 'call'; units: number }
  | { per: 'character'; units: number }
  | { per: 'second'; units: number };

export const UNITS: Record<RelayName, Price> = {
  llm: { per: 'call', units: 85 },
  hear: { per: 'second', units: 0.69 },
  speech: { per: 'character', units: 0.29 },
  class: { per: 'call', units: 10 },
  icons: { per: 'call', units: 1 },
};

/**
 * 16 kHz, 16-bit, mono — MIC_SAMPLE_RATE in packages/voice/src/audio.ts, and
 * what apps/classroom/src/lib/ear.ts wraps in a WAV header. The same divisor
 * tools/measure/model-cost.mjs turns recorded bytes into billed seconds with.
 *
 * The vendor bills by DURATION, so a body encoded denser than raw PCM is
 * undercharged. Bounded rather than decoded: the ear posts what ear.ts built,
 * and a caller who posts something else is still held by REQUESTS_PER_MINUTE.
 */
export const HEARD_BYTES_PER_SECOND = 32_000;

/**
 * What THIS call costs, decided before it is made.
 *
 * Never zero. A call that costs nothing is a call worth making a million
 * times, and the per-minute ceiling alone would happily let one run all day.
 */
export function unitsFor(relay: RelayName, req: RelayRequest): number {
  const price = UNITS[relay];
  switch (price.per) {
    case 'call':
      return price.units;
    case 'character': {
      // Code points, exactly as usage.ts counts them for the invoice. A meter
      // and a bill that count the same text differently are two numbers
      // nobody can reconcile afterwards.
      const text = new URL(req.url, 'http://relay.local').searchParams.get('text') ?? '';
      return Math.max(1, Math.ceil([...text].length * price.units));
    }
    case 'second':
      return Math.max(1, Math.ceil((req.body.byteLength / HEARD_BYTES_PER_SECOND) * price.units));
  }
}

/**
 * THE CEILING ON OUR SPENDING, NOT ON THEIRS.
 *
 * `UNITS_PER_DAY` is a ceiling per identity, and an identity is free: the app
 * calls `signInAnonymously` at boot and nothing stands in front of it. So what
 * a script actually faces is not Rs 120 a day, it is Rs 120 times however many
 * accounts it cares to mint. This is the line under all of them — one unit is
 * one paisa, so 50,000 is Rs 500 of vendor spend in a UTC day, across everyone.
 *
 * Kept deliberately well above `UNITS_PER_DAY`, so that a single student can
 * never be the one who trips it. A cap a student can reach alone is not a cap
 * on us; it is a second, worse cap on them.
 *
 * Written down twice, here and as a plpgsql constant inside `claim_relay`,
 * because the check has to be atomic and the price has to be readable.
 * `apps/classroom/tests/migrations.test.ts` asserts the two are equal.
 */
export const UNITS_PER_DAY_PROJECT = 50_000;

export type ClaimResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'rate' | 'budget' | 'capped' | 'halted' | 'unavailable';
      retryAfterSeconds: number;
    };

export interface Ledger {
  claim(userId: string, relay: RelayName | FreeRoute, units: number): Promise<ClaimResult>;
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
  // Somebody, or an alarm, stopped this on purpose. Same stop as
  // `RELAY_DISABLED` and the same words, but held in `relay_control` where it
  // can be set without a deploy and without anybody being awake. Minutes, not a
  // day, so it must not say "tomorrow".
  halted: {
    status: 503,
    message: 'Qrie is having a rest. Classes are paused for a few minutes.',
  },
  // WE have spent our day, not them. They did nothing, they have no budget to
  // check, and there is nothing they can do differently — so the message says
  // what is true and does not hand them a fault they do not have. 503 rather
  // than 429 for the same reason: this is our capacity, not their rate.
  capped: {
    status: 503,
    message: 'Qrie has taught a lot of classes today. Please come back tomorrow.',
  },
  // The meter is down, which is ours to fix and not the student's fault. It is
  // still a refusal: a limit that disappears during an outage is not a limit,
  // and an outage is exactly when a runaway would go unnoticed.
  unavailable: {
    status: 503,
    message: 'We cannot start a class this second. Try again in a moment.',
  },
};

type ClaimRefusal = Extract<ClaimResult, { allowed: false }>['reason'];

/** The reasons `claim_relay` may give. Anything else is read as a rate limit. */
const REASONS = new Set<string>(Object.keys(REFUSALS));

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

  const claim = await gate.ledger.claim(userId, relay, unitsFor(relay, req));
  if (!claim.allowed) return { ok: false, response: refuse(claim) };

  return { ok: true, userId };
}

/**
 * Admission for the routes that spend no vendor money.
 *
 * ZERO UNITS, AND THAT IS NOT THE HOLE `unitsFor` WARNS ABOUT. Its "never
 * zero" rule guards priced calls — a vendor call charged nothing is a call
 * worth making a million times. These routes pay no vendor: a report is a
 * row, a lock is a row, an enrolment's one costly act (the SMS) sits behind
 * its own two-key gate in enroll.ts. What zero units buys is that reporting
 * a problem or asking "is this topic warm?" never eats a child's class
 * budget. What still holds every one of them is WHO — a verified identity,
 * header only, no speech-ticket side door because none of these is an
 * <audio src> — and HOW OFTEN, the same per-minute window as everything
 * else, which the ledger counts on every claim whatever the units say.
 *
 * AND ONE EXEMPTION, FOR 'report' AND 'flag' ONLY. A distress flag (plan 5,
 * safetyFlag.ts) spends nothing either and matters most in the same minutes,
 * so everything said below about a report holds for a flag too.
 *
 * Of claim_relay's spend arms, exactly ONE can refuse a claim of zero units
 * today: 'halted' (0016:93), which tests a boolean and never looks at the
 * cost. The minute somebody flips relay_control — because a key leaked, or
 * because the tutor said something wrong — is precisely the minute children
 * have something to report, and the kill switch exists to stop SPEND. A
 * report spends nothing, so it is let through.
 *
 * THE OTHER TWO CANNOT FIRE AT ZERO, and saying otherwise was the bug this
 * paragraph used to carry. 'budget' is `row_units + p_units > units_per_day`
 * (0016:137) and 'capped' commits under `b.units + p_units <= ceiling_units`
 * (0016:159); both totals are themselves refused before they can pass their
 * ceiling, so at p_units = 0 the first is never greater and the second is
 * always less-or-equal. An ordinary spent-out day does NOT produce 'capped'
 * for a free route. It becomes reachable only when an operator lowers
 * `global_units_per_day` BELOW the spend already accrued, which is a real
 * thing somebody may do in an incident and exactly when reports matter.
 *
 * They are exempted anyway, all three, and deliberately: the reachability
 * above is a property of SQL that can be edited without this file, and the
 * failure mode of getting it wrong is a child unable to report something.
 * The exemption is the belt; the arithmetic above is only the braces.
 *
 * THE PRICE, SAID OUT LOUD: claim_relay returns from the halted arm BEFORE
 * it touches the per-minute window, so during a halt a report carries no
 * rate limit — only a verified identity and an idempotency key on a small
 * row. That is accepted deliberately. 'rate' is still obeyed in every other
 * state, and 'unavailable' — the meter itself being unreachable — is still
 * a refusal, because a report route running with no meter at all during an
 * outage is a different thing from one running during a deliberate pause.
 */
export async function admitFree(
  req: RelayRequest,
  route: FreeRoute,
  gate: Gate,
): Promise<Admission> {
  const verified = await gate.verify(req.headers['authorization'] ?? req.headers['Authorization']);
  if (!verified.ok) return { ok: false, response: fail(verified.status, verified.why) };

  const claim = await gate.ledger.claim(verified.user.userId, route, 0);
  if (!claim.allowed) {
    const spendOnly = claim.reason === 'halted' || claim.reason === 'capped' || claim.reason === 'budget';
    if (!((route === 'report' || route === 'flag') && spendOnly)) return { ok: false, response: refuse(claim) };
  }

  return { ok: true, userId: verified.user.userId };
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

/**
 * TWELVE THOUSAND UNITS A DAY, WHICH IS SEVEN CLASSES.
 *
 * Those are two different measurements and the headline used to run them
 * together, so both are written out. 12,000 is what the METER allows. Seven
 * classes is what fits under it: they weigh 11,403 units, which the meter
 * prices at ₹114 — and which the vendor actually bills at about ₹78, being
 * ₹18.98 for the cold one and ₹9.90 each for six cached
 * (tools/measure/model-cost.mjs, the same measured class as above). The gap
 * between ₹114 and ₹78 is the flat llm charge overcharging the eight judge
 * calls sixfold, exactly as the table above says it does. A CEILING ON ABUSE,
 * NOT AN INVOICE — so it is deliberately the larger of the two numbers.
 *
 * Derived from the class above, not chosen. Priced in the new units, and
 * counting the eight spoken replies the harness did not make but the
 * classroom does:
 *
 *   speech   26 calls, 2,964 characters           866 units
 *   llm       8 judge calls                       680 units
 *   hear      8 calls, 40 seconds of audio         32 units
 *   icons     1 fetch                               1 unit
 *   ----------------------------------------------------------
 *   a CACHED class                             1,579 units
 *   a COLD one, + 4 prep calls and one save    1,929 units
 *
 * So 12,000 buys one topic nobody has prepared before plus six cached ones,
 * with 597 to spare. Eight classes in a day is not a student, it is a script.
 * `a day` in the tests walks exactly these calls through the real ledger,
 * because a budget that cuts a child off partway through their first class is
 * the failure that ships silently — every single claim is allowed, and the
 * refusal only appears once enough of them have added up.
 *
 * The old 3,000 was not a tighter budget, only a differently shaped one. The
 * same class weighed 139 old units, so it allowed twenty-one classes — about
 * ₹214 of real spend — and a speech call cost one unit however long the text,
 * so an account posting 8,000 characters at a time could spend roughly
 * ₹69,000 in a day and never touch the limit. That same account now runs out
 * after five of those calls.
 */
export const UNITS_PER_DAY = 12_000;

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

      // Read against the known set rather than against one name. This used to
      // be `row.reason === 'budget' ? 'budget' : 'rate'`, which silently turned
      // every reason it had not heard of into "you are asking too fast" — so
      // adding a reason in SQL would have shipped the wrong message to a
      // student, with nothing failing anywhere to say so.
      const said = String(row.reason ?? '');
      const reason = REASONS.has(said) ? (said as ClaimRefusal) : 'rate';
      return {
        allowed: false,
        reason,
        retryAfterSeconds:
          typeof row.retry_after === 'number' && row.retry_after > 0 ? row.retry_after : 60,
      };
    },
  };
}
