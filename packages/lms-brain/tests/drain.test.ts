// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import {
  INTERRUPTED,
  MAX_ATTEMPTS,
  THINK_STATEMENT_TIMEOUT_MS,
  drainBrainQueue,
  queueSettleDue,
  think,
  type Sql,
  type Tx,
} from '../src/index.ts';

/**
 * THE BRAIN RUNS BY ITSELF (lam-one-brain Task 9; review MF9, MF11, SF3).
 *
 * An answer puts its learner on public.brain_queue (0108); drainBrainQueue
 * thinks about each queued learner in their own transaction and takes them
 * off only if nothing new arrived meanwhile. PGlite runs one query at a time,
 * so what two drains at once do is checked on a real Postgres in
 * think.pg.test.ts (skipped without LAM_PG_URL); here the same SQL runs one
 * drain at a time, and the moments in between are staged through the
 * transaction itself.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';

let db: PGlite;

const orgOf = async (user: string): Promise<string> =>
  (await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [user])).rows[0]
    .org_id;

const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

/** One quiz sitting of `n` right answers on DEFINE, received at `receivedAt`, written in one statement. */
async function answers(user: string, n = 1, receivedAt = ago(0)): Promise<void> {
  const session = crypto.randomUUID();
  const org = await orgOf(user);
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at)
     values ($1, $2, $3, 'quiz', $4, $4)`,
    [session, org, user, receivedAt],
  );
  await db.query(
    `insert into public.ledger_event
       (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, payload)
     select gen_random_uuid(), $1, $2, $3, g, $4, $4, 'answered', 'quiz', 'tap', array[$5],
            jsonb_build_object('correct', true, 'chosenIndex', 0, 'probeId', 'p-drain-' || g, 'attempt', 1,
                               'assistanceRung', 0)
       from generate_series(1, $6::int) g`,
    [org, user, session, receivedAt, DEFINE, n],
  );
}

const queued = async (): Promise<string[]> =>
  (await db.query<{ user_id: string }>(`select user_id from public.brain_queue order by enqueued_at, user_id`)).rows.map(
    (r) => r.user_id,
  );

const states = async (user: string) =>
  (
    await db.query<{ row: Record<string, unknown> }>(
      `select to_jsonb(cs) - 'updated_at' as row from public.concept_state cs where user_id = $1 order by outcome_id`,
      [user],
    )
  ).rows.map((r) => r.row);

/**
 * The database, with `before` run inside each learner's transaction just
 * ahead of the first query whose text matches `at`.
 */
function staged(at: RegExp, before: (tx: Tx) => Promise<void>): Sql {
  const wrap = (tx: Tx): Tx => ({
    query: async <R>(text: string, params?: unknown[]) => {
      if (at.test(text)) await before(tx);
      return tx.query<R>(text, params);
    },
  });
  return {
    query: (text, params) => db.query(text, params),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx as unknown as Tx))),
  } as Sql;
}

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query(`delete from public.brain_queue`);
});

describe('draining the brain queue', () => {
  it('thinks about a learner an answer queued, and takes them off the queue', async () => {
    const kid = await createUser(db);
    await answers(kid, 2);
    expect(await queued()).toEqual([kid]);
    expect(await states(kid)).toEqual([]);

    const r = await drainBrainQueue(db);
    expect(r).toMatchObject({ thought: 1, events: 2, failed: 0, busy: 0, waiting: 0, stuck: 0 });
    expect(await queued()).toEqual([]);
    expect((await states(kid)).find((r) => r.outcome_id === DEFINE)).toMatchObject({ outcome_id: DEFINE, answer_observations: 2 });
  });

  it('lands where think() lands, and a second drain finds nothing to do', async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    await answers(a, 3);
    await answers(b, 1);
    await drainBrainQueue(db);
    const drained = [await states(a), await states(b)];

    await think(db, [a, b], { rebuild: true });
    expect([await states(a), await states(b)]).toEqual(drained);

    expect(await drainBrainQueue(db)).toMatchObject({ thought: 0, events: 0, waiting: 0 });
    expect([await states(a), await states(b)]).toEqual(drained);
  });

  it('keeps a learner queued when an answer lands while the brain is thinking about them', async () => {
    const kid = await createUser(db);
    await answers(kid, 1);
    const org = await orgOf(kid);
    let landed = false;
    // The new answer commits after think() read the ledger and before the row
    // is deleted.
    const racing = staged(/^\s*delete from public\.brain_queue/, async (tx) => {
      if (landed) return;
      landed = true;
      const session = crypto.randomUUID();
      await tx.query(
        `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'quiz', now())`,
        [session, org, kid],
      );
      await tx.query(
        `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
         values (gen_random_uuid(), $1, $2, $3, 1, now(), 'answered', 'quiz', 'tap', array[$4],
                 '{"correct": false, "chosenIndex": 2, "probeId": "p-late", "attempt": 1, "assistanceRung": 0}'::jsonb)`,
        [org, kid, session, DEFINE],
      );
    });
    expect(await drainBrainQueue(racing)).toMatchObject({ thought: 1, events: 1, waiting: 1 });
    expect(landed).toBe(true);
    expect(await queued()).toEqual([kid]);

    // The next run folds the answer that landed (and reads the first again:
    // the snapshot stays an hour behind, think.ts).
    expect(await drainBrainQueue(db)).toMatchObject({ thought: 1, events: 2, waiting: 0 });
    expect(await queued()).toEqual([]);
    expect((await states(kid)).find((r) => r.outcome_id === DEFINE)).toMatchObject({ answer_observations: 2 });
  });

  it('leaves a learner another drain has already taken off the queue', async () => {
    const kid = await createUser(db);
    await answers(kid, 1);
    const other = staged(/pg_try_advisory_xact_lock/, async (tx) => {
      await tx.query(`delete from public.brain_queue where user_id = $1`, [kid]);
    });
    expect(await drainBrainQueue(other)).toMatchObject({ thought: 0, events: 0 });
    expect(await states(kid)).toEqual([]);
  });

  it('takes at most maxLearners, the longest waiting first, and leaves the rest queued', async () => {
    const kids = [await createUser(db), await createUser(db), await createUser(db)];
    for (const k of kids) await answers(k, 1);
    expect(await drainBrainQueue(db, { maxLearners: 2 })).toMatchObject({ thought: 2, waiting: 1 });
    expect(await queued()).toEqual([kids[2]]);
    await drainBrainQueue(db);
    expect(await queued()).toEqual([]);
  });

  it('starts no new learner once maxMs has passed, but always the first', async () => {
    const kids = [await createUser(db), await createUser(db)];
    for (const k of kids) await answers(k, 1);
    expect(await drainBrainQueue(db, { maxMs: 0 })).toMatchObject({ thought: 1, waiting: 1 });
    expect(await queued()).toEqual([kids[1]]);
  });

  it('counts a learner it failed on, carries on with the rest, and stops trying after MAX_ATTEMPTS', async () => {
    const bad = await createUser(db);
    const good = await createUser(db);
    await answers(bad, 1);
    await answers(good, 1);
    // Only the bad learner's ledger read fails; nothing of theirs is written.
    const breaking = (user: string): Sql => {
      const wrap = (tx: Tx): Tx => ({
        query: async <R>(text: string, params?: unknown[]) => {
          if (/from public\.ledger_event e/.test(text) && params?.[0] === user) throw new Error('the fold broke');
          return tx.query<R>(text, params);
        },
      });
      return {
        query: (text, params) => db.query(text, params),
        transaction: (fn) => db.transaction((tx) => fn(wrap(tx as unknown as Tx))),
      } as Sql;
    };

    expect(await drainBrainQueue(breaking(bad))).toMatchObject({ thought: 1, failed: 1, waiting: 1, stuck: 0 });
    expect((await states(good)).length).toBeGreaterThan(0);
    expect(await states(bad)).toEqual([]);
    const row = async () =>
      (
        await db.query<{ attempts: number; last_error: string | null }>(
          `select attempts, last_error from public.brain_queue where user_id = $1`,
          [bad],
        )
      ).rows[0];
    expect(await row()).toEqual({ attempts: 1, last_error: 'the fold broke' });

    for (let n = 2; n <= MAX_ATTEMPTS; n++) await drainBrainQueue(breaking(bad));
    expect((await row()).attempts).toBe(MAX_ATTEMPTS);
    // Skipped now, even by a drain that would succeed, until a new answer.
    expect(await drainBrainQueue(db)).toMatchObject({ thought: 0, failed: 0, waiting: 0, stuck: 1 });
    await answers(bad, 1);
    expect(await drainBrainQueue(db)).toMatchObject({ thought: 1, failed: 0, stuck: 0 });
    expect(await queued()).toEqual([]);
  });
});

/**
 * F2 (P2 security review): one learner who keeps answering, or whose think is
 * slow or killed, must not hold every other learner back.
 */
describe('one learner cannot starve the queue (F2)', () => {
  /** The database, with `during` run inside a learner's transaction just before their row is taken off. */
  function duringThink(during: (tx: Tx, user: string) => Promise<void>): Sql {
    const wrap = (tx: Tx): Tx => ({
      query: async <R>(text: string, params?: unknown[]) => {
        if (/^\s*delete from public\.brain_queue/.test(text)) await during(tx, String(params?.[0]));
        return tx.query<R>(text, params);
      },
    });
    return {
      query: (text, params) => db.query(text, params),
      transaction: (fn) => db.transaction((tx) => fn(wrap(tx as unknown as Tx))),
    } as Sql;
  }

  /** A new answer of `user`'s, landing inside the brain's transaction: it takes a new ticket. */
  async function lands(tx: Tx, user: string): Promise<void> {
    const session = crypto.randomUUID();
    // Read inside the transaction: PGlite has one connection, and the brain holds it.
    const org = (await tx.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [user]))
      .rows[0].org_id;
    await tx.query(
      `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'quiz', now())`,
      [session, org, user],
    );
    await tx.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
       values (gen_random_uuid(), $1, $2, $3, 1, now(), 'answered', 'quiz', 'tap', array[$4],
               '{"correct": true, "chosenIndex": 0, "probeId": "p-again", "attempt": 1, "assistanceRung": 0}'::jsonb)`,
      [org, user, session, DEFINE],
    );
  }

  it('a learner who answers while being thought about goes to the back, so the next is reached', async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    await answers(a, 1, ago(0));
    await answers(b, 1, ago(0));
    await db.query(`update public.brain_queue set enqueued_at = now() - interval '1 minute' where user_id = $1`, [a]);
    const keepsAnswering = duringThink(async (tx, user) => {
      if (user === a) await lands(tx, a);
    });
    for (let run = 0; run < 3; run++) await drainBrainQueue(keepsAnswering, { maxMs: 0 });
    expect((await states(b)).length).toBeGreaterThan(0);
    expect(await queued()).toContain(a);
  });

  it('counts a run before it thinks, so a run killed mid-think still counts, and clears it when it finishes', async () => {
    const kid = await createUser(db);
    await answers(kid, 1);
    let during: { attempts: number; last_error: string | null } | undefined;
    const watching = duringThink(async (tx, user) => {
      if (user !== kid) return;
      during = (
        await tx.query<{ attempts: number; last_error: string | null }>(
          `select attempts, last_error from public.brain_queue where user_id = $1`,
          [kid],
        )
      ).rows[0];
      await lands(tx, kid);
    });
    await drainBrainQueue(watching);
    expect(during).toEqual({ attempts: 1, last_error: INTERRUPTED });
    // It finished, so the count is cleared, and the answer that landed keeps them queued.
    const { rows } = await db.query<{ attempts: number; last_error: string | null }>(
      `select attempts, last_error from public.brain_queue where user_id = $1`,
      [kid],
    );
    expect(rows[0]).toEqual({ attempts: 0, last_error: null });
  });

  it('a new answer does not wipe the count of a run that never finished', async () => {
    const kid = await createUser(db);
    await answers(kid, 1);
    // As a run killed mid-think leaves it.
    await db.query(`update public.brain_queue set attempts = 3, last_error = $2 where user_id = $1`, [kid, INTERRUPTED]);
    await answers(kid, 1);
    const { rows } = await db.query<{ attempts: number }>(`select attempts from public.brain_queue where user_id = $1`, [kid]);
    expect(rows[0].attempts).toBe(3);
    // An ordinary failure is still forgiven by a new answer.
    await db.query(`update public.brain_queue set attempts = 3, last_error = 'the fold broke' where user_id = $1`, [kid]);
    await answers(kid, 1);
    const { rows: after } = await db.query<{ attempts: number }>(`select attempts from public.brain_queue where user_id = $1`, [kid]);
    expect(after[0].attempts).toBe(0);
  });

  it('thinks about each learner under a statement timeout, so a slow one fails as an error the drain can count', async () => {
    const kid = await createUser(db);
    await answers(kid, 1);
    let timeout: string | undefined;
    const watching = duringThink(async (tx, user) => {
      if (user !== kid) return;
      // In milliseconds, however Postgres prints it.
      timeout = (
        await tx.query<{ t: string }>(
          `select (extract(epoch from current_setting('statement_timeout')::interval) * 1000)::bigint::text as t`,
        )
      ).rows[0].t;
    });
    await drainBrainQueue(watching);
    expect(timeout).toBe(String(THINK_STATEMENT_TIMEOUT_MS));
  });
});

