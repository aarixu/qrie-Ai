import { fail, isShortText, type RelayRequest, type RelayResponse } from './relays.ts';
import { admitFree } from './gate.ts';
import { isUuid } from './report.ts';
import type { HandlerDeps } from './handler.ts';

/**
 * A DISTRESS FLAG, CARRIED TO THE SERVER. (Plan 5, spec sections 7 and 11.)
 *
 * The tutor's screen (packages/safety) recognises a child in distress on the
 * phone. This route carries the fact of it to Postgres, where
 * public.keep_safety_event keeps it in admin.safety_event.
 *
 *   POST /api/flag (deployed: /relay/flag)
 *   request  { id: uuid,                 the app mints it once; the retry key
 *              category: 'distress',
 *              direction: 'from-student' | 'to-student',
 *                                        the child's words, or the tutor's own line
 *              at: string,               ISO, when the screen flagged it
 *              platform?: 'web' | 'android',
 *              release?: string }        at most 100 characters
 *   response 202 { kept: boolean }       false for a retry of a kept flag
 *
 * WHAT A FLAG NEVER CARRIES: the words, a lesson, a session or a beat. A body
 * with any key outside the six above is refused with a 400, so nothing else
 * can ride along. The verified user id goes to keep_safety_event, which uses
 * it once to find the child's school and does not keep it.
 *
 * ADMITTED LIKE A REPORT: handleRelay dispatches it above the kill switch;
 * admitFree claims zero units and lets it through a halted, capped or budget
 * answer, and still demands a verified sign-in and the per-minute window.
 *
 * NO WEBHOOK. The relay tells nobody; the outside alarm (tools/admin-alert)
 * reads the count of flags received since its previous check (at least the
 * last 15 minutes) and tells the safety chat.
 */

export interface SafetyFlag {
  id: string;
  category: 'distress';
  direction: 'from-student' | 'to-student';
  at: string;
  platform?: 'web' | 'android';
  release?: string;
}

export interface SafetyEventStore {
  /** {fresh} when kept (fresh false for a retry); null when it could not be kept now. */
  keep(userId: string, flag: SafetyFlag): Promise<{ fresh: boolean } | null>;
}

/** A flag is six short fields. Checked before the parse. */
export const MAX_FLAG_BYTES = 1024;

const KEYS = new Set(['id', 'category', 'direction', 'at', 'platform', 'release']);

/** Read a POSTed flag, every rule a 400, in order. */
export function readSafetyFlag(
  body: Uint8Array,
): { ok: true; value: SafetyFlag } | { ok: false; response: RelayResponse } {
  const no = (message: string) => ({ ok: false as const, response: fail(400, message) });
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return no('that is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return no('a flag is an object');
  }
  const f = parsed as Record<string, unknown>;
  if (Object.keys(f).some((k) => !KEYS.has(k))) {
    return no('a flag carries no words: only id, category, direction, at, platform and release');
  }
  if (typeof f.id !== 'string' || !isUuid(f.id)) return no('a flag has a uuid');
  if (f.category !== 'distress') return no("a flag's category is distress");
  if (f.direction !== 'from-student' && f.direction !== 'to-student') {
    return no("a flag's direction is from-student or to-student");
  }
  if (typeof f.at !== 'string' || !Number.isFinite(Date.parse(f.at))) {
    return no('a flag carries the time it was made, as ISO text');
  }
  if (f.platform !== undefined && f.platform !== 'web' && f.platform !== 'android') {
    return no('platform is "web" or "android"');
  }
  if (f.release !== undefined && !isShortText(f.release, 100)) {
    return no('release must be short text');
  }
  return {
    ok: true,
    value: {
      id: f.id,
      category: 'distress',
      direction: f.direction,
      at: f.at,
      ...(f.platform !== undefined ? { platform: f.platform } : {}),
      ...(f.release !== undefined ? { release: f.release as string } : {}),
    },
  };
}

/** The route. Admission first, exactly like a report. */
export async function handleSafetyFlag(req: RelayRequest, deps: HandlerDeps): Promise<RelayResponse> {
  if (req.method !== 'POST') return fail(405, 'POST only');
  if (!deps.safetyEvents) return fail(501, 'this host cannot take a flag');
  if (req.body.byteLength > MAX_FLAG_BYTES) {
    return fail(413, 'that request is larger than any flag this app sends');
  }

  const admitted = await admitFree(req, 'flag', deps.gate);
  if (!admitted.ok) return admitted.response;

  const read = readSafetyFlag(req.body);
  if (!read.ok) return read.response;

  const kept = await deps.safetyEvents.keep(admitted.userId, read.value);
  if (!kept) {
    return fail(503, 'the flag was not kept this second; the app keeps it and sends it again');
  }
  return {
    status: 202,
    headers: { 'content-type': 'application/json' },
    body: { kind: 'json', value: { kept: kept.fresh } },
  };
}

/** Keeps flags in an array, one per id. For the dev server and the tests. */
export function createMemorySafetyEventStore(): SafetyEventStore & { kept: { userId: string; flag: SafetyFlag }[] } {
  const kept: { userId: string; flag: SafetyFlag }[] = [];
  const seen = new Set<string>();
  return {
    kept,
    async keep(userId, flag) {
      if (seen.has(flag.id)) return { fresh: false };
      seen.add(flag.id);
      kept.push({ userId, flag });
      return { fresh: true };
    },
  };
}

/**
 * The deployed store: one call to public.keep_safety_event with the service
 * role. It answers true (kept), false (a retry) or null (too many flags in the
 * last hour); a failed or thrown call is null, so the app keeps the flag.
 */
export function createSupabaseSafetyEventStore(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): SafetyEventStore {
  return {
    async keep(userId, flag) {
      try {
        const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/keep_safety_event`, {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_user: userId,
            p_id: flag.id,
            p_category: flag.category,
            p_direction: flag.direction,
            p_platform: flag.platform ?? null,
            p_release: flag.release ?? null,
            p_at: flag.at,
          }),
        });
        if (!res.ok) return null;
        const answer = (await res.json().catch(() => null)) as unknown;
        if (answer === true) return { fresh: true };
        if (answer === false) return { fresh: false };
        return null;
      } catch {
        return null;
      }
    },
  };
}
