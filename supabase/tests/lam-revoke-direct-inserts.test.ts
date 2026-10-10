// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from './fixtures';
import { asService, asUser, createUser, freshDatabase } from './harness';

/**
 * 0110: a phone writes evidence only through public.record_evidence
 * (lam-one-brain Task 7b; review SF2).
 *
 * Until 0110 a student's token could still insert into public.ledger_event and
 * public.learning_session directly, under the 0006/0034 policies, with its own
 * source, its own org and the phone's clock: everything 0107 takes away. 0110
 * takes the table writes away from anon and authenticated; the service role,
 * the database owner and the security definer functions (record_evidence,
 * close_learning_session, the LMS's hand-in, test and practice functions)
 * still write.
 */

let db: PGlite;
let school: School;

beforeAll(async () => {
  db = await freshDatabase();
  school = await buildSchool(db, 'RDI');
});
afterAll(async () => {
  await db.close();
});

const failure = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e: Error) => e.message);

const asAnon = <T>(fn: (tx: Parameters<Parameters<typeof asUser>[2]>[0]) => Promise<T>): Promise<T> =>
  db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    return fn(tx);
  });

/** A sitting the owner opened for `user` an hour ago, so an event has somewhere to go. */
async function ownerSitting(user: string, org: string): Promise<string> {
  const session = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at)
     values ($1, $2, $3, 'quiz', now() - interval '1 hour')`,
    [session, org, user],
  );
  return session;
}

async function ownerEvent(user: string, org: string, session: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, payload)
     values ($1, $2, $3, $4, 0, now(), 'answered', 'quiz', 'tap', '{"correct": true}'::jsonb)`,
    [id, org, user, session],
  );
  return id;
}

const orgOf = async (user: string): Promise<string> =>
  (await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1 limit 1`, [user]))
    .rows[0].org_id;

describe('0110: a student token writes neither table directly', () => {
  it('cannot insert a sitting, even its own, in its own org, from a tutor source', async () => {
    const kid = await createUser(db);
    const org = await orgOf(kid);
    const message = await failure(
      asUser(db, kid, (tx) =>
        tx.query(
          `insert into public.learning_session (id, org_id, user_id, source, started_at)
           values ($1, $2, $3, 'quiz', now())`,
          [crypto.randomUUID(), org, kid],
        ),
      ),
    );
    expect(message).toMatch(/permission denied/);
  });

  it('cannot insert an event, even its own, into its own sitting', async () => {
    const kid = await createUser(db);
    const org = await orgOf(kid);
    const session = await ownerSitting(kid, org);
    const message = await failure(
      asUser(db, kid, (tx) =>
        tx.query(
          `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, payload)
           values ($1, $2, $3, $4, 0, now(), 'answered', 'quiz', 'tap', '{"correct": true}'::jsonb)`,
          [crypto.randomUUID(), org, kid, session],
        ),
      ),
    );
    expect(message).toMatch(/permission denied/);
    expect((await db.query(`select 1 from public.ledger_event where session_id = $1`, [session])).rows).toEqual([]);
  });

  it('cannot update or delete its own rows (refused outright, not just matched by no policy)', async () => {
    const kid = await createUser(db);
    const org = await orgOf(kid);
    const session = await ownerSitting(kid, org);
    const event = await ownerEvent(kid, org, session);
    for (const statement of [
      `update public.ledger_event set payload = '{"correct": false}'::jsonb where id = '${event}'`,
      `delete from public.ledger_event where id = '${event}'`,
      `update public.learning_session set active_ms = 1 where id = '${session}'`,
      `delete from public.learning_session where id = '${session}'`,
    ]) {
      expect(await failure(asUser(db, kid, (tx) => tx.query(statement)))).toMatch(/permission denied/);
    }
    const { rows } = await db.query<{ payload: { correct: boolean } }>(
      `select payload from public.ledger_event where id = $1`,
      [event],
    );
    expect(rows[0].payload.correct).toBe(true);
  });

  it('GUARD: still reads its own rows and no one else’s', async () => {
    const kid = await createUser(db);
    const other = await createUser(db);
    const mine = await ownerEvent(kid, await orgOf(kid), await ownerSitting(kid, await orgOf(kid)));
    await ownerEvent(other, await orgOf(other), await ownerSitting(other, await orgOf(other)));
    const { rows } = await asUser(db, kid, (tx) => tx.query<{ id: string }>(`select id from public.ledger_event`));
    expect(rows.map((r) => r.id)).toEqual([mine]);
    const sittings = await asUser(db, kid, (tx) =>
      tx.query<{ user_id: string }>(`select user_id from public.learning_session`),
    );
    expect(new Set(sittings.rows.map((r) => r.user_id))).toEqual(new Set([kid]));
  });
});

describe('0110: anon has nothing on either table', () => {
  it.each(['public.ledger_event', 'public.learning_session'])('cannot read or write %s', async (table) => {
    expect(await failure(asAnon((tx) => tx.query(`select 1 from ${table}`)))).toMatch(/permission denied/);
    expect(await failure(asAnon((tx) => tx.query(`delete from ${table}`)))).toMatch(/permission denied/);
  });
});

describe('0110: every legitimate writer still writes', () => {
  it('record_evidence records the tutor’s evidence and puts the learner on the brain’s queue', async () => {
    const kid = school.kid8a;
    const session = crypto.randomUUID();
    const event = crypto.randomUUID();
    const { rows } = await asUser(db, kid, (tx) =>
      tx.query<{ status: string }>(`select status from public.record_evidence($1::jsonb, $2::jsonb)`, [
        JSON.stringify([{ id: session, source: 'class', startedAt: new Date().toISOString() }]),
        JSON.stringify([
          {
            id: event,
            sessionId: session,
            seq: 1,
            at: new Date().toISOString(),
            kind: 'answered',
            source: 'class',
            surface: 'tap',
            outcomeIds: ['o1'],
            payload: { correct: true, attempt: 1, assistanceRung: 0 },
          },
        ]),
      ]),
    );
    expect(rows).toEqual([{ status: 'recorded' }]);
    expect((await db.query(`select 1 from public.brain_queue where user_id = $1`, [kid])).rows).toHaveLength(1);
  });

  it('close_learning_session still closes the caller’s sitting', async () => {
    const kid = await createUser(db);
    const session = await ownerSitting(kid, await orgOf(kid));
    await asUser(db, kid, (tx) =>
      tx.query(`select public.close_learning_session($1, now(), 1000)`, [session]),
    );
    const { rows } = await db.query<{ active_ms: number }>(
      `select active_ms from public.learning_session where id = $1`,
      [session],
    );
    expect(rows[0].active_ms).toBe(1000);
  });

  it('the service role still writes both tables', async () => {
    const kid = await createUser(db);
    const org = await orgOf(kid);
    const session = crypto.randomUUID();
    await asService(db, async (tx) => {
      await tx.query(
        `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'api', now())`,
        [session, org, kid],
      );
      await tx.query(
        `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface)
         values ($1, $2, $3, $4, 0, now(), 'answered', 'api', 'tap')`,
        [crypto.randomUUID(), org, kid, session],
      );
    });
    expect((await db.query(`select 1 from public.ledger_event where session_id = $1`, [session])).rows).toHaveLength(1);
  });
});
