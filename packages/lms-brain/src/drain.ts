import { emptyParams } from '@ai-tutor/knowledge-graph';
import { libraryIndex } from './graph.ts';
import { SETTLE_DUE, thinkLearner, type Sql, type ThinkOptions } from './think.ts';

/**
 * THE BRAIN RUNS BY ITSELF (lam-one-brain Task 9; review MF11, SF3).
 *
 * Every answer puts its learner on public.brain_queue (0108). A drain reads a
 * batch of queued learners, the longest waiting first, without locking a row,
 * and then, for each, in that learner's own transaction:
 *
 *   1. takes the learner's lock if nobody holds it (pg_try_advisory_xact_lock
 *      on the key think.ts locks on); if another run holds it, the learner is
 *      left queued for that run or the next;
 *   2. reads the learner's ticket again; a learner another run has already
 *      taken off is left alone;
 *   3. thinks (think.ts thinkLearner), under a statement timeout of
 *      THINK_STATEMENT_TIMEOUT_MS, so one learner's slow query fails as an
 *      error this drain counts rather than running the whole function out;
 *   4. deletes the row only if its ticket is still the one read in step 2.
 *      An answer that lands during step 3 takes a new ticket (0108), so its
 *      learner stays queued and the next run folds it; they go to the BACK
 *      of the queue (enqueued_at = now()), so a learner who keeps answering
 *      while being thought about cannot stay first in every batch and keep
 *      everyone behind them waiting (P2 security review F2).
 *
 * No row lock is held while thinking, so a hand-in's enqueue never waits for
 * the brain; at most step 4 waits for a hand-in that is committing.
 *
 * A TRY IS COUNTED BEFORE IT IS MADE (F2). Before step 1 the learner's
 * attempts go up by one and last_error says INTERRUPTED, in a statement of
 * its own that commits; a think that finishes clears both (or deletes the
 * row). So a run the platform kills mid-think, which never reaches a catch,
 * still counts, and a new answer does not wipe that count, nor one for a
 * statement timeout (0119): a learner whose think keeps being killed or
 * timing out is skipped after MAX_ATTEMPTS. A think that fails with another
 * error is rolled back and keeps the error in last_error; a new answer
 * gives that learner a fresh start, because new evidence may be what the
 * fold needed. The rest of the batch carries on either way. A run takes at
 * most `maxLearners`, and starts no new learner once `maxMs` has passed (the
 * first is always started), so whatever is left waits for the next run.
 *
 * It returns counts only, and the brain function logs only those: a failing
 * learner's error is kept in brain_queue.last_error, not in a log.
 */

/**
 * A learner the drain has failed on this many times is skipped until a new
 * answer, or, when the tries were killed or timed out, until someone resets
 * them.
 */
export const MAX_ATTEMPTS = 5;

/**
 * last_error while a try is under way, and after one that never finished
 * (the run was killed). 0119's enqueue keeps the count of a learner left so.
 */
export const INTERRUPTED = 'interrupted: the run ended before this think finished';

/** The statement timeout one learner's think runs under, in milliseconds. */
export const THINK_STATEMENT_TIMEOUT_MS = 20_000;

/** A failure for running out of time is kept in last_error with this prefix, so 0119's enqueue keeps the count. */
const TIMED_OUT = 'timeout: ';

/** The length a failure's message is cut to in brain_queue.last_error. */
const ERROR_CHARS = 500;

export interface DrainOptions extends Omit<ThinkOptions, 'rebuild'> {
  /** At most this many learners in one run (default 200; Infinity for all). */
  maxLearners?: number;
  /** Start no new learner after this many milliseconds (default 1000; Infinity for no limit). */
  maxMs?: number;
}

export interface DrainResult {
  /** Learners thought about and taken off the queue (or kept on it, when an answer landed meanwhile). */
  thought: number;
  /** Ledger events those runs read. */
  events: number;
  /** Learners whose think failed in this run. */
  failed: number;
  /** Learners skipped because another run held their lock. */
  busy: number;
  /** Learners still queued after this run, MAX_ATTEMPTS failures excepted. */
  waiting: number;
  /** Learners queued but skipped for having failed MAX_ATTEMPTS times. */
  stuck: number;
}

export const DRAIN_DEFAULTS = { maxLearners: 200, maxMs: 1000 } as const;

