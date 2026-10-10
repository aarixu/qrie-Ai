// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from './fixtures';
import { asUser, freshDatabase } from './harness';

/**
 * 0113: "active in the last 7 days" on the school overview is the server's
 * clock (lam-one-brain M3 review, D28).
 *
 * 0112 moved the student list's "last active" to `received_at`, but
 * lms.school_overview (0105) still counted a child as active this week from
 * `ledger_event.at`, the phone's clock: a row dated 2099 counted the child as
 * active forever, and a clock set back hid a child who answered just now.
 * 0113 counts by `received_at`, which only Postgres sets.
 */

let db: PGlite;
let one: School;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'OVR');
});
afterAll(async () => {
  await db.close();
});

const activeThisWeek = async (): Promise<number> =>
  asUser(db, one.admin, async (tx) => {
    const rows = (await tx.query<{ active_students_7d: number }>(`select active_students_7d from lms.school_overview()`))
      .rows;
    if (rows.length !== 1) throw new Error(`expected one overview row, got ${rows.length}`);
    return rows[0].active_students_7d;
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

describe('lms.school_overview: active in the last 7 days', () => {
  it('does not count a child whose only answer arrived 10 days ago, dated 2099 by the phone', async () => {
    const before = await activeThisWeek();
    await answerAt(one.kid8a, '2099-01-01T00:00:00Z', new Date(Date.now() - 10 * 86_400_000).toISOString());
    expect(await activeThisWeek()).toBe(before);
  });

  it('counts a child who answered a minute ago on a phone set to 2001', async () => {
    const before = await activeThisWeek();
    await answerAt(one.kid8b, '2001-01-01T00:00:00Z', new Date(Date.now() - 60_000).toISOString());
    expect(await activeThisWeek()).toBe(before + 1);
  });
});
