// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ANSWER_CHARS } from '@ai-tutor/ledger';
import { asUser, createUser, freshDatabase } from './harness';

/**
 * What a student's own browser may write into the ledger (A10, in part).
 *
 * The insert policy (0006) checks WHO is writing and under WHICH org. It never
 * checked WHAT. These are the parts of "what" that have a measured basis;
 * limits on time-on-task and on the help rung do not yet (final plan, Part 1),
 * and a limit without a basis rejects real students.
 */

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

async function writeAnswered(student: string, payload: Record<string, unknown>): Promise<void> {
  const session = crypto.randomUUID();
  await asUser(db, student, async (tx) => {
    await tx.query(
      `insert into public.learning_session (id, org_id, user_id, source, started_at)
       values ($1, public.current_org_id(), $2, 'quiz', now())`,
      [session, student],
    );
    await tx.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, payload)
       values ($1, public.current_org_id(), $2, $3, 0, now(), 'answered', 'quiz', 'tap', $4::jsonb)`,
      [crypto.randomUUID(), student, session, JSON.stringify(payload)],
    );
  });
}

describe('what a student may write into the ledger', () => {
  it('GUARD: accepts an ordinary answered event', async () => {
    const student = await createUser(db);
    await writeAnswered(student, { correct: true, chosenIndex: 2, answerNormalised: 'photosynthesis' });
  });

  it('rejects a payload larger than 4 KB', async () => {
    const student = await createUser(db);
    await expect(writeAnswered(student, { correct: true, padding: 'x'.repeat(5000) })).rejects.toThrow(
      /ledger_event_payload_size/,
    );
  });

  it('rejects a stored answer longer than the client ever stores', async () => {
    const student = await createUser(db);
    await expect(
      writeAnswered(student, { correct: true, answerNormalised: 'a'.repeat(MAX_ANSWER_CHARS + 1) }),
    ).rejects.toThrow(/ledger_event_answer_length/);
  });

  it(`GUARD: accepts an answer of exactly ${MAX_ANSWER_CHARS} characters`, async () => {
    const student = await createUser(db);
    await writeAnswered(student, { correct: true, answerNormalised: 'a'.repeat(MAX_ANSWER_CHARS) });
  });
});