export async function drainBrainQueue(db: Sql, opts: DrainOptions = {}): Promise<DrainResult> {
  const started = Date.now();
  const maxLearners = opts.maxLearners ?? DRAIN_DEFAULTS.maxLearners;
  const maxMs = opts.maxMs ?? DRAIN_DEFAULTS.maxMs;
  const index = opts.index ?? libraryIndex();
  const params = opts.params ?? emptyParams();
  const { rows: batch } = await db.query<{ user_id: string }>(
    `select user_id from public.brain_queue
      where attempts < $1
      order by enqueued_at, user_id
      limit $2`,
    [MAX_ATTEMPTS, Number.isFinite(maxLearners) ? Math.max(0, Math.floor(maxLearners)) : null],
  );

  const out: DrainResult = { thought: 0, events: 0, failed: 0, busy: 0, waiting: 0, stuck: 0 };
  for (const [i, { user_id: user }] of batch.entries()) {
    if (i > 0 && Date.now() - started >= maxMs) break;
    // Counted before it is tried, in its own statement (see the top of this file).
    const { rows: before } = await db.query<{ last_error: string | null }>(
      `update public.brain_queue q set attempts = q.attempts + 1, last_error = $2
         from (select last_error from public.brain_queue where user_id = $1) was
        where q.user_id = $1 and q.attempts < $3
        returning was.last_error`,
      [user, INTERRUPTED, MAX_ATTEMPTS],
    );
    if (before.length === 0) continue;
    try {
      const read = await db.transaction(async (tx) => {
        const { rows: lock } = await tx.query<{ ok: boolean }>(
          `select pg_try_advisory_xact_lock(hashtext($1::text)) as ok`,
          [user],
        );
        if (!lock[0]?.ok) return 'busy' as const;
        const { rows: held } = await tx.query<{ ticket: string }>(
          `select ticket::text as ticket from public.brain_queue where user_id = $1`,
          [user],
        );
        if (held.length === 0) return 'gone' as const;
        await tx.query(`select set_config('statement_timeout', $1, true)`, [`${THINK_STATEMENT_TIMEOUT_MS}ms`]);
        const n = await thinkLearner(tx, user, { index, params });
        const { rows: taken } = await tx.query<{ user_id: string }>(
          `delete from public.brain_queue where user_id = $1 and ticket = $2::bigint returning user_id`,
          [user, held[0].ticket],
        );
        // An answer landed meanwhile: still queued, at the back, with this try done.
        if (taken.length === 0) {
          await tx.query(
            `update public.brain_queue set enqueued_at = now(), attempts = 0, last_error = null where user_id = $1`,
            [user],
          );
        }
        return n;
      });
      if (read === 'busy') {
        out.busy += 1;
        // Not tried: another run holds them, so this run's count is taken back.
        await db.query(
          `update public.brain_queue set attempts = greatest(attempts - 1, 0), last_error = $2
            where user_id = $1 and last_error = $3`,
          [user, before[0].last_error, INTERRUPTED],
        );
      } else if (read !== 'gone') {
        out.thought += 1;
        out.events += read;
      }
    } catch (e) {
      out.failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      const timedOut = (e as { code?: unknown } | null)?.code === '57014';
      await db.query(`update public.brain_queue set last_error = left($2, $3) where user_id = $1`, [
        user,
        timedOut ? TIMED_OUT + message : message,
        ERROR_CHARS,
      ]);
    }
  }

  const { rows: left } = await db.query<{ waiting: number; stuck: number }>(
    `select count(*) filter (where attempts < $1)::int as waiting,
            count(*) filter (where attempts >= $1)::int as stuck
       from public.brain_queue`,
    [MAX_ATTEMPTS],
  );
  out.waiting = left[0]?.waiting ?? 0;
  out.stuck = left[0]?.stuck ?? 0;
  return out;
}

/**
 * The settle pass (think.ts settleDue), through the queue: puts every learner
 * whose snapshot is behind their settled evidence on brain_queue, so the
 * drain's limits apply to them too. A learner already queued is left as they
 * are, a stuck one included. Returns how many it added.
 */
export async function queueSettleDue(db: Sql): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `with due as (${SETTLE_DUE.sql}),
          added as (
            insert into public.brain_queue (user_id)
            select user_id from due
            on conflict (user_id) do nothing
            returning 1)
     select count(*)::int as n from added`,
    SETTLE_DUE.params(),
  );
  return rows[0]?.n ?? 0;
}
