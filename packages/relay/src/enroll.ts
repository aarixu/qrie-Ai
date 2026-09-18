import { fail, isShortText, type RelayRequest, type RelayResponse } from './relays.ts';
import { MAX_CONTROL_BYTES } from './prep.ts';
import { admitFree } from './gate.ts';
import type { HandlerDeps } from './handler.ts';

/**
 * ENROLMENT: A CONSENT ARTIFACT FIRST, A FORM SECOND.
 *
 * The users are children, so DPDP wants VERIFIABLE parental consent: a
 * parent's phone, an OTP that proves somebody actually holds that phone, and
 * a row that says who consented and when. That row is consent_record (0019);
 * everything in this file exists to write it truthfully or not at all.
 *
 * THE CONTRACT, exactly:
 *
 *   POST /api/enroll/otp  { parentPhone: string (E.164) }
 *     -> 200 { sent: true }
 *     -> 429 + retry-after when the send gate refuses (SMS is money)
 *
 *   POST /api/enroll      { studentName: string, klass: 6..12,
 *                           board: 'ncert', subjects: string[],
 *                           schoolName?: string, city?: string,
 *                           parentName: string, parentPhone: string (E.164),
 *                           consent: true (the LITERAL true),
 *                           otp: string, contestCode?: string }
 *     -> 200 { ok: true, next: string }
 *
 * `next` IS SERVER-DECIDED ('/app/diagnostic' today). A client must never
 * build it: where a freshly enrolled student lands is product policy, and
 * policy that lives in a browser is policy every stale build gets to keep.
 *
 * THE ACCOUNT IS THE CALLER'S EXISTING IDENTITY, AND BOTH ROUTES NEED AN
 * AUTHORIZATION HEADER. The browser already holds a durable anonymous user
 * from first launch; enrolment binds consent to that user and never mints
 * one. A server-side account upgrade is out of scope, on the record.
 *
 * WHICH MEANS THE MARKETING FORM MUST SIGN IN FIRST, and this is the line
 * that says so, because docs/prd/0-website-integration-contract.md publishes
 * this endpoint shape with no Authorization header anywhere in it —
 * "Build your form against this shape and it will work". It will not:
 * admitFree 401s without a verified bearer token. The form at
 * curie.co.in/enter must call signInAnonymously on the shared origin and
 * send that session's token. OPERATOR HANDOFF, and Aarav is the reader who
 * needs it, because he is building that form.
 *
 * WHAT THIS ROUTE DOES NOT WRITE: the profile. It validates studentName,
 * klass, board, subjects, schoolName and city and then keeps none of them —
 * only the consent row. docs/prd/1-brand-ui-ux.md and docs/prd/2-clients.md
 * both assign the student_state 'ai-tutor:profile' write to /api/enroll, on
 * the stated ground that student_state.org_id is NOT NULL and a client
 * cannot know its organisation. THAT GROUND IS NOW STALE: 0018 made org_id
 * nullable and added the fill_org_id trigger, so a client-written row gets
 * its org from Postgres. Who owns the row is therefore a live product
 * decision rather than a fixed constraint, and this route does not settle
 * it by quietly shipping one side. THE CONCRETE CASUALTY, named so the
 * decision is made with it in view: the contest door runs no app code, so
 * a contest enrolment today produces a consent row, a redirect, and NO
 * PROFILE AT ALL. Decide before Wave 3 builds the enrolment UI.
 *
 * Zero units, still through admit: no vendor spend on the route itself, and
 * the SMS — the part that IS money — has its own three-key gate below.
 */

/** Where the server sends a freshly enrolled student. Policy lives here. */
export const ENROLLED_NEXT = '/app/diagnostic';

/**
 * E.164: plus, a country code that does not start with zero, 8 to 15 digits
 * in all. Spaces and dashes are the CLIENT's formatting problem; what is
 * stored must be one canonical shape or "per phone" rate limits fragment.
 */
export const isE164 = (v: unknown): v is string =>
  typeof v === 'string' && /^\+[1-9]\d{7,14}$/.test(v);

// ---------------------------------------------------------------- the OTP --

