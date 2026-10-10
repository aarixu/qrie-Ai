// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from './fixtures';
import { asUser, freshDatabase } from './harness';

/**
 * 0068: public.brain_queue, the list of learners the brain has to think about
 * again (lam-one-brain Task 9; review MF10, MF11, SF3).
 *
 * Every insert into ledger_event, whoever makes it, puts its learners on the
 * queue; packages/lms-brain drainBrainQueue takes them off. Nobody but the
 * database owner and the service role can see or touch the queue.
 */

let db: PGlite;
let school: School;

beforeAll(async () => {
  db = await freshDatabase();
  school = await buildSchool(db, 'BRQ');
});
afterAll(async () => {
  await db.close();
});

interface Queued {
  user_id: string;
  enqueued_at: Date;
  ticket: string;
  attempts: number;
  last_error: string | null;
}

const queued = async (user: string): Promise<Queued | undefined> =>
  (await db.query<Queued>(`select * from public.brain_queue where user_id = $1`, [user])).rows[0];

const clear = () => db.query(`delete from public.brain_queue`);

/** A sitting and `n` answers in it, inserted by the owner in one statement. */
async function answers(user: string, n: number, session = crypto.randomUUID()): Promise<string> {
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at)
     values ($1, $2, $3, 'quiz', now()) on conflict do nothing`,
    [session, school.org, user],
  );
  await db.query(
    `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, payload)
     select gen_random_uuid(), $1, $2, $3, coalesce((select max(seq) from public.ledger_event where session_id = $3), 0) + g,
            now(), 'answered', 'quiz', 'tap', '{"correct": true}'::jsonb
       from generate_series(1, $4::int) g`,
    [school.org, user, session, n],
  );
  return session;
}

const sql = (role: 'anon' | 'authenticated', user: string | null, text: string) =>
  db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    if (user) await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    return tx.query(text);
  });

describe('0068 brain_queue', () => {
  it('puts the learner on the queue when an answer is written', async () => {
    await clear();
    await answers(school.kid8a, 1);
    const q = await queued(school.kid8a);
    expect(q).toBeDefined();
    expect(q!.attempts).toBe(0);
    expect(q!.last_error).toBeNull();
  });

  it('queues each learner once for a statement that writes many answers for several of them', async () => {
    await clear();
    const s1 = crypto.randomUUID();
    const s2 = crypto.randomUUID();
    for (const [s, u] of [[s1, school.kid8a], [s2, school.kid8b]] as const) {
      await db.query(
        `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'quiz', now())`,
        [s, school.org, u],
      );
    }
    await db.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, payload)
       select gen_random_uuid(), $1, case when g % 2 = 0 then $2::uuid else $3::uuid end,
              case when g % 2 = 0 then $4::uuid else $5::uuid end, g, now(), 'answered', 'quiz', 'tap', '{}'::jsonb
         from generate_series(1, 10) g`,
      [school.org, school.kid8a, school.kid8b, s1, s2],
    );
    const { rows } = await db.query<{ user_id: string }>(`select user_id from public.brain_queue order by user_id`);
    expect(rows.map((r) => r.user_id).sort()).toEqual([school.kid8a, school.kid8b].sort());
  });

  it('moves a queued learner on with every new answer, and gives a learner the brain failed on a fresh start', async () => {
    await clear();
    const session = await answers(school.kid8a, 1);
    const first = (await queued(school.kid8a))!;
    await db.query(`update public.brain_queue set attempts = 5, last_error = 'boom' where user_id = $1`, [school.kid8a]);
    await answers(school.kid8a, 1, session);
    const second = (await queued(school.kid8a))!;
    expect(BigInt(second.ticket)).toBeGreaterThan(BigInt(first.ticket));
    expect(second.attempts).toBe(0);
    expect(second.last_error).toBeNull();
  });

  it("queues a student's own answer though the student cannot touch the queue (record_evidence, and the direct insert 7b closes)", async () => {
    await clear();
    const session = crypto.randomUUID();
    const result = await asUser(db, school.kid8b, async (tx) =>
      (
        await tx.query<{ status: string }>(`select status from public.record_evidence($1::jsonb, $2::jsonb)`, [
          JSON.stringify([{ id: session, source: 'class', startedAt: new Date().toISOString() }]),
          JSON.stringify([
            {
              id: crypto.randomUUID(),
              sessionId: session,
              seq: 1,
              at: new Date().toISOString(),
              kind: 'answered',
              source: 'class',
              surface: 'tap',
              outcomeIds: [],
              payload: { correct: true, attempt: 1, assistanceRung: 0 },
            },
          ]),
        ])
      ).rows,
    );
    expect(result.map((r) => r.status)).toEqual(['recorded']);
    expect(await queued(school.kid8b)).toBeDefined();

    await clear();
    const own = crypto.randomUUID();
    await asUser(db, school.kid8a, async (tx) => {
      await tx.query(
        `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'quiz', now())`,
        [own, school.org, school.kid8a],
      );
      await tx.query(
        `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, payload)
         values (gen_random_uuid(), $1, $2, $3, 1, now(), 'answered', 'quiz', 'tap', '{}'::jsonb)`,
        [school.org, school.kid8a, own],
      );
    });
    expect(await queued(school.kid8a)).toBeDefined();
  });

  it('is shut to anon and to a signed-in student: no reading, adding, changing or removing', async () => {
    await clear();
    await answers(school.kid8a, 1);
    for (const [role, user] of [['anon', null], ['authenticated', school.kid8a]] as const) {
      for (const text of [
        `select * from public.brain_queue`,
        `insert into public.brain_queue (user_id) values ('${school.kid8b}')`,
        `update public.brain_queue set attempts = 0`,
        `delete from public.brain_queue`,
      ]) {
        await expect(sql(role, user, text), `${role}: ${text}`).rejects.toThrow(/permission denied/);
      }
    }
    expect(await queued(school.kid8a)).toBeDefined();
  });

  it('keeps row security on, and the trigger function out of reach of the API roles', async () => {
    const { rows } = await db.query<{ rls: boolean }>(
      `select relrowsecurity as rls from pg_class where oid = 'public.brain_queue'::regclass`,
    );
    expect(rows[0].rls).toBe(true);
    const { rows: grants } = await db.query<{ role: string; can: boolean }>(
      `select r as role, has_function_privilege(r, 'public.brain_enqueue()', 'execute') as can
         from unnest(array['anon', 'authenticated']) r`,
    );
    expect(grants).toEqual([
      { role: 'anon', can: false },
      { role: 'authenticated', can: false },
    ]);
  });
});
