// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asService, asUser, createUser, freshDatabase } from './harness';

/**
 * 0101: learner_model keeps the server's snapshot of a learner's model (the
 * model carries its own cursor) and the last event concept_state was built
 * from, so think() folds forward instead of rebuilding (lam-one-brain Task 2b).
 * 0102: purge_old_ledger deletes every answer older than its window by age
 * alone again (Aarav's choice (a)); the snapshot keeps what the fold learned.
 */

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

const orgOf = async (user: string): Promise<string> =>
  (await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [user])).rows[0]
    .org_id;

/** One answer in its own sitting, received `daysAgo` days ago by the server's clock. */
async function oldEvent(user: string, daysAgo: number): Promise<{ event: string; session: string }> {
  const org = await orgOf(user);
  const session = crypto.randomUUID();
  const received = `now() - interval '${daysAgo} days'`;
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at)
     values ($1, $2, $3, 'quiz', ${received}, ${received})`,
    [session, org, user],
  );
  const event = crypto.randomUUID();
  await db.query(
    `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface)
     values ($1, $2, $3, $4, 0, ${received}, ${received}, 'answered', 'quiz', 'tap')`,
    [event, org, user, session],
  );
  return { event, session };
}

const exists = async (table: string, id: string): Promise<boolean> =>
  (await db.query(`select 1 from public.${table} where id = $1`, [id])).rows.length === 1;

describe('0101 learner_model snapshot', () => {
  it('holds a snapshot and the last event the model was built from', async () => {
    const kid = await createUser(db);
    const { event } = await oldEvent(kid, 1);
    await db.query(
      `insert into public.learner_model (user_id, org_id, snapshot, folded_through_received_at, folded_through_id)
       values ($1, $2, '{"model": {"version": 4}}'::jsonb, now(), $3)`,
      [kid, await orgOf(kid), event],
    );
    const { rows } = await db.query<Record<string, unknown>>(
      `select snapshot, folded_through_received_at is not null as received, folded_through_id
         from public.learner_model where user_id = $1`,
      [kid],
    );
    expect(rows[0]).toEqual({ snapshot: { model: { version: 4 } }, received: true, folded_through_id: event });
  });

  it('starts a row with no snapshot, so the first think() rebuilds from the ledger', async () => {
    const kid = await createUser(db);
    await db.query(`insert into public.learner_model (user_id, org_id) values ($1, $2)`, [kid, await orgOf(kid)]);
    const { rows } = await db.query<Record<string, unknown>>(
      `select snapshot, folded_through_received_at, folded_through_id
         from public.learner_model where user_id = $1`,
      [kid],
    );
    expect(rows[0]).toEqual({
      snapshot: null,
      folded_through_received_at: null,
      folded_through_id: null,
    });
  });

  it('lets a student read their own snapshot and never write it', async () => {
    const kid = await createUser(db);
    await db.query(`insert into public.learner_model (user_id, org_id, snapshot) values ($1, $2, '{}'::jsonb)`, [
      kid,
      await orgOf(kid),
    ]);
    const seen = await asUser(db, kid, (tx) =>
      tx.query<{ n: number }>(`select count(*)::int as n from public.learner_model where snapshot is not null`),
    );
    expect(seen.rows[0].n).toBe(1);
    await expect(
      asUser(db, kid, (tx) => tx.query(`update public.learner_model set snapshot = '{"forged": true}'::jsonb`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('0102 the nightly purge deletes by age alone', () => {
  it('drops purge_safe_before: nothing writes it and the purge reads no fold any more', async () => {
    const { rows } = await db.query(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'learner_model' and column_name = 'purge_safe_before'`,
    );
    expect(rows).toEqual([]);
  });

  it('deletes an answer older than the window, though no fold has ever read it', async () => {
    const kid = await createUser(db);
    const old = await oldEvent(kid, 91);
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    expect(await exists('ledger_event', old.event)).toBe(false);
    expect(await exists('learning_session', old.session)).toBe(false);
  });

  it('deletes an answer older than the window whatever the learner model says', async () => {
    const kid = await createUser(db);
    const old = await oldEvent(kid, 200);
    await db.query(
      `insert into public.learner_model (user_id, org_id, folded_through_received_at)
       values ($1, $2, now() - interval '300 days')`,
      [kid, await orgOf(kid)],
    );
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    expect(await exists('ledger_event', old.event)).toBe(false);
  });

  it('GUARD: keeps an answer younger than the window, and its sitting', async () => {
    const kid = await createUser(db);
    const young = await oldEvent(kid, 89);
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    expect(await exists('ledger_event', young.event)).toBe(true);
    expect(await exists('learning_session', young.session)).toBe(true);
  });

  it('never touches the learner model: what the fold learned outlives the answers', async () => {
    const kid = await createUser(db);
    const old = await oldEvent(kid, 120);
    const org = await orgOf(kid);
    await db.query(
      `insert into public.learner_model (user_id, org_id, snapshot, folded_through_received_at)
       values ($1, $2, '{"model": {"version": 4}}'::jsonb, now() - interval '1 hour')`,
      [kid, org],
    );
    await db.query(
      `insert into public.concept_state (org_id, user_id, outcome_id, mastery, unassisted_mastery, assisted_performance)
       values ($1, $2, 'o-kept', 0.9, 0.9, 0.9)`,
      [org, kid],
    );
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    expect(await exists('ledger_event', old.event)).toBe(false);
    const { rows } = await db.query<{ snapshot: unknown; n: number }>(
      `select lm.snapshot, (select count(*)::int from public.concept_state where user_id = $1) as n
         from public.learner_model lm where lm.user_id = $1`,
      [kid],
    );
    expect(rows[0]).toEqual({ snapshot: { model: { version: 4 } }, n: 1 });
  });

  it('is still an operator tool: no student and no anonymous caller can run it', async () => {
    const kid = await createUser(db);
    await expect(asUser(db, kid, (tx) => tx.query(`select public.purge_old_ledger(1)`))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon');
        await tx.query(`select public.purge_old_ledger(1)`);
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
