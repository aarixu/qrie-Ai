import { fail, isShortText, type RelayRequest, type RelayResponse } from './relays.ts';
import { admitFree } from './gate.ts';
import type { HandlerDeps } from './handler.ts';

/**
 * A CHILD'S REPORT MUST REACH A PERSON. (Safety #4.)
 *
 * ReportSheet used to write localStorage and nothing left the phone — a
 * report button that filed complaints into a drawer nobody opens. This route
 * is the other half: an authenticated child who taps "report" produces a row
 * a person can read, and an alert that tells Aarav one exists.
 *
 * THE CONTRACT, reconciled across the PRDs and carried exactly:
 *
 *   POST /api/report
 *   request  { kind: 'wrong'|'rude'|'unsafe'|'other',
 *              note: string,           — the child's own words, capped at
 *                                        MAX_REPORT_NOTE_CHARS and otherwise
 *                                        stored verbatim; see below
 *              lessonId: string,
 *              topicRef: string|null,  — null for a report made outside a
 *                                        topic (the Help screen, Home)
 *              beatId: string|null,
 *              spokenLine: string|null,
 *              sessionId: string|null,
 *              release?: string,
 *              platform?: 'web'|'android',
 *              at: string              — ISO, the moment the child reported }
 *   response 202 { id }, idempotent on (user, lessonId, beatId, at) — a
 *            retried POST after a lost response is the SAME report, not a
 *            duplicate in front of whoever reads the queue.
 *
 * Every nullable field above is ALWAYS PRESENT and may be null, which is the
 * shape both PRD copies agree on (docs/prd/1-brand-ui-ux.md ReportSubmission,
 * repeated in docs/prd/3-backend-db-auth.md). Absent is accepted too, for a
 * client that omits rather than nulls; what is NOT accepted is a null being
 * refused, which is what this route used to do to topicRef — a report made
 * outside a topic got a permanent 400 and never reached a person.
 *
 * NOTHING SCRUBS THIS TODAY.
 * The agreed contract says the note arrives PII-scrubbed by the client, and
 * this route therefore declines to clean it — a second cleaner would be a
 * second place for a child's words to be silently altered. But the scrubber
 * DOES NOT EXIST: apps/classroom/src/ui/ReportSheet.tsx joins the reason and
 * the raw text and slices to 500, and apps/classroom/src/stores/flags.ts just
 * stores it. So the moment Wave 3 wires the POST, whatever a child typed —
 * their name, their school, a phone number, something about home — lands
 * verbatim and permanently in student_report.note. That is a DPDP
 * data-minimisation problem on child data, and it is written here rather
 * than implied because a comment claiming a scrub that does not exist is
 * exactly the defect this repo shipped once before (commit aa278cd).
 * BLOCKING HANDOFF: ReportSheet must scrub contact details before it POSTs.
 *
 * `at` IS THE CLIENT'S, AND SO DEDUPLICATION IS VOLUNTARY. It is part of the
 * idempotency key and nothing here can check it against a second source, so
 * a client that re-stamps `at` on every retry writes a fresh row every time
 * — which is exactly what today's ReportSheet would do, since it computes
 * `new Date().toISOString()` inside send(). WAVE 3: stamp `at` ONCE when the
 * child taps send and resend it byte for byte on every retry, or the id in
 * the 202 is not stable and an operator reads one report five times. It is
 * left to the client rather than clamped here because a report queued
 * offline for three days is still a report, and a server-side skew window
 * would throw exactly those away.
 *
 * WHAT WAVE 3 MUST CHANGE ON THE SHEET, field by field, because the locally
 * kept shape cannot be POSTed as it stands: `kind` is the literal 'reported'
 * and must become the reason id (wrong|rude|unsafe|other); the note must
 * lose the reason prefix it is currently joined with; and beatId,
 * spokenLine, sessionId and topicRef are not captured at all and must be
 * read from live-class context at tap time. spokenLine especially — the line
 * the tutor actually said is the single most useful field on a 'rude' or
 * 'unsafe' report, and nothing collects it. Note the tension to resolve out
 * loud when it is wired: ReportSheet's own comment says nothing the safety
 * screen matched is stored beside the note, and spokenLine is the tutor's
 * own delivered line rather than a screen match — different things, worth
 * saying so in the sheet.
 *
 * METERED AT ZERO UNITS AND STILL THROUGH ADMIT. Zero because no vendor is
 * paid a paisa by this route, so charging a child's daily class budget for
 * reporting a problem would teach exactly the wrong lesson; through admit
 * because identity plus the per-minute window are what stop a report flood
 * from a free anonymous account. A REFUSAL HERE NEVER LOSES THE REPORT:
 * the client keeps its local copy regardless of what this route answers,
 * so 401/413/429/503 are all safe to say out loud.
 *
 * AND THE HALT DOES NOT REACH IT. The kill switch and relay_control.halted
 * stop SPEND; a report spends nothing, and the minute somebody pauses the
 * relay is the minute children have most to report. handleRelay dispatches
 * this route above the kill switch and admitFree exempts it from the halted
 * and capped arms — see both comments there for the exact trade.
 */

