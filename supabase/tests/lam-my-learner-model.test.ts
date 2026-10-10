// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createUser, freshDatabase } from './harness';

/**
 * 0109: public.my_learner_model(), the tutor's one read of the server's model
 * of its learner (lam-one-brain Task 11, review SF4): their concept_state
 * rows and where the brain had read their ledger to when it wrote them, in
 * one statement, so the two cannot come from two different runs of the brain.
 * Run as the real roles: a student's token reads their own model and nobody
 * else's, and an anonymous caller reads nothing.
 */

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

interface Read {
  version: number | null;
  foldedThrough: { at: string; sessionId: string | null; seq: number } | null;
  states: Record<string, unknown>[];
}

const orgOf = async (user: string): Promise<string> =>
  (await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [user])).rows[0].org_id;

const read = (user: string): Promise<Read> =>
  asUser(db, user, async (tx) => (await tx.query<{ m: Read }>(`select public.my_learner_model() as m`)).rows[0].m);

/** One outcome row and the learner_model row the brain writes beside it, with the cursor on a real event. */
async function brainWrote(user: string, outcome: string, mastery: number): Promise<{ session: string; event: string }> {
  const org = await orgOf(user);
  const session = crypto.randomUUID();
  const event = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'quiz', now())`,
    [session, org, user],
  );
  await db.query(
    `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, outcome_ids, payload)
     values ($1, $2, $3, $4, 3, now(), 'answered', 'quiz', 'tap', $5, '{"correct": false}'::jsonb)`,
    [event, org, user, session, [outcome]],
  );
  await db.query(
    `insert into public.concept_state (org_id, user_id, outcome_id, mastery, unassisted_mastery, assisted_performance,
                                       unassisted_observations, box, next_review_at, misconceptions)
     values ($1, $2, $3, $4, $4, 0.5, 2, 1, '2026-10-01T10:00:00.000Z', '{"adds the bottoms": {"count": 2}}'::jsonb)`,
    [org, user, outcome, mastery],
  );
  await db.query(
    `insert into public.learner_model (user_id, org_id, folded_through_at, folded_through_seq, version,
                                       folded_through_received_at, folded_through_id)
     values ($1, $2, '2026-10-09T10:00:00.123Z', 3, 4, '2026-10-09T10:00:00.123456Z', $3)`,
    [user, org, event],
  );
  return { session, event };
}

describe('0109 my_learner_model', () => {
  it('hands a learner their own rows and the cursor the brain wrote them at', async () => {
    const kid = await createUser(db);
    const other = await createUser(db);
    const { session } = await brainWrote(kid, 'o-mine', 0.25);
    await brainWrote(other, 'o-theirs', 0.75);

    const m = await read(kid);
    expect(m.version).toBe(4);
    expect(m.foldedThrough).toEqual({ at: expect.any(String), sessionId: session, seq: 3 });
    expect(Date.parse(m.foldedThrough!.at)).toBe(Date.parse('2026-10-09T10:00:00.123Z'));
    expect(m.states).toHaveLength(1);
    expect(m.states[0]).toMatchObject({
      outcome_id: 'o-mine',
      mastery: 0.25,
      unassisted_observations: 2,
      box: 1,
      misconceptions: { 'adds the bottoms': { count: 2 } },
    });
    expect(Date.parse(m.states[0].next_review_at as string)).toBe(Date.parse('2026-10-01T10:00:00.000Z'));
    // Whose rows they are is the token's, and is not handed back.
    expect(m.states[0]).not.toHaveProperty('user_id');
    expect(m.states[0]).not.toHaveProperty('org_id');
  });

  it('says the brain has not read a learner it never thought about', async () => {
    const kid = await createUser(db);
    expect(await read(kid)).toEqual({ version: null, foldedThrough: null, states: [] });
  });

  it('keeps the cursor when the event it names has been purged, without its sitting', async () => {
    const kid = await createUser(db);
    const { event } = await brainWrote(kid, 'o-purged', 0.4);
    await db.query(`delete from public.ledger_event where id = $1`, [event]);
    expect((await read(kid)).foldedThrough).toEqual({ at: expect.any(String), sessionId: null, seq: 3 });
  });

  it('cannot be run by an anonymous caller', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon');
        await tx.query(`select public.my_learner_model()`);
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
