// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ANSWER_CHARS } from '@ai-tutor/ledger';
import { asUser, createUser, freshDatabase } from './harness';

/**
 * What a student's own browser may write into the ledger (A10, in part).
 *
 * The insert policy (0006) checked WHO is writing and under WHICH org. It never
 * checked WHAT. These are the parts of "what" that have a measured basis;
 * limits on time-on-task and on the help rung do not yet (final plan, Part 1),
 * and a limit without a basis rejects real students.
 *
 * Since 0110 the browser writes only through public.record_evidence (0107),
 * which refuses each of these per event with a reason; the table's own checks
 * (0021) still stand behind it for every other writer.
 */

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

interface Recorded {
  status: string;
  reason: string | null;
}

async function writeAnswered(student: string, payload: Record<string, unknown>): Promise<Recorded> {
  const session = crypto.randomUUID();
  const at = new Date().toISOString();
  const { rows } = await asUser(db, student, (tx) =>
    tx.query<Recorded>(`select status, reason from public.record_evidence($1::jsonb, $2::jsonb)`, [
      JSON.stringify([{ id: session, source: 'quiz', startedAt: at }]),
      JSON.stringify([
        { id: crypto.randomUUID(), sessionId: session, seq: 0, at, kind: 'answered', source: 'quiz', surface: 'tap', payload },
      ]),
    ]),
  );
  return rows[0];
}

/** The same answer written straight into the table, as the owner: what the 0021 checks alone allow. */
async function writeAnsweredAsOwner(student: string, payload: Record<string, unknown>): Promise<void> {
  const session = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into public.learning_session (id, org_id, user_id, source, started_at)
       select $1, org_id, $2, 'quiz', now() from public.membership where user_id = $2 limit 1`,
      [session, student],
    );
    await tx.query(
      `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, payload)
       select $1, org_id, $2, $3, 0, now(), 'answered', 'quiz', 'tap', $4::jsonb
         from public.membership where user_id = $2 limit 1`,
      [crypto.randomUUID(), student, session, JSON.stringify(payload)],
    );
  });
}

describe('what a student may write into the ledger', () => {
  it('GUARD: accepts an ordinary answered event', async () => {
    const student = await createUser(db);
    expect(await writeAnswered(student, { correct: true, chosenIndex: 2, answerNormalised: 'photosynthesis' })).toEqual({
      status: 'recorded',
      reason: null,
    });
  });

  it('rejects a payload larger than 4 KB', async () => {
    const student = await createUser(db);
    const payload = { correct: true, padding: 'x'.repeat(5000) };
    expect(await writeAnswered(student, payload)).toEqual({ status: 'refused', reason: 'too-big' });
    await expect(writeAnsweredAsOwner(student, payload)).rejects.toThrow(/ledger_event_payload_size/);
  });

  it('rejects a stored answer longer than the client ever stores', async () => {
    const student = await createUser(db);
    const payload = { correct: true, answerNormalised: 'a'.repeat(MAX_ANSWER_CHARS + 1) };
    expect(await writeAnswered(student, payload)).toEqual({ status: 'refused', reason: 'answer-too-long' });
    await expect(writeAnsweredAsOwner(student, payload)).rejects.toThrow(/ledger_event_answer_length/);
  });

  it(`GUARD: accepts an answer of exactly ${MAX_ANSWER_CHARS} characters`, async () => {
    const student = await createUser(db);
    expect(await writeAnswered(student, { correct: true, answerNormalised: 'a'.repeat(MAX_ANSWER_CHARS) })).toEqual({
      status: 'recorded',
      reason: null,
    });
  });

  it('cannot go round record_evidence by inserting into the table (0110)', async () => {
    const student = await createUser(db);
    await expect(
      asUser(db, student, (tx) =>
        tx.query(
          `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, kind, source, surface, payload)
           values ($1, public.current_org_id(), $2, $3, 0, now(), 'answered', 'quiz', 'tap', '{}'::jsonb)`,
          [crypto.randomUUID(), student, crypto.randomUUID()],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