export type ReportKind = 'wrong' | 'rude' | 'unsafe' | 'other';

/** The two platforms that exist, exactly as PRD 1's ReportSubmission and
 *  the 0019 check constraint spell them. */
export type ReportPlatform = 'web' | 'android';

export interface StudentReport {
  kind: ReportKind;
  note: string;
  lessonId: string;
  topicRef: string | null;
  beatId: string | null;
  spokenLine: string | null;
  sessionId: string | null;
  release?: string;
  platform?: ReportPlatform;
  /** ISO timestamp, part of the idempotency key. */
  at: string;
}

/**
 * The note cap, in code points — the same measure `char_length` uses in the
 * 0019 check constraint, and migrations.test.ts asserts the two are equal.
 * REJECTED past it, never truncated: presenting part of a child's words as
 * the whole would be the sanitising this repo refuses, and the client still
 * holds the full local copy to resend shorter.
 *
 * TWO NUMBERS EXIST FOR THIS FIELD AND THAT IS DELIBERATE. Both PRD copies
 * cap the note at 500 (`note: string; // ... <= 500 chars`), and the SHEET is
 * where that 500 belongs — it is what a child is given room to type.
 * The SERVER holds a looser 2000 as headroom in the same direction as
 * safety: a compliant sheet never sees a 413, and the day somebody raises
 * the sheet's cap to 800 the reports do not start silently bouncing. The
 * server's number is the one tied to SQL, because the server's number is
 * the one that can lose a report. If the two must ever agree, move the
 * SERVER'S down only after the sheet's is known to be lower.
 */
export const MAX_REPORT_NOTE_CHARS = 2000;

/** Well above any real report, well below a memory bill. Checked pre-parse. */
export const MAX_REPORT_BYTES = 64 * 1024;

/**
 * A uuid, the lowercase-or-uppercase hex shape Postgres emits and accepts.
 * Lives here because the report's sessionId needs it first; the x-prep-id
 * passthrough in handler.ts is the other caller.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID.test(s);

/**
 * Where a report goes. Pluggable for the same reason the ledger is: the dev
 * server has no Postgres, and the decisions must not care which host runs
 * them. `keep` answers null when it could not keep — the route turns that
 * into a 503 rather than a false 202, because a 202 is a promise that a
 * person can now see this.
 */
export interface ReportStore {
  /**
   * `fresh` is whether THIS call is what created the row. A retry through a
   * flaky connection must answer the same id (it does) but must not ring the
   * ops channel again: an alert is the only thing that tells a person a
   * report exists, and a channel that cries five times for one report is a
   * channel somebody mutes. keep_student_report already knows which arm it
   * took — it returns the fact rather than making the route guess.
   */
  keep(userId: string, report: StudentReport): Promise<{ id: string; fresh: boolean } | null>;
}

const KINDS = new Set<string>(['wrong', 'rude', 'unsafe', 'other']);

/**
 * Read a POSTed report, checked before anything is written.
 *
 * The note is NOT re-cleaned here — see the NOTHING SCRUBS THIS TODAY block
 * at the top of the file for what that does and does not currently mean.
 * What the server owns is the cap and the types.
 */