/**
 * THE SMS VENDOR IS A SEAM, NOT A DEPENDENCY. No vendor is chosen yet, so
 * the interface is what ships: the dev provider below logs the code
 * server-side and accepts it back, and the real one (MSG91, Twilio Verify,
 * whichever) lands behind this same pair with its key held by the relay
 * host's environment — NEVER a browser, for the same reason the OpenRouter
 * key never travels.
 */
export interface OtpProvider {
  /**
   * Send a code to this phone, on behalf of this user. The code itself never
   * leaves the provider.
   *
   * `userId` IS PART OF THE KEY, not telemetry. Without it the code is bound
   * to the phone alone, and on a shared device — a kiosk at a contest, the
   * exact door this route was built for — a second person can walk up and
   * spend the first person's verified code against THEIR OWN account, so
   * consent is recorded for the wrong child. Send and verify must agree on
   * the pair.
   */
  send(phone: string, userId: string): Promise<{ ok: true } | { ok: false; why: string }>;
  /**
   * True exactly once per sent code, for the same (phone, user) that asked.
   *
   * ATTEMPT-LIMITING IS PART OF THIS CONTRACT, not an implementation
   * detail: a four-to-eight digit space behind a 120-a-minute window is a
   * few days of guessing. An implementation MUST burn the code after a
   * small number of wrong guesses. Both vendors on the shortlist (Twilio
   * Verify, MSG91) enforce this themselves — this line is here so whoever
   * picks one checks rather than assumes.
   */
  verify(phone: string, otp: string, userId: string): Promise<boolean>;
}

/**
 * How hard sending is gated — THREE KEYS, and it takes all three. The SQL
 * constants in claim_otp_send (0019) and this memory mirror are asserted
 * equal by migrations.test.ts, exactly as UNITS_PER_DAY is.
 *
 * Per PHONE because the bill is per SMS, not per account. Per USER so one
 * identity cannot spray codes across the phone book. And PER PROJECT PER
 * DAY because the first two together still bound nothing: the browser mints
 * free anonymous identities, so N accounts x 10 sends x distinct phones is
 * an unbounded daily SMS bill with every individual key inside its limit.
 * That is the same hole UNITS_PER_DAY had and the same answer relay_control
 * gave it — a line under all of them. 200 is roughly a busy launch day of
 * real enrolments and nothing like a spray.
 *
 * It costs nothing today because the deployed provider sends no SMS. It
 * becomes the only thing between a leaked endpoint and a real bill the hour
 * a vendor key is set, which is a one-line change per the seam's docblock.
 */
export const OTP_SENDS_PER_PHONE_BURST = 3;
export const OTP_BURST_WINDOW_MINUTES = 10;
export const OTP_SENDS_PER_PHONE_PER_DAY = 10;
export const OTP_SENDS_PER_USER_PER_DAY = 10;
export const OTP_SENDS_PER_DAY_PROJECT = 200;

/** A code outlives a slow parent, not an afternoon. */
export const OTP_TTL_MS = 10 * 60 * 1000;

/** Wrong guesses before the code is burned. 120 requests a minute through
 *  the shared window would otherwise walk a six-digit space in a week. */
const OTP_MAX_ATTEMPTS = 5;

/**
 * The dev provider: logs the code where a developer (or the Edge Function's
 * log stream) can read it, sends nothing, charges nobody. The code is never
 * in the HTTP response — even in dev, the flow being rehearsed is "somebody
 * reads a second channel", and a response that carried the code would let a
 * client be built that only works against the fake.
 *
 * In-memory, so on the deployed host a verify may land on a different
 * isolate than the send and fail. Named gap: the real vendor holds the code
 * (or its own verify API) server-side, which is what this seam is FOR.
 */
