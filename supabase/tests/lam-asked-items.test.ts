// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODEL_VERSION } from '@ai-tutor/learner-model';
import { asUser, createUser, freshDatabase } from './harness';

/**
 * 0116: concept_state.asked_items, the questions each outcome was asked by
 * (learner-model version 6, lam-one-brain Task 16), and the version default.
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

const insertRow = (outcome: string, asked?: unknown) =>
  db.query(
    `insert into public.concept_state (org_id, user_id, outcome_id, mastery, unassisted_mastery, assisted_performance
       ${asked === undefined ? '' : ', asked_items'})
     values ($1, $2, $3, 0.5, 0.5, 0.5 ${asked === undefined ? '' : ', $4::jsonb'})`,
    asked === undefined ? [org, kid, outcome] : [org, kid, outcome, JSON.stringify(asked)],
  );

describe('0116 asked_items', () => {
  it('gives a row written without it what emptyConceptState holds: none', async () => {
    await insertRow('o-default');
    const { rows } = await db.query<{ asked_items: unknown }>(
      `select asked_items from public.concept_state where user_id = $1 and outcome_id = 'o-default'`,
      [kid],
    );
    expect(rows[0].asked_items).toEqual([]);
  });

  it('holds a list, never anything else, and refuses one past 4 KB', async () => {
    await insertRow('o-list', ['probe:p1', 'item:i2']);
    await expect(insertRow('o-object', { a: 1 })).rejects.toThrow(/concept_state_asked_items_shape/);
    await expect(insertRow('o-null', null)).rejects.toThrow(/concept_state_asked_items_shape/);
    await expect(insertRow('o-big', ['x'.repeat(5000)])).rejects.toThrow(/concept_state_asked_items_shape/);
  });

  it('is in what my_learner_model hands the learner', async () => {
    const { rows } = await asUser(db, kid, (tx) => tx.query<{ m: { states: { outcome_id: string; asked_items: unknown }[] } }>(
      `select public.my_learner_model() as m`,
    ));
    const list = rows[0].m.states.find((s) => s.outcome_id === 'o-list');
    expect(list?.asked_items).toEqual(['probe:p1', 'item:i2']);
  });

  it('a student still cannot write it', async () => {
    await expect(
      asUser(db, kid, (tx) => tx.query(`update public.concept_state set asked_items = '[]'::jsonb`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('starts a learner_model row at the version the server fold writes (6 or later)', async () => {
    expect(MODEL_VERSION).toBeGreaterThanOrEqual(6);
    const { rows } = await db.query<{ column_default: string }>(
      `select column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'learner_model' and column_name = 'version'`,
    );
    expect(Number(rows[0].column_default)).toBe(MODEL_VERSION);
  });
});
