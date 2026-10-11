// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { think } from '../src/index.ts';

/**
 * THE QUESTIONS AN OUTCOME WAS ASKED BY FIT concept_state (0116), whatever the
 * phone names them (lam-one-brain, review of phase 2).
 *
 * A probe id on a tutor answer is the phone's text. Eight answers on one
 * outcome with ids of 240 Devanagari letters were each under 256 characters,
 * so the fold kept them, and together they were past 0116's 4096-byte line:
 * think() then failed for that learner on every run. The fold now measures a
 * key in bytes, as the column does.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

describe('asked_items through record_evidence and think()', () => {
  it('eight answers named by long non-Latin probe ids are recorded and the brain still runs', async () => {
    const kid = await createUser(db);
    const id = crypto.randomUUID();
    const at = new Date().toISOString();
    const events = Array.from({ length: 8 }, (_, n) => ({
      id: crypto.randomUUID(), sessionId: id, seq: n, at, kind: 'answered', source: 'quiz', surface: 'tap', outcomeIds: [DEFINE],
      payload: { correct: true, chosenIndex: 0, probeId: `${n}${'अ'.repeat(240)}`, ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0 },
    }));
    const statuses = await asUser(db, kid, async (tx) =>
      (
        await tx.query<{ status: string }>(`select status from public.record_evidence($1::jsonb, $2::jsonb)`, [
          JSON.stringify([{ id, source: 'quiz', startedAt: at }]),
          JSON.stringify(events),
        ])
      ).rows.map((r) => r.status),
    );
    expect(statuses).toEqual(Array(8).fill('recorded'));

    await think(db, [kid]);
    const { rows } = await db.query<{ observations: number; asked_items: unknown[] }>(
      `select observations, asked_items from public.concept_state where user_id = $1 and outcome_id = $2`,
      [kid, DEFINE],
    );
    expect(rows[0].observations).toBe(8);
    expect(rows[0].asked_items).toEqual([]);
  });
});
