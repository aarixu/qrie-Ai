// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyModel, unassistedGain, type LearnerModel, type LearningMetric } from '@ai-tutor/learner-model';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { asService, asUser, createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { createLmsClient, pgliteTransport } from '../../lms-client/src/index.ts';
import { think } from '../src/index.ts';

/**
 * THE BRIEF'S METRIC, INSIDE THE SYSTEM (lam-one-brain Task 14).
 *
 * think() works out, per learner, unassisted gain per learning minute: each
 * sitting's unassisted gain (packages/learner-model metric.ts) over the time
 * on task the server holds for it (learning_session.active_ms), and writes
 * it to learner_model.metrics. No screen shows it. Gain made in a sitting
 * with no measured time is kept apart and never put in the ratio.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const MIN = 60_000;

let db: PGlite;
let one: School;
const ref: Record<string, string> = {};

async function libraryItem(name: string, outcome: string): Promise<void> {
  ref[name] = `probe-metric-${name}`;
  await db.query(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
     values ($1, $2, 8, 'Mathematics', 'mcq', $3, '["a","b","c","d"]'::jsonb, 0, '[null,null,null,null]'::jsonb)`,
    [ref[name], [outcome], `Question ${name}`],
  );
}

const orgOf = async (user: string): Promise<string> =>
  (await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [user])).rows[0]
    .org_id;

/** A tutor quiz answer to library question `name`, right when option 0 is chosen, at help rung `rung`. */
const quiz = (name: string, chosen: number, rung = 0) => ({
  outcome: name.startsWith('a') ? DEFINE : CLOSURE,
  payload: { correct: chosen === 0, chosenIndex: chosen, probeId: ref[name], attempt: 1, assistanceRung: rung },
});
type Ev = ReturnType<typeof quiz>;

const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

/**
 * One quiz sitting the server received at `receivedAt`, with its answers;
 * closed with `activeMs` time on task, or left open when that is undefined.
 */