export function readStudentReport(
  body: Uint8Array,
): { ok: true; value: StudentReport } | { ok: false; response: RelayResponse } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { ok: false, response: fail(400, 'that is not JSON') };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, response: fail(400, 'a report is an object') };
  }
  const r = parsed as Partial<StudentReport>;

  if (typeof r.kind !== 'string' || !KINDS.has(r.kind)) {
    return { ok: false, response: fail(400, 'a report kind is wrong, rude, unsafe or other') };
  }
  if (typeof r.note !== 'string') {
    return { ok: false, response: fail(400, 'a report carries the child’s words as text, even empty text') };
  }
  // Code points, the same count char_length() makes in the 0019 constraint.
  if ([...r.note].length > MAX_REPORT_NOTE_CHARS) {
    return { ok: false, response: fail(413, 'that note is longer than a report holds — the copy on this device is intact, send a shorter one') };
  }
  if (!isShortText(r.lessonId, 200)) {
    return { ok: false, response: fail(400, 'a report names the lesson it is about') };
  }
  if (typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at))) {
    return { ok: false, response: fail(400, 'a report carries the time it was made, as ISO text') };
  }
  /**
   * NULL IS A VALUE HERE, not a missing field. A child reporting from Home
   * or the Help screen is inside no topic, and the agreed payload says so
   * with `topicRef: string | null`. Refusing that null — which this route
   * did — turned exactly those reports into a permanent 400 on the Safety #4
   * path. Every sibling nullable below has always accepted it; this one now
   * matches them.
   */
  if (r.topicRef !== undefined && r.topicRef !== null && !isShortText(r.topicRef, 200)) {
    return { ok: false, response: fail(400, 'topicRef must be short text or null') };
  }
  if (r.beatId !== undefined && r.beatId !== null && !isShortText(r.beatId, 200)) {
    return { ok: false, response: fail(400, 'beatId must be short text or null') };
  }
  if (r.spokenLine !== undefined && r.spokenLine !== null) {
    if (typeof r.spokenLine !== 'string' || [...r.spokenLine].length > MAX_REPORT_NOTE_CHARS) {
      return { ok: false, response: fail(400, 'spokenLine must be text no longer than a note') };
    }
  }
  if (r.release !== undefined && r.release !== null && !isShortText(r.release, 100)) {
    return { ok: false, response: fail(400, 'release must be short text') };
  }
  /**
   * The two names the column will accept. 0019 puts the same check on
   * student_report.platform, as PRD 1 spells it, so a third value would be
   * refused by Postgres AFTER admit had already said yes — a 503 the child
   * cannot act on instead of a 400 the client can. Refused here, not mapped:
   * a platform we do not know is not a platform to guess at.
   */
  if (r.platform !== undefined && r.platform !== null && r.platform !== 'web' && r.platform !== 'android') {
    return { ok: false, response: fail(400, 'platform is "web" or "android"') };
  }

  /**
   * sessionId is DROPPED when malformed, not refused — the one soft edge in
   * a validator that otherwise rejects. It is attribution telemetry, not the
   * child's words: losing the whole report because a client bug mangled a
   * uuid would defeat the route's single purpose, and the column is a uuid
   * so an unvalidated string would make Postgres do the refusing instead.
   */
  const sessionId =
    typeof r.sessionId === 'string' && isUuid(r.sessionId) ? r.sessionId : null;

  return {
    ok: true,
    value: {
      kind: r.kind as ReportKind,
      note: r.note,
      lessonId: r.lessonId,
      topicRef: r.topicRef ?? null,
      beatId: r.beatId ?? null,
      spokenLine: r.spokenLine ?? null,
      sessionId,
      ...(r.release !== undefined && r.release !== null ? { release: r.release } : {}),
      ...(r.platform !== undefined && r.platform !== null ? { platform: r.platform } : {}),
      at: r.at,
    },
  };
}

/** The idempotency key, spelled once. Mirrors the 0019 unique index. */
const dedupeKeyOf = (userId: string, r: StudentReport): string =>
  `${userId} ${r.lessonId} ${r.beatId ?? ''} ${r.at}`;

/** Keeps reports in an array. For the dev server and the tests. */
export function createMemoryReportStore(): ReportStore & {
  kept: { userId: string; report: StudentReport; id: string }[];
} {
  const kept: { userId: string; report: StudentReport; id: string }[] = [];
  const byKey = new Map<string, string>();
  return {
    kept,
    async keep(userId, report) {
      const key = dedupeKeyOf(userId, report);
      const seen = byKey.get(key);
      if (seen) return { id: seen, fresh: false };
      const id = crypto.randomUUID();
      byKey.set(key, id);
      kept.push({ userId, report, id });
      return { id, fresh: true };
    },
  };
}

