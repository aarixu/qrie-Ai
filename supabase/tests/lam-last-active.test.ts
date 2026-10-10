// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from './fixtures';
import { asUser, freshDatabase } from './harness';

/**
 * 0112: "last active" on the school's student list is the server's clock
 * (lam-one-brain Task 13, D28).
 *
 * lms.school_students took a child's last activity from `ledger_event.at`, the
 * phone's clock (0105, as 0031 and 0042 before it). record_evidence (0107)
 * clamps `at` for new answers, but a row written before it, or by a phone set
 * to 2099, still made the child read as active in 2099. 0112 reads
 * `received_at`, which only Postgres sets, as the founder's list already does
 * (0041), and gives it an index per learner.
 */

let db: PGlite;
let one: School;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'LAST');
});
afterAll(async () => {
  await db.close();
});

interface Row {
  user_id: string;
  last_active: Date | null;
}

const lastActive = async (user: string): Promise<Date | null> =>
  asUser(db, one.admin, async (tx) => {
    const rows = (await tx.query<Row>(`select user_id, last_active from lms.school_students()`)).rows;
    const row = rows.find((r) => r.user_id === user);
    if (!row) throw new Error(`no row for ${user}`);
    return row.last_active;
  });

/** One answer as an old phone wrote it: `at` is whatever the phone said. */
async function answerAt(user: string, at: string, receivedAt: string): Promise<void> {
  const session = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at)
     values ($1, $2, $3, 'class', $4, $5)`,
    [session, one.org, user, at, receivedAt],
  );
  await db.query(
    `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface)
     values ($1, $2, $3, $4, 0, $5, $6, 'answered', 'class', 'tap')`,
    [crypto.randomUUID(), one.org, user, session, at, receivedAt],
  );
}

describe('lms.school_students: last active', () => {
  it('is null for a child who has written nothing', async () => {
    expect(await lastActive(one.kid8b)).toBeNull();
  });

  it('is when the server received the answer, not the phone’s 2099 clock', async () => {
    const received = new Date(Date.now() - 2 * 86_400_000);
    await answerAt(one.kid8a, '2099-01-01T00:00:00Z', received.toISOString());
    const seen = await lastActive(one.kid8a);
    expect(seen?.getFullYear()).not.toBe(2099);
    expect(seen?.getTime()).toBe(received.getTime());
  });

  it('a phone clock set back does not hide a fresh answer', async () => {
    const received = new Date(Date.now() - 60_000);
    await answerAt(one.kid8a, '2001-01-01T00:00:00Z', received.toISOString());
    expect((await lastActive(one.kid8a))?.getTime()).toBe(received.getTime());
  });

  it('has an index to read it by learner', async () => {
    const indexes = (
      await db.query<{ indexdef: string }>(
        `select indexdef from pg_indexes where schemaname = 'public' and tablename = 'ledger_event'`,
      )
    ).rows.map((r) => r.indexdef);
    expect(indexes.some((d) => /\(user_id, received_at DESC\)/.test(d))).toBe(true);
  });
});
