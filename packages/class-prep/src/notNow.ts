/**
 * A REPAIR ROUND THAT HEARS "NOT NOW" ASKS AGAIN, LATER.
 *
 * Respiration, 2026-10-01: the first plan was sent to repair, the repair call
 * came back "Resource exhausted ... error-code-429", and the round was written
 * off — after which the class went on to buy its review and its pictures for a
 * plan nothing had fixed, and the keep gate refused it. The relay already
 * retries a busy Vertex twice, after 1 s and 3 s, with a Retry-After clamped
 * to 5 s (packages/relay/src/vertex.ts), because most of its callers are a
 * student waiting on one answer. A quota that is still exhausted after that
 * needs a longer wait than an interactive call can afford — and a repair round
 * can afford it, because the plan it is repairing is already paid for.
 *
 * So the repair rounds in prepare.ts use this, and so does tools/prewarm, which
 * wraps every model call in it (nothing there is interactive). Nothing
 * interactive does: the relay's own backoff is untouched.
 */

/**
 * How long a repair waits before each further try. Two further tries, the
 * second after a longer wait; together forty seconds, most of a per-minute
 * quota window. These numbers are a judgement, not a measurement — nobody has
 * measured how long Vertex's 429s on this project last (UNVERIFIED).
 */
export const REPAIR_WAITS_MS: readonly number[] = [10_000, 30_000];

/** The most a Retry-After may stretch one wait to. */
export const LONGEST_REPAIR_WAIT_MS = 60_000;

export interface RepairRetry {
  /** Before each further try, in order; its length is how many further tries. Default `REPAIR_WAITS_MS`. */
  waitsMs?: readonly number[];
  /** How to wait. A test passes one that records instead of waiting. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The relay's refusals that are not about this minute. `budget` is the
 * student's day, `capped` is the project's day, `halted` is somebody stopping
 * classes on purpose (packages/relay/src/gate.ts, REFUSALS). Waiting thirty
 * seconds answers none of them.
 */
const NOT_TODAY = new Set(['budget', 'capped', 'halted']);

/**
 * Is this a refusal worth waiting out?
 *
 * A 429 or a 503 with a status on it, and not one of the relay's day-long
 * refusals. Both adapters that reach the relay put the status (and the relay's
 * `reason`, when it gave one) on the error they throw: apps/classroom
 * relayError and tools/prewarm relayAdapters. An error with no status is not
 * known to be a refusal at all, and is not retried.
 */
export function isNotNow(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { status, reason } = e as { status?: unknown; reason?: unknown };
  if (typeof reason === 'string' && NOT_TODAY.has(reason)) return false;
  return status === 429 || status === 503;
}

/** The relay's Retry-After in milliseconds, when the error carries one (prewarm's adapter does). */
function advisedMs(e: unknown): number {
  const seconds = (e as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0;
}

/**
 * Run one repair call, waiting out "not now" a bounded number of times.
 *
 * Each wait is the schedule's, or the relay's Retry-After when that asks for
 * longer, never more than LONGEST_REPAIR_WAIT_MS. Anything that is not a "not
 * now", and the last "not now", is thrown exactly as it came.
 */
export async function askAgainLater<T>(
  call: () => Promise<T>,
  retry: RepairRetry = {},
  onWait?: (ms: number) => void,
): Promise<T> {
  const waits = retry.waitsMs ?? REPAIR_WAITS_MS;
  const sleep = retry.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (e) {
      if (!isNotNow(e) || attempt >= waits.length) throw e;
      const ms = Math.min(Math.max(waits[attempt], advisedMs(e)), LONGEST_REPAIR_WAIT_MS);
      onWait?.(ms);
      await sleep(ms);
    }
  }
}