export function createDevOtpProvider(
  log: (line: string) => void = console.log,
  now: () => number = Date.now,
): OtpProvider {
  const codes = new Map<string, { code: string; expiresAt: number; attempts: number }>();
  // The pair, not the phone: see OtpProvider.send for the shared-device case
  // this closes.
  const keyOf = (phone: string, userId: string): string => `${userId} ${phone}`;
  return {
    async send(phone, userId) {
      const digits = new Uint32Array(1);
      crypto.getRandomValues(digits);
      const code = String(digits[0] % 1_000_000).padStart(6, '0');
      codes.set(keyOf(phone, userId), { code, expiresAt: now() + OTP_TTL_MS, attempts: 0 });
      log(`  otp: the code for ${phone} is ${code} (dev provider — no SMS was sent)`);
      return { ok: true };
    },
    async verify(phone, otp, userId) {
      const key = keyOf(phone, userId);
      const held = codes.get(key);
      if (!held || now() >= held.expiresAt) return false;
      held.attempts += 1;
      if (held.code !== otp) {
        // Burned at the limit, never past it — the entry is gone before
        // attempts could exceed OTP_MAX_ATTEMPTS, so there is no branch here
        // for a count above it to reach.
        if (held.attempts >= OTP_MAX_ATTEMPTS) codes.delete(key);
        return false;
      }
      // One shot: a replayed code must not enrol twice.
      codes.delete(key);
      return true;
    },
  };
}

/**
 * May this user send this phone another code right now? Pluggable because
 * the real count must live in Postgres — Edge Function instances are many
 * and short-lived, the exact argument createMemoryLedger's docblock makes —
 * while the dev server counts in memory. Null means the gate itself is
 * unreachable, and the route FAILS CLOSED: an outage is precisely when a
 * runaway SMS bill would go unnoticed.
 */
export interface OtpGate {
  claim(
    userId: string,
    phone: string,
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number } | null>;
}

/**
 * The memory mirror of claim_otp_send's LIMITS, for the dev server and the
 * tests. Its RETRY-AFTER is the same too: both answer the real seconds left
 * on the oldest send in the burst window, rather than a flat ten minutes,
 * so a client honouring the header waits the same time against either host.
 */
export function createMemoryOtpGate(now: () => number = Date.now): OtpGate {
  const byPhone = new Map<string, number[]>();
  const byUser = new Map<string, number[]>();
  const allSends: number[] = [];
  const dayMs = 86_400_000;
  return {
    async claim(userId, phone) {
      const at = now();
      const dayStart = Math.floor(at / dayMs) * dayMs;
      const windowStart = at - OTP_BURST_WINDOW_MINUTES * 60_000;

      const phones = (byPhone.get(phone) ?? []).filter((t) => t >= dayStart);
      const users = (byUser.get(userId) ?? []).filter((t) => t >= dayStart);

      const burst = phones.filter((t) => t > windowStart);
      if (burst.length >= OTP_SENDS_PER_PHONE_BURST) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((burst[0] + OTP_BURST_WINDOW_MINUTES * 60_000 - at) / 1000)),
        };
      }
      const untilMidnight = Math.max(1, Math.ceil((dayStart + dayMs - at) / 1000));
      if (phones.length >= OTP_SENDS_PER_PHONE_PER_DAY || users.length >= OTP_SENDS_PER_USER_PER_DAY) {
        return { allowed: false, retryAfterSeconds: untilMidnight };
      }
      // The line under all of them, last because it is the rarest to hit.
      const today = allSends.filter((t) => t >= dayStart);
      allSends.length = 0;
      allSends.push(...today);
      if (today.length >= OTP_SENDS_PER_DAY_PROJECT) {
        return { allowed: false, retryAfterSeconds: untilMidnight };
      }

      phones.push(at);
      users.push(at);
      allSends.push(at);
      byPhone.set(phone, phones);
      byUser.set(userId, users);
      return { allowed: true };
    },
  };
}

