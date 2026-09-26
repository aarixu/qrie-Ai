// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyParams } from '@ai-tutor/knowledge-graph';
import { emptyModel, foldSession } from '@ai-tutor/learner-model';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport } from '../../lms-client/src/index.ts';
import { libraryIndex, think } from '../src/index.ts';

/**
 * THE BRAIN, SERVER-SIDE: a school child's homework answers, folded into
 * what we believe they know, by the SAME fold the tutor runs in the browser
 * (packages/learner-model) — not a second, invented one. Written first.
 */

// Two real outcomes from the Class 8 maths map: the definition of a rational
// number, and closure under addition, which has it as a prerequisite.
const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';

let db: PGlite;
let one: School;
const items: Record<string, string[]> = { [DEFINE]: [], [CLOSURE]: [] };

async function item(outcome: string, n: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index)
     values ($1, $2, 8, 'Mathematics', 'mcq', $3, '["a","b","c","d"]'::jsonb, 0) returning id`,
    [`probe-brain-${outcome}-${n}`, [outcome], `Question ${n} on ${outcome}`],
  );
  return rows[0].id;
}

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'BRN');
  for (const o of [DEFINE, CLOSURE]) for (let n = 1; n <= 3; n++) items[o].push(await item(o, n));
  const teacher = createLmsClient(pgliteTransport(db, one.teacherA));
  for (const id of [...items[DEFINE], ...items[CLOSURE]]) await teacher.approveItem(id);
  const hw = await teacher.createAssignment({
    sectionId: one.s8a,
    subjectId: one.maths,
    kind: 'homework',
    title: 'Rational numbers',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    answerTypes: ['mcq'],
  });
  await teacher.setAssignmentItems(hw, [...items[DEFINE], ...items[CLOSURE]]);
  await teacher.publishAssignment(hw);
  // Riya knows the definition cold and gets closure wrong every time.
  await createLmsClient(pgliteTransport(db, one.kid8a)).submitMcq(hw, {
    ...Object.fromEntries(items[DEFINE].map((id) => [id, 0])),
    ...Object.fromEntries(items[CLOSURE].map((id) => [id, 2])),
  });
});
afterAll(async () => {
  await db.close();
});

const state = async (user: string, outcome: string) =>
  (
    await db.query<{
      mastery: number;
      unassisted_mastery: number;
      observations: number;
      unassisted_observations: number;
    }>(
      `select mastery::float8 as mastery, unassisted_mastery::float8 as unassisted_mastery,
              observations, unassisted_observations
         from public.concept_state where user_id = $1 and outcome_id = $2`,
      [user, outcome],
    )
  ).rows[0];

describe('the brain', () => {
  it('knows the library map: every outcome a library question names is a node it can reason over', () => {
    const index = libraryIndex();
    expect(index.node(DEFINE)?.id).toBe(DEFINE);
    expect(index.prerequisitesOf(CLOSURE)).toContain(DEFINE);
  });

  it('folds homework into mastery, as the child’s own unassisted work', async () => {
    await think(db, [one.kid8a]);
    const known = await state(one.kid8a, DEFINE);
    const missed = await state(one.kid8a, CLOSURE);
    expect(known.mastery).toBeGreaterThan(0.8);
    expect(missed.mastery).toBeLessThan(0.2);
    expect(known).toMatchObject({ observations: 3, unassisted_observations: 3 });
    expect(known.unassisted_mastery).toBeGreaterThan(0.8);
  });

  it('is the tutor’s own fold, not a second one: same events in, same beliefs out', async () => {
    const { rows } = await db.query<{
      id: string; session_id: string; seq: number; at: string; kind: string; source: string;
      surface: string; outcome_ids: string[]; payload: unknown; started_at: string;
    }>(
      `select e.id, e.session_id, e.seq, e.at, e.kind, e.source, e.surface, e.outcome_ids, e.payload, s.started_at
         from public.ledger_event e join public.learning_session s on s.id = e.session_id
        where e.user_id = $1 order by s.started_at, e.seq`,
      [one.kid8a],
    );
    const events = rows.map(
      (r) =>
        ({
          id: r.id, sessionId: r.session_id, seq: r.seq, at: new Date(r.at).toISOString(), kind: r.kind,
          source: r.source, surface: r.surface, outcomeIds: r.outcome_ids, payload: r.payload,
        }) as LedgerEvent,
    );
    const direct = foldSession(
      emptyModel(),
      { id: rows[0].session_id, startedAt: new Date(rows[0].started_at).toISOString() },
      events,
      libraryIndex(),
      emptyParams(),
    );
    const stored = await state(one.kid8a, CLOSURE);
    // concept_state is a Postgres real: equal to about six digits.
    expect(stored.mastery).toBeCloseTo(direct.states[CLOSURE].mastery, 5);
  });

  it('changes nothing when run again over the same answers', async () => {
    const before = await state(one.kid8a, DEFINE);
    await think(db, [one.kid8a]);
    expect(await state(one.kid8a, DEFINE)).toEqual(before);
  });

  it('believes nothing about a child who has answered nothing', async () => {
    await think(db, [one.kid8b]);
    const { rows } = await db.query(`select 1 from public.concept_state where user_id = $1`, [one.kid8b]);
    expect(rows).toEqual([]);
  });

  it('records how far it has read, under the child’s school', async () => {
    const { rows } = await db.query<{ org_id: string; seq: number }>(
      `select org_id, folded_through_seq as seq from public.learner_model where user_id = $1`,
      [one.kid8a],
    );
    expect(rows).toEqual([{ org_id: one.org, seq: 6 }]);
  });
});
