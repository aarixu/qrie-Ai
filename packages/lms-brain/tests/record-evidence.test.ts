// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { think } from '../src/index.ts';

/**
 * THE TUTOR'S DOOR AND THE BRAIN'S CLOCK (lam-one-brain Task 7a, review MF3).
 *
 * Evidence written by a student's token through public.record_evidence (0067)
 * and folded by think(): a phone that backdates one of two cold rights by a
 * day, sending both in one call, does not earn "mastered"; the same two rights
 * received a day apart by the server do.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

/** A tutor quiz sitting with one cold right answer on its own library question, with the phone's clock at `at`. */
function quizRight(probe: string, at: string): { session: Record<string, unknown>; events: Record<string, unknown>[] } {
  const id = crypto.randomUUID();
  return {
    session: { id, source: 'quiz', startedAt: at },
    events: [
      { id: crypto.randomUUID(), sessionId: id, seq: 0, at, kind: 'session-started', source: 'quiz', surface: 'tap', outcomeIds: [], payload: {} },
      {
        id: crypto.randomUUID(), sessionId: id, seq: 1, at, kind: 'answered', source: 'quiz', surface: 'tap',
        outcomeIds: [DEFINE],
        payload: { correct: true, chosenIndex: 0, probeId: probe, ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0 },
      },
    ],
  };
}

async function send(user: string, ...sittings: ReturnType<typeof quizRight>[]): Promise<string[]> {
  return asUser(db, user, async (tx) => {
    const { rows } = await tx.query<{ status: string }>(`select status from public.record_evidence($1::jsonb, $2::jsonb)`, [
      JSON.stringify(sittings.map((s) => s.session)),
      JSON.stringify(sittings.flatMap((s) => s.events)),
    ]);
    return rows.map((r) => r.status);
  });
}

const masteredAt = async (user: string): Promise<unknown> =>
  (
    await db.query<{ mastered_at: unknown }>(
      `select mastered_at from public.concept_state where user_id = $1 and outcome_id = $2`,
      [user, DEFINE],
    )
  ).rows[0]?.mastered_at;

describe('record_evidence then think(): the server times the sitting', () => {
  it('does not let a phone backdate one of two cold rights a day to earn mastered', async () => {
    const kid = await createUser(db);
    const statuses = await send(kid, quizRight('probe-rev-1', ago(25)), quizRight('probe-rev-2', ago(0)));
    expect(statuses).toEqual(['recorded', 'recorded', 'recorded', 'recorded']);
    await think(db, [kid]);
    expect(await masteredAt(kid)).toBeNull();
  });

  it('GUARD: the same two rights, received a day apart by the server, earn it', async () => {
    const kid = await createUser(db);
    const first = quizRight('probe-rev-1', ago(25));
    await send(kid, first);
    // The server's clock moving on a day, stood in for by moving the first
    // receipt back: the only clock think() times a sitting by.
    await db.query(`update public.learning_session set received_at = now() - interval '25 hours' where id = $1`, [
      first.session.id,
    ]);
    await db.query(`update public.ledger_event set received_at = now() - interval '25 hours' where session_id = $1`, [
      first.session.id,
    ]);
    await send(kid, quizRight('probe-rev-2', ago(0)));
    await think(db, [kid]);
    expect(await masteredAt(kid)).not.toBeNull();
  });
});