/** The deployed gate: one definer-function round trip, service role only. */
export function createSupabaseOtpGate(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): OtpGate {
  return {
    async claim(userId, phone) {
      try {
        const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/claim_otp_send`, {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ p_user: userId, p_phone: phone }),
        });
        if (!res.ok) return null;
        const rows = (await res.json().catch(() => null)) as
          | { allowed?: unknown; retry_after?: unknown }[]
          | null;
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row || typeof row.allowed !== 'boolean') return null;
        if (row.allowed) return { allowed: true };
        return {
          allowed: false,
          retryAfterSeconds:
            typeof row.retry_after === 'number' && row.retry_after > 0 ? row.retry_after : 600,
        };
      } catch {
        return null;
      }
    },
  };
}

// ------------------------------------------------------------- the record --

/**
 * The DPDP verifiable-parental-consent artifact, field for field.
 *
 * WHAT IT ACTUALLY PROVES, so nobody reads it for more than it says: that
 * somebody held that phone and typed the code we sent to it, at that
 * moment. NOT that they are the child's parent — no phone OTP can show
 * that, and a thirteen-year-old typing their own number produces a row
 * indistinguishable from a real one. It is the strongest artifact available
 * without a payment rail or a document check, and its limit belongs beside
 * it rather than in a compliance conversation later.
 *
 * `source` is CALLER-ASSERTED: it is 'contest' because the request carried a
 * contestCode, and no contest list is checked. The CHECK constraint in 0019
 * keeps it to two spellings; it does not make it evidence.
 */
export interface ConsentRow {
  userId: string;
  parentName: string;
  parentPhone: string;
  source: 'contest' | 'self_serve';
  otpVerifiedAt: string;
  contestCode: string | null;
}

export interface ConsentStore {
  record(row: ConsentRow): Promise<boolean>;
}

/** Keeps consents in an array. For the dev server and the tests. */
export function createMemoryConsentStore(): ConsentStore & { rows: ConsentRow[] } {
  const rows: ConsentRow[] = [];
  return {
    rows,
    async record(row) {
      rows.push(row);
      return true;
    },
  };
}

/**
 * The deployed store: a direct service-role insert, the same door
 * keepClass's catalogue row walks through, chosen over a definer function
 * because — unlike the report — nothing here needs an answer computed in
 * Postgres: no idempotency read-back, no counter. RLS is on with zero
 * policies, so the service role is the only thing that can reach the table
 * at all, and one plain insert is one fewer function to audit.
 */
export function createSupabaseConsentStore(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): ConsentStore {
  return {
    async record(row) {
      try {
        const res = await fetchImpl(`${supabaseUrl}/rest/v1/consent_record`, {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            user_id: row.userId,
            parent_name: row.parentName,
            parent_phone: row.parentPhone,
            source: row.source,
            otp_verified_at: row.otpVerifiedAt,
            contest_code: row.contestCode,
          }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

// -------------------------------------------------------------- the routes --

export interface EnrollRequest {
  studentName: string;
  klass: number;
  board: 'ncert';
  subjects: string[];
  schoolName?: string;
  city?: string;
  parentName: string;
  parentPhone: string;
  consent: true;
  otp: string;
  contestCode?: string;
}

function readEnrollRequest(
  body: Uint8Array,
): { ok: true; value: EnrollRequest } | { ok: false; response: RelayResponse } {
  if (body.byteLength > MAX_CONTROL_BYTES) {
    return { ok: false, response: fail(413, 'that request is larger than any enrolment this app sends') };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { ok: false, response: fail(400, 'that is not JSON') };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, response: fail(400, 'an enrolment is an object') };
  }
  const e = parsed as Partial<EnrollRequest>;

  if (!isShortText(e.studentName, 80)) {
    return { ok: false, response: fail(400, 'an enrolment needs the student’s name') };
  }
  // The same bounds checkSavedClass holds a catalogue entry to.
  if (typeof e.klass !== 'number' || !Number.isInteger(e.klass) || e.klass < 6 || e.klass > 12) {
    return { ok: false, response: fail(400, 'klass must be a school class from 6 to 12') };
  }
  if (e.board !== 'ncert') {
    return { ok: false, response: fail(400, 'the only board today is ncert') };
  }
  if (
    !Array.isArray(e.subjects) ||
    e.subjects.length === 0 ||
    e.subjects.length > 10 ||
    !e.subjects.every((s) => isShortText(s, 40))
  ) {
    return { ok: false, response: fail(400, 'subjects is 1 to 10 short names') };
  }
  if (e.schoolName !== undefined && !isShortText(e.schoolName, 120)) {
    return { ok: false, response: fail(400, 'schoolName must be short text') };
  }
  if (e.city !== undefined && !isShortText(e.city, 120)) {
    return { ok: false, response: fail(400, 'city must be short text') };
  }
  if (!isShortText(e.parentName, 80)) {
    return { ok: false, response: fail(400, 'an enrolment needs the parent’s name') };
  }
  if (!isE164(e.parentPhone)) {
    return { ok: false, response: fail(400, 'parentPhone must be E.164, like +919876543210') };
  }
  /**
   * THE LITERAL true. Not truthy, not 'true', not 1: DPDP consent is an
   * affirmative act, and a coercion here would let a client bug enrol a
   * child on a value nobody meant. Refused, never assumed.
   */
  if (e.consent !== true) {
    return { ok: false, response: fail(400, 'consent must be given as the literal true, never assumed') };
  }
  if (typeof e.otp !== 'string' || !/^\d{4,8}$/.test(e.otp)) {
    return { ok: false, response: fail(400, 'otp is the 4 to 8 digits from the SMS') };
  }
  if (e.contestCode !== undefined && !isShortText(e.contestCode, 40)) {
    return { ok: false, response: fail(400, 'contestCode must be short text') };
  }
  return { ok: true, value: e as EnrollRequest };
}

/** POST /api/enroll/otp — identity, gate, then (and only then) an SMS. */
export async function handleEnrollOtp(req: RelayRequest, deps: HandlerDeps): Promise<RelayResponse> {
  if (req.method !== 'POST') return fail(405, 'POST only');
  if (!deps.otp || !deps.otpGate) return fail(501, 'this host cannot send codes');

  const admitted = await admitFree(req, 'enroll', deps.gate);
  if (!admitted.ok) return admitted.response;

  if (req.body.byteLength > MAX_CONTROL_BYTES) {
    return fail(413, 'that request is larger than a phone number');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(req.body));
  } catch {
    return fail(400, 'that is not JSON');
  }
  const phone = (parsed as { parentPhone?: unknown })?.parentPhone;
  if (!isE164(phone)) return fail(400, 'parentPhone must be E.164, like +919876543210');

  // The gate BEFORE the send: refusing after would be counting a bill that
  // has already been run up. Null is the gate being unreachable, and an SMS
  // sender with no working meter stays silent — fail closed, like the ledger.
  const claim = await deps.otpGate.claim(admitted.userId, phone);
  if (claim === null) {
    const out = fail(503, 'we cannot send a code this second — try again in a moment');
    out.headers['retry-after'] = '5';
    return out;
  }
  if (!claim.allowed) {
    const out = fail(429, 'that is a lot of codes — please wait a little and try again');
    out.headers['retry-after'] = String(claim.retryAfterSeconds);
    return out;
  }

  const sent = await deps.otp.send(phone, admitted.userId);
  if (!sent.ok) return fail(502, 'the code could not be sent — try again in a moment');

  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { kind: 'json', value: { sent: true } },
  };
}

/** POST /api/enroll — verify the code, write the consent, say where next. */
export async function handleEnroll(req: RelayRequest, deps: HandlerDeps): Promise<RelayResponse> {
  if (req.method !== 'POST') return fail(405, 'POST only');
  if (!deps.otp || !deps.consent) return fail(501, 'this host cannot enrol');

  const admitted = await admitFree(req, 'enroll', deps.gate);
  if (!admitted.ok) return admitted.response;

  const read = readEnrollRequest(req.body);
  if (!read.ok) return read.response;
  const e = read.value;

  const verified = await deps.otp.verify(e.parentPhone, e.otp, admitted.userId);
  if (!verified) {
    return fail(400, 'that code is not right or has expired — ask for a new one');
  }

  /**
   * The consent row is the enrolment; without it there was none. A false
   * from the store answers 503, and the one-shot code is spent — the parent
   * asks for a fresh code and tries again, which is a cheaper failure than a
   * consent that exists only in a 200 the database never saw.
   */
  const recorded = await deps.consent.record({
    userId: admitted.userId,
    parentName: e.parentName,
    parentPhone: e.parentPhone,
    source: e.contestCode !== undefined ? 'contest' : 'self_serve',
    otpVerifiedAt: new Date().toISOString(),
    contestCode: e.contestCode ?? null,
  });
  if (!recorded) {
    return fail(503, 'we could not record the enrolment — please ask for a new code and try again');
  }

  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { kind: 'json', value: { ok: true, next: ENROLLED_NEXT } },
  };
}