async function sitting(user: string, receivedAt: string, events: Ev[], activeMs?: number): Promise<string> {
  const session = crypto.randomUUID();
  const org = await orgOf(user);
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at, ended_at, active_ms)
     values ($1, $2, $3, 'quiz', $4, $4, case when $5::int is null then null else $4::timestamptz + interval '1 hour' end, $5)`,
    [session, org, user, receivedAt, activeMs ?? null],
  );
  for (const [i, e] of events.entries()) {
    await db.query(
      `insert into public.ledger_event
         (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, payload)
       values ($1, $2, $3, $4, $5, $6, $6, 'answered', 'quiz', 'tap', $7, $8::jsonb)`,
      [crypto.randomUUID(), org, user, session, i + 1, receivedAt, [e.outcome], JSON.stringify(e.payload)],
    );
  }
  return session;
}

interface Row {
  metrics: LearningMetric | null;
  snapshot: { model: LearnerModel } | null;
}
const row = async (user: string): Promise<Row> =>
  (await db.query<Row>(`select metrics, snapshot from public.learner_model where user_id = $1`, [user])).rows[0];
const metrics = async (user: string): Promise<LearningMetric> => (await row(user)).metrics!;

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'MET');
  for (const n of ['a1', 'a2', 'a3', 'a4']) await libraryItem(n, DEFINE);
  for (const n of ['b1', 'b2', 'b3']) await libraryItem(n, CLOSURE);
});
afterAll(async () => {
  await db.close();
});

describe('unassisted gain per learning minute, worked out by the brain', () => {
  it('is computed exactly for a learner who gains on their own over N minutes', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(48), [quiz('a1', 0), quiz('b1', 0)], 4 * MIN);
    await think(db, [kid]);
    const m1 = (await row(kid)).snapshot!.model;
    await sitting(kid, ago(24), [quiz('a2', 0)], 6 * MIN);
    await think(db, [kid]);
    const m2 = (await row(kid)).snapshot!.model;

    const gain = unassistedGain(emptyModel(), m1) + unassistedGain(m1, m2);
    expect(gain).toBeGreaterThan(0);
    const m = await metrics(kid);
    expect(m.learningMinutes).toBe(10);
    expect(m.gain).toBeCloseTo(gain, 12);
    expect(m.gainPerMinute).toBeCloseTo(gain / 10, 12);
    expect(m).toMatchObject({ untimedGain: 0, openSittings: 0 });
  });

  it('lands where a rebuild from the ledger lands', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(48), [quiz('a1', 0)], 4 * MIN);
    await think(db, [kid]);
    await sitting(kid, ago(0), [quiz('a2', 0), quiz('b1', 2)], 3 * MIN);
    await think(db, [kid]);
    const forward = await metrics(kid);
    await think(db, [kid], { rebuild: true });
    expect(await metrics(kid)).toEqual(forward);
    expect(forward.learningMinutes).toBe(7);
  });

  it('has no ratio (null, not 0) while no minutes are measured, and one once the sitting is closed', async () => {
    const kid = await createUser(db);
    const open = await sitting(kid, ago(2), [quiz('a1', 0), quiz('a2', 0)]);
    await think(db, [kid]);
    expect(await metrics(kid)).toMatchObject({ learningMinutes: 0, gainPerMinute: null, gain: 0, openSittings: 1 });

    await asUser(db, kid, (tx) => tx.query(`select public.close_learning_session($1, now(), $2)`, [open, 12 * MIN]));
    // Nothing new to fold: concept_state stays as it was, the metric takes the sitting's time.
    expect(await think(db, [kid])).toEqual({ students: 0, events: 0 });
    const m = await metrics(kid);
    expect(m.learningMinutes).toBe(12);
    expect(m.gain).toBeGreaterThan(0);
    expect(m.gainPerMinute).toBeCloseTo(m.gain / 12, 12);
    expect(m.openSittings).toBe(0);
  });

  it('does not count gains made only with help, and flips with the evidence', async () => {
    const helped = await createUser(db);
    await sitting(helped, ago(30), [quiz('a1', 0, 3), quiz('a2', 0, 3), quiz('b1', 0, 3)], 5 * MIN);
    await think(db, [helped]);
    expect(await metrics(helped)).toMatchObject({ gain: 0, learningMinutes: 5, gainPerMinute: 0 });

    const alone = await createUser(db);
    await sitting(alone, ago(30), [quiz('a1', 0), quiz('a2', 0), quiz('b1', 0)], 5 * MIN);
    await think(db, [alone]);
    expect((await metrics(alone)).gainPerMinute).toBeGreaterThan(0);
  });

  it('keeps the minutes of sittings the nightly purge deleted', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(100 * 24), [quiz('a1', 0)], 4 * MIN);
    await think(db, [kid]);
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    await sitting(kid, ago(0), [quiz('a2', 0)], 6 * MIN);
    await think(db, [kid]);
    expect((await metrics(kid)).learningMinutes).toBe(10);
  });

  it('a rebuild (forced, or a model version change) recounts from what the server still holds: purged minutes go', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(100 * 24), [quiz('a1', 0)], 4 * MIN);
    await think(db, [kid]);
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    await sitting(kid, ago(0), [quiz('a2', 0)], 6 * MIN);
    await think(db, [kid]);
    expect((await metrics(kid)).learningMinutes).toBe(10);
    await think(db, [kid], { rebuild: true });
    expect((await metrics(kid)).learningMinutes).toBe(6);
  });
});

describe('homework in the metric', () => {
  async function homework(item: string, section: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into lms.assignment (org_id, section_id, subject_id, created_by, kind, title, due_at, attempts_allowed,
                                   answer_types)
       values ($1, $2, $3, $4, 'homework', 'HW', now() + interval '2 days', 1, '{mcq}')
       returning id`,
      [one.org, section, one.maths, one.teacherA],
    );
    await db.query(`insert into lms.assignment_item (assignment_id, item_id, position) values ($1, $2, 1)`, [rows[0].id, item]);
    // Published a day ago: the time a hand-in carries is capped at the time since.
    await db.query(`update lms.assignment set published_at = now() - interval '1 day' where id = $1`, [rows[0].id]);
    return rows[0].id;
  }

  it('counts a hand-in with its time, and keeps one sent without time out of the ratio', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into lms.item (org_id, outcome_ids, grade, subject, kind, stem, options, correct_index, created_by)
       values ($1, $2, 8, 'Mathematics', 'mcq', 'Which is a rational number?', '["3/4","pi"]'::jsonb, 0, $3)
       returning id`,
      [one.org, [DEFINE], one.teacherA],
    );
    const item = rows[0].id;
    const timed = createLmsClient(pgliteTransport(db, one.kid8a));
    const untimed = createLmsClient(pgliteTransport(db, one.kid8b));
    await timed.submitMcq(await homework(item, one.s8a), { [item]: 0 }, crypto.randomUUID(), 5 * MIN);
    await untimed.submitMcq(await homework(item, one.s8b), { [item]: 0 }, crypto.randomUUID());
    await think(db, [one.kid8a, one.kid8b]);

    const t = await metrics(one.kid8a);
    expect(t.learningMinutes).toBe(5);
    expect(t.gain).toBeGreaterThan(0);
    expect(t.gainPerMinute).toBeCloseTo(t.gain / 5, 12);

    const u = await metrics(one.kid8b);
    expect(u).toMatchObject({ gain: 0, learningMinutes: 0, gainPerMinute: null, openSittings: 0 });
    expect(u.untimedGain).toBeCloseTo(t.gain, 12);
  });
});
