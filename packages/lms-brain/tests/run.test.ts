// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { handleBrain, runBrain, type Sql } from '../src/index.ts';

/**
 * THE BRAIN FUNCTION'S DECISIONS (lam-one-brain Task 9; review SF3).
 *
 * supabase/functions/brain is a Deno adapter around handleBrain: it hands
 * over the request's method and x-brain-secret header, the BRAIN_SECRET it
 * was given and a database. Everything that decides anything is here, on the
 * real migrations: who may run the brain, what one run does (the settle pass,
 * then a drain within its limits) and that only counts leave it.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const SECRET = 'a-long-random-brain-secret-for-tests';

let db: PGlite;
let logged: string[];

const deps = (over: Partial<Parameters<typeof handleBrain>[1]> = {}) => ({
  db: db as unknown as Sql,
  secret: SECRET,
  log: (line: string) => void logged.push(line),
  ...over,
});

async function answers(user: string, n = 1, hoursAgo = 0): Promise<void> {
  const org = (await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [user]))
    .rows[0].org_id;
  const session = crypto.randomUUID();
  const at = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at)
     values ($1, $2, $3, 'quiz', $4, $4)`,
    [session, org, user, at],
  );
  await db.query(
    `insert into public.ledger_event
       (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, payload)
     select gen_random_uuid(), $1, $2, $3, g, $4, $4, 'answered', 'quiz', 'tap', array[$5],
            jsonb_build_object('correct', true, 'chosenIndex', 0, 'probeId', 'p-run-' || g, 'attempt', 1,
                               'assistanceRung', 0)
       from generate_series(1, $6::int) g`,
    [org, user, session, at, DEFINE, n],
  );
}

const queued = async (): Promise<number> =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.brain_queue`)).rows[0].n;

const statesOf = async (user: string): Promise<number> =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.concept_state where user_id = $1`, [user]))
    .rows[0].n;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  logged = [];
  await db.query(`delete from public.brain_queue`);
});

describe('who may run the brain', () => {
  it('refuses every call while BRAIN_SECRET is not set, and touches nothing', async () => {
    const kid = await createUser(db);
    await answers(kid);
    for (const secret of [undefined, '']) {
      const r = await handleBrain({ method: 'POST', secret: SECRET }, deps({ secret }));
      expect(r.status).toBe(503);
    }
    expect(await queued()).toBe(1);
    expect(await statesOf(kid)).toBe(0);
  });

  it('turns away a call without the secret, or with the wrong one, and touches nothing', async () => {
    const kid = await createUser(db);
    await answers(kid);
    for (const secret of [null, '', 'wrong', `${SECRET}x`, SECRET.slice(0, -1)]) {
      const r = await handleBrain({ method: 'POST', secret }, deps());
      expect(r.status, String(secret)).toBe(401);
    }
    expect(await queued()).toBe(1);
    expect(await statesOf(kid)).toBe(0);
    expect(logged).toEqual([]);
  });

  it('answers only POST', async () => {
    const r = await handleBrain({ method: 'GET', secret: SECRET }, deps());
    expect(r.status).toBe(405);
  });
});

describe('one run of the brain', () => {
  it('thinks about everyone queued, and answers and logs counts only', async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    await answers(a, 2);
    await answers(b, 1);
    const r = await handleBrain({ method: 'POST', secret: SECRET }, deps());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ settled: 0, thought: 2, events: 3, failed: 0, busy: 0, waiting: 0, stuck: 0 });
    expect(await queued()).toBe(0);
    expect(await statesOf(a)).toBeGreaterThan(0);
    expect(await statesOf(b)).toBeGreaterThan(0);
    expect(logged).toHaveLength(1);
    for (const user of [a, b]) expect(logged[0]).not.toContain(user);
    expect(JSON.parse(logged[0])).toEqual({ brain: r.body });
  });

  it('runs the settle pass first, so a learner whose snapshot is behind is thought about again', async () => {
    const kid = await createUser(db);
    await answers(kid, 1, 2);
    await db.query(`delete from public.brain_queue`);
    const r = await runBrain(db as unknown as Sql);
    expect(r).toMatchObject({ settled: 1, thought: 1, events: 1, waiting: 0 });
    const { rows } = await db.query<{ through: string | null }>(
      `select snapshot #>> '{model,foldedThrough,at}' as through from public.learner_model where user_id = $1`,
      [kid],
    );
    expect(rows[0].through).not.toBeNull();
    expect(await runBrain(db as unknown as Sql)).toMatchObject({ settled: 0, thought: 0 });
  });

  it("keeps to the drain's limits and leaves the rest queued for the next run", async () => {
    for (let i = 0; i < 3; i++) await answers(await createUser(db));
    const r = await handleBrain({ method: 'POST', secret: SECRET }, deps({ drain: { maxLearners: 2 } }));
    expect(r.body).toMatchObject({ thought: 2, waiting: 1 });
    expect(await queued()).toBe(1);
  });

  it('says only that the run failed when the database does, and logs no message from it', async () => {
    const broken = {
      query: async () => {
        throw new Error('connection to 10.0.0.1 failed for user 0d9c-secret-detail');
      },
      transaction: async () => {
        throw new Error('unreachable');
      },
    } as unknown as Sql;
    const r = await handleBrain({ method: 'POST', secret: SECRET }, deps({ db: broken }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('10.0.0.1');
    expect(logged.join('\n')).not.toContain('10.0.0.1');
    expect(logged.join('\n')).not.toContain('secret-detail');
  });
});
