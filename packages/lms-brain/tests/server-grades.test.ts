// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { think } from '../src/index.ts';

/**
 * WHO GRADED IT DECIDES WHAT IT CAN EARN (lam-one-brain Task 15, C2).
 *
 * Through the real door (record_evidence, 0115) and the real brain (think()):
 * a class lesson's answers, graded on the phone, never make an outcome
 * mastered however many days they span; a right answer to a bank question,
 * graded by the server, and a server-graded retest on a different bank
 * question a day later do.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
  for (const ref of ['probe-sg-1', 'probe-sg-2']) {
    await db.query(
      `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index)
       values ($1, $2, 8, 'Mathematics', 'mcq', $1, '["right","wrong"]'::jsonb, 0)`,
      [ref, [DEFINE]],
    );
  }
});
afterAll(async () => {
  await db.close();
});

/** One sitting of cold right answers, as the phone sends it. */
function sitting(source: 'class' | 'quiz', probes: string[]) {
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  return {
    session: { id, source, startedAt: at },
    events: probes.map((probe, n) => ({
      id: crypto.randomUUID(), sessionId: id, seq: n, at, kind: 'answered', source, surface: 'tap', outcomeIds: [DEFINE],
      payload: { correct: true, chosenIndex: 0, probeId: probe, ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0 },
    })),
  };
}

/** Sent through record_evidence, then received `hoursAgo` by the server's clock, the only one think() times by. */
async function sent(user: string, s: ReturnType<typeof sitting>, hoursAgo: number): Promise<void> {
  const statuses = await asUser(db, user, async (tx) =>
    (
      await tx.query<{ status: string }>(`select status from public.record_evidence($1::jsonb, $2::jsonb)`, [
        JSON.stringify([s.session]),
        JSON.stringify(s.events),
      ])
    ).rows.map((r) => r.status),
  );
  expect(statuses.every((x) => x === 'recorded')).toBe(true);
  const when = `now() - interval '${hoursAgo} hours'`;
  await db.query(`update public.learning_session set received_at = ${when} where id = $1`, [s.session.id]);
  await db.query(`update public.ledger_event set received_at = ${when} where session_id = $1`, [s.session.id]);
}

const state = async (user: string) =>
  (
    await db.query<{ mastered_at: string | null; unassisted_mastery: number; verified_observations: number }>(
      `select mastered_at, unassisted_mastery, verified_observations from public.concept_state
        where user_id = $1 and outcome_id = $2`,
      [user, DEFINE],
    )
  ).rows[0];

describe('masteredAt counts only answers the server graded', () => {
  it('a class lesson’s rights over three days, graded on the phone, never set it', async () => {
    const kid = await createUser(db);
    await sent(kid, sitting('class', ['probe-sg-lesson-1', 'probe-sg-lesson-2']), 50);
    await sent(kid, sitting('class', ['probe-sg-lesson-3']), 25);
    await sent(kid, sitting('class', ['probe-sg-lesson-4']), 0);
    await think(db, [kid]);
    const s = await state(kid);
    expect(s.unassisted_mastery).toBeGreaterThanOrEqual(0.8);
    expect(s).toMatchObject({ verified_observations: 0, mastered_at: null });
  });

  it('a server-graded retest on a different bank probe 24 h later sets it', async () => {
    const kid = await createUser(db);
    await sent(kid, sitting('quiz', ['probe-sg-1']), 25);
    await sent(kid, sitting('quiz', ['probe-sg-2']), 0);
    await think(db, [kid]);
    const s = await state(kid);
    expect(s.verified_observations).toBe(2);
    expect(s.mastered_at).not.toBeNull();
  });

  it('a phone-graded right a day before cannot be the first half of the pair', async () => {
    const kid = await createUser(db);
    await sent(kid, sitting('class', ['probe-sg-lesson-1']), 25);
    await sent(kid, sitting('quiz', ['probe-sg-1', 'probe-sg-2']), 0);
    await think(db, [kid]);
    expect((await state(kid)).mastered_at).toBeNull();
  });
});