describe('the settle pass, through the queue', () => {
  it('queues every learner whose snapshot is behind their settled evidence, and the drain settles them', async () => {
    const kid = await createUser(db);
    await answers(kid, 1);
    await drainBrainQueue(db);
    const snapshotHas = async () =>
      (
        await db.query<{ through: string | null }>(
          `select snapshot #>> '{model,foldedThrough,at}' as through from public.learner_model where user_id = $1`,
          [kid],
        )
      ).rows[0]?.through ?? null;
    // Straight after the answer, the snapshot does not hold it.
    expect(await snapshotHas()).toBeNull();
    expect(await queueSettleDue(db)).toBe(0);

    // Two hours later, as far as the server's clock is concerned.
    await db.query(`update public.ledger_event set received_at = received_at - interval '2 hours' where user_id = $1`, [kid]);
    await db.query(`update public.learning_session set received_at = received_at - interval '2 hours' where user_id = $1`, [kid]);
    expect(await queueSettleDue(db)).toBe(1);
    expect(await queued()).toEqual([kid]);
    await drainBrainQueue(db);
    expect(await snapshotHas()).not.toBeNull();
    expect(await queueSettleDue(db)).toBe(0);
  });

  it('does not reset a learner the drain has given up on', async () => {
    const kid = await createUser(db);
    await answers(kid, 1, ago(3));
    await db.query(`update public.brain_queue set attempts = $2 where user_id = $1`, [kid, MAX_ATTEMPTS]);
    expect(await queueSettleDue(db)).toBe(0);
    const { rows } = await db.query<{ attempts: number }>(`select attempts from public.brain_queue where user_id = $1`, [kid]);
    expect(rows[0].attempts).toBe(MAX_ATTEMPTS);
  });
});
