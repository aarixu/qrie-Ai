// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODEL_VERSION } from '@ai-tutor/learner-model';
import { asUser, createUser, freshDatabase } from './harness';

/**
 * 0100: the columns that let concept_state hold a whole learner-model v4
 * ConceptState, the size line on its wrong ideas, and the version default.
 */

let db: PGlite;
let kid: string;
let org: string;

beforeAll(async () => {
  db = await freshDatabase();
  kid = await createUser(db);
  org = (
    await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [kid])
  ).rows[0].org_id;
});
afterAll(async () => {
  await db.close();
});

const insertRow = (outcome: string, extra: Record<string, unknown> = {}) => {
  const cols = Object.keys(extra);
  return db.query(
    `insert into public.concept_state (org_id, user_id, outcome_id, mastery, unassisted_mastery, assisted_performance
       ${cols.map((c) => `, ${c}`).join('')})
     values ($1, $2, $3, 0.35, 0.35, 0.35 ${cols.map((_, i) => `, $${i + 4}`).join('')})`,
    [org, kid, outcome, ...Object.values(extra)],
  );
};

describe('0100 concept_state v4', () => {
  it('gives a row written without the new fields what emptyConceptState holds', async () => {
    await insertRow('o-defaults');
    const { rows } = await db.query<Record<string, unknown>>(
      `select mastered_at, cold_wins, box, last_exposed_at, last_retrieved_at, misconceptions
         from public.concept_state where user_id = $1 and outcome_id = 'o-defaults'`,
      [kid],
    );
    expect(rows[0]).toEqual({
      mastered_at: null,
      cold_wins: {},
      box: null,
      last_exposed_at: null,
      last_retrieved_at: null,
      misconceptions: {},
    });
  });

  it('keeps a review box on the ladder, 0 to 5', async () => {
    await insertRow('o-box', { box: 5 });
    await expect(insertRow('o-box-6', { box: 6 })).rejects.toThrow(/check constraint/);
  });

  it('refuses a record of wrong ideas past 8 KB', async () => {
    const big = { x: { label: 'y'.repeat(9000) } };
    await expect(insertRow('o-big', { misconceptions: JSON.stringify(big) })).rejects.toThrow(
      /concept_state_misconceptions_size/,
    );
    await insertRow('o-fits', { misconceptions: JSON.stringify({ x: { label: 'y'.repeat(8000) } }) });
  });

  it('starts a learner_model row at the version the server fold writes', async () => {
    await db.query(`insert into public.learner_model (user_id, org_id) values ($1, $2)`, [kid, org]);
    const { rows } = await db.query<{ version: number }>(
      `select version from public.learner_model where user_id = $1`,
      [kid],
    );
    expect(rows[0].version).toBe(MODEL_VERSION);
  });

  it('still lets a student read only, never write, their own rows', async () => {
    const seen = await asUser(db, kid, (tx) =>
      tx.query<{ n: number }>(`select count(*)::int as n from public.concept_state`),
    );
    expect(seen.rows[0].n).toBeGreaterThan(0);
    await expect(
      asUser(db, kid, (tx) => tx.query(`update public.concept_state set misconceptions = '{}'::jsonb`)),
    ).rejects.toThrow(/permission denied/);
  });
});
