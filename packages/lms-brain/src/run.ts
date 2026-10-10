import { drainBrainQueue, queueSettleDue, type DrainOptions, type DrainResult } from './drain.ts';
import type { Sql } from './think.ts';

/**
 * ONE RUN OF THE BRAIN, and who may ask for one (lam-one-brain Task 9; review
 * SF3). supabase/functions/brain is the Deno adapter around handleBrain; the
 * demo school's server (tools/lms-demo) calls runBrain on its own timer.
 *
 * A run is the settle pass (drain.ts queueSettleDue: every learner whose
 * snapshot is behind their settled evidence goes on the queue) and then one
 * drain of the queue within its limits (drain.ts drainBrainQueue). Whatever
 * the limits leave waits for the next run.
 */

export interface BrainRun extends DrainResult {
  /** Learners the settle pass put on the queue. */
  settled: number;
}

export async function runBrain(db: Sql, drain: DrainOptions = {}): Promise<BrainRun> {
  const settled = await queueSettleDue(db);
  return { settled, ...(await drainBrainQueue(db, drain)) };
}

export interface BrainCall {
  method: string;
  /** The request's x-brain-secret header, or null without one. */
  secret: string | null;
}

export interface BrainDeps {
  db: Sql;
  /** BRAIN_SECRET as the function was given it; unset or empty refuses every call. */
  secret: string | undefined;
  /** Limits for the drain (drain.ts DRAIN_DEFAULTS when left out). */
  drain?: DrainOptions;
  /** Where the run's one log line goes. */
  log: (line: string) => void;
}

export interface BrainAnswer {
  status: number;
  body: Record<string, unknown>;
}

const utf8 = new TextEncoder();

/** Equal secrets, compared in a time that depends only on their lengths. */
function sameSecret(given: string, expected: string): boolean {
  const a = utf8.encode(given);
  const b = utf8.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

/**
 * The brain function's whole decision. The function is deployed without the
 * platform's JWT check (a schedule has no user), so the shared secret is what
 * stands between the internet and a run: without BRAIN_SECRET set it answers
 * 503 to everyone, and a call without the right x-brain-secret gets 401.
 * Either way nothing is read or written.
 *
 * A run answers and logs its counts and nothing else. A run that fails as a
 * whole (the database cannot be reached, say) answers 500 and logs only that
 * it failed, since a database error's message can carry addresses and values;
 * a single learner's failure is kept in brain_queue.last_error by the drain.
 */
export async function handleBrain(call: BrainCall, deps: BrainDeps): Promise<BrainAnswer> {
  if (!deps.secret) return { status: 503, body: { error: 'The brain is not set up: BRAIN_SECRET is missing.' } };
  if (call.secret === null || !sameSecret(call.secret, deps.secret)) {
    return { status: 401, body: { error: 'Not allowed.' } };
  }
  if (call.method !== 'POST') return { status: 405, body: { error: 'POST only.' } };
  try {
    const run = await runBrain(deps.db, deps.drain);
    const body = { ...run };
    deps.log(JSON.stringify({ brain: body }));
    return { status: 200, body };
  } catch {
    deps.log(JSON.stringify({ brain: 'failed' }));
    return { status: 500, body: { error: 'The brain run failed.' } };
  }
}