/**
 * The deployed store: one definer-function round trip with the service role.
 *
 * A DEFINER FUNCTION AND NOT A DIRECT INSERT, decided here: the table has
 * RLS on and zero policies like every control surface, and the function is
 * what makes the retry answer the SAME id — insert-on-conflict-do-nothing
 * then read the survivor, atomically, in Postgres, where the unique index
 * actually lives. A direct PostgREST insert cannot say "already there, and
 * here is its id" in one round trip.
 */
export function createSupabaseReportStore(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): ReportStore {
  return {
    async keep(userId, r) {
      try {
        const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/keep_student_report`, {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_user: userId,
            p_kind: r.kind,
            p_note: r.note,
            p_lesson: r.lessonId,
            p_topic: r.topicRef ?? null,
            p_beat: r.beatId ?? null,
            p_spoken: r.spokenLine ?? null,
            p_session: r.sessionId ?? null,
            p_release: r.release ?? null,
            p_platform: r.platform ?? null,
            p_at: r.at,
          }),
        });
        if (!res.ok) return null;
        // keep_student_report `returns table (report_id uuid, fresh boolean)`,
        // so PostgREST hands back a one-row array, not a bare scalar.
        const rows = (await res.json().catch(() => null)) as unknown;
        const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown>) : null;
        const id = row?.report_id;
        if (typeof id !== 'string' || id === '') return null;
        return { id, fresh: row?.fresh === true };
      } catch {
        return null;
      }
    },
  };
}

/** What the alert carries. Metadata only — NEVER the note. */
export interface ReportAlert {
  kind: ReportKind;
  lessonId: string;
  at: string;
  reportId: string;
}

/**
 * Tell a person a report exists.
 *
 * Fire and forget, both failures swallowed: an alert that could fail the 202
 * would make the ops webhook a dependency of a child being heard, which is
 * backwards. THE NOTE DOES NOT TRAVEL — a webhook is an external service and
 * a child's words do not go to one; whoever is alerted reads the row itself
 * through the service role. Unset, one server-side line says the same thing.
 */
export function sendReportAlert(
  webhook: string | undefined,
  alert: ReportAlert,
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = console.log,
): void {
  if (!webhook) {
    log(`  report: ${alert.kind} on ${alert.lessonId} at ${alert.at} kept as ${alert.reportId} (no OPS_ALERT_WEBHOOK set)`);
    return;
  }
  try {
    void fetchImpl(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(alert),
    }).catch(() => undefined);
  } catch {
    // A webhook that throws synchronously gets the same silence.
  }
}

/** The route. Admission first, exactly like every relay. */
export async function handleReport(req: RelayRequest, deps: HandlerDeps): Promise<RelayResponse> {
  if (req.method !== 'POST') return fail(405, 'POST only');
  if (!deps.reports) return fail(501, 'this host cannot take a report');
  // Before the parse, for the same reason the llm relay checks first: a
  // refusal should not cost the memory of decoding what it is refusing.
  if (req.body.byteLength > MAX_REPORT_BYTES) {
    return fail(413, 'that request is larger than any report this app sends');
  }

  const admitted = await admitFree(req, 'report', deps.gate);
  if (!admitted.ok) return admitted.response;

  const read = readStudentReport(req.body);
  if (!read.ok) return read.response;

  const kept = await deps.reports.keep(admitted.userId, read.value);
  if (!kept) {
    // Never a false 202: a 202 is the promise that a person can see this.
    // The client's local copy survives the refusal and will be resent.
    return fail(503, 'we could not take the report this second — it is still saved on this device');
  }

  // Only for the row this call actually created. A retry gets the same 202
  // and the same id; it does not get a second knock at the ops channel.
  if (kept.fresh) {
    sendReportAlert(deps.opsAlertWebhook, {
      kind: read.value.kind,
      lessonId: read.value.lessonId,
      at: read.value.at,
      reportId: kept.id,
    });
  }

  return {
    status: 202,
    headers: { 'content-type': 'application/json' },
    body: { kind: 'json', value: { id: kept.id } },
  };
}
