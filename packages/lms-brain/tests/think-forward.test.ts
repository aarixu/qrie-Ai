// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normaliseMisconception } from '@ai-tutor/learner-model';
import { asService, createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { SNAPSHOT_LAG_SECONDS, settleDue, think } from '../src/index.ts';

/**
 * THE SERVER FOLDS FORWARD FROM A SNAPSHOT (lam-one-brain Task 2b).
 *
 * think() keeps the model it built in learner_model.snapshot and, next time,
 * folds only what the server received after it, in the order it received it.
 * That is what lets the nightly purge delete every answer older than 90 days
 * (0062) without the model forgetting what those answers taught it, provided
 * each answer reached the snapshot first: think() over an hour after it
 * arrived, which settleDue makes sure of.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const SERVER_IDEA = 'adds the numerators and adds the denominators';

let db: PGlite;
const ref: Record<string, string> = {};

async function libraryItem(name: string, outcome: string, misconceptions: (string | null)[]): Promise<void> {
  ref[name] = `probe-think-forward-${name}`;
  await db.query(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
     values ($1, $2, 8, 'Mathematics', 'mcq', $3, '["a","b","c","d"]'::jsonb, 0, $4::jsonb)`,
    [ref[name], [outcome], `Question ${name}`, JSON.stringify(misconceptions)],
  );
}

const orgOf = async (user: string): Promise<string> =>
  (await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [user])).rows[0]
    .org_id;

/** A tutor quiz answer to library question `name`: right when option 0 is chosen. */
const quiz = (name: string, chosen: number) => ({
  outcome: name.startsWith('a') ? DEFINE : CLOSURE,
  payload: { correct: chosen === 0, chosenIndex: chosen, probeId: ref[name], attempt: 1, assistanceRung: 0 },
});
type Ev = ReturnType<typeof quiz>;

const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

/** Events added to a sitting, each received by the server at `receivedAt`. Returns their ids. */
async function batch(user: string, session: string, receivedAt: string, firstSeq: number, events: Ev[]): Promise<string[]> {
  const org = await orgOf(user);
  const ids: string[] = [];
  for (const [i, e] of events.entries()) {
    const id = crypto.randomUUID();
    ids.push(id);
    await db.query(
      `insert into public.ledger_event
         (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, payload)
       values ($1, $2, $3, $4, $5, $6, $6, 'answered', 'quiz', 'tap', $7, $8::jsonb)`,
      [id, org, user, session, firstSeq + i, receivedAt, [e.outcome], JSON.stringify(e.payload)],
    );
  }
  return ids;
}

/** One quiz sitting the server received at `receivedAt`, with its answers. */
async function sitting(user: string, receivedAt: string, events: Ev[]): Promise<{ session: string; ids: string[] }> {
  const session = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at)
     values ($1, $2, $3, 'quiz', $4, $4)`,
    [session, await orgOf(user), user, receivedAt],
  );
  return { session, ids: await batch(user, session, receivedAt, 1, events) };
}

type Stored = Record<string, unknown> & { outcome_id: string };
const stored = async (user: string): Promise<Stored[]> =>
  (
    await db.query<{ row: Stored }>(
      `select to_jsonb(cs) - 'updated_at' as row from public.concept_state cs where user_id = $1 order by outcome_id`,
      [user],
    )
  ).rows.map((r) => r.row);
const outcome = async (user: string, id: string): Promise<Stored | undefined> =>
  (await stored(user)).find((r) => r.outcome_id === id);

interface ModelRow {
  version: number;
  snapshot: { model: { version: number; states: Record<string, unknown>; foldedThrough: { at: string } | null } } | null;
  folded_through_received_at: Date | null;
  folded_through_id: string | null;
}
const modelRow = async (user: string): Promise<ModelRow> =>
  (
    await db.query<ModelRow>(
      `select version, snapshot, folded_through_received_at, folded_through_id
         from public.learner_model where user_id = $1`,
      [user],
    )
  ).rows[0];

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ['a1', 'a2', 'a3', 'a4']) await libraryItem(n, DEFINE, [null, null, null, null]);
  for (const n of ['b1', 'b2', 'b3']) await libraryItem(n, CLOSURE, [null, null, SERVER_IDEA, null]);
});
afterAll(async () => {
  await db.close();
});

describe('folding forward from the snapshot', () => {
  it('reads only what arrived after the snapshot, and lands where a rebuild lands', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(72), [quiz('a1', 0), quiz('b1', 2)]);
    await sitting(kid, ago(48), [quiz('a2', 0)]);
    expect(await think(db, [kid])).toEqual({ students: 1, events: 3 });
    const snap = (await modelRow(kid)).snapshot;
    expect(snap?.model.version).toBe(4);

    await sitting(kid, ago(0), [quiz('a3', 0), quiz('b2', 2)]);
    // Only the two new answers are read: the three before are in the snapshot.
    expect(await think(db, [kid])).toEqual({ students: 1, events: 2 });
    const forward = await stored(kid);

    await think(db, [kid], { rebuild: true });
    expect(await stored(kid)).toEqual(forward);
  });

  it('reads nothing when nothing new has arrived, and changes nothing', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(30), [quiz('a1', 0)]);
    await think(db, [kid]);
    const before = await stored(kid);
    expect(await think(db, [kid])).toEqual({ students: 0, events: 0 });
    expect(await stored(kid)).toEqual(before);
  });

  it('folds a late batch of an older sitting instead of leaving it behind the cursor', async () => {
    const kid = await createUser(db);
    const early = await sitting(kid, ago(48), [quiz('a1', 0)]);
    await sitting(kid, ago(24), [quiz('a2', 0)]);
    await think(db, [kid]);
    expect(await outcome(kid, CLOSURE)).toBeUndefined();

    // The rest of the first sitting reaches the server only now.
    await batch(kid, early.session, ago(0), 2, [quiz('b1', 2)]);
    await think(db, [kid]);
    const closure = await outcome(kid, CLOSURE);
    expect(closure?.answer_observations).toBe(1);
  });

  it('records the last event it folded, by the server’s clock', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(30), [quiz('a1', 0)]);
    const receivedAt = ago(1 / 60);
    const last = await sitting(kid, receivedAt, [quiz('a2', 0), quiz('b1', 0)]);
    await think(db, [kid]);
    const row = await modelRow(kid);
    expect(row.folded_through_id).toBe(last.ids[1]);
    expect(row.folded_through_received_at?.getTime()).toBe(Date.parse(receivedAt));
  });

  it('keeps the bank’s label on a wrong idea it learned before the snapshot', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(72), [quiz('b1', 2)]);
    await sitting(kid, ago(48), [quiz('b2', 2)]);
    await think(db, [kid]);
    await sitting(kid, ago(0), [quiz('a1', 0)]);
    await think(db, [kid]);
    const ideas = (await outcome(kid, CLOSURE))!.misconceptions as Record<string, { label: string | null }>;
    expect(ideas[normaliseMisconception(SERVER_IDEA)].label).toBe(SERVER_IDEA);
  });
});

describe('the snapshot stays behind what may still be committing', () => {
  it(`covers only what the server received over ${SNAPSHOT_LAG_SECONDS / 60} minutes ago`, async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(48), [quiz('a1', 0)]);
    await sitting(kid, ago(0.5), [quiz('a2', 0)]);
    await think(db, [kid]);
    const through = (await modelRow(kid)).snapshot!.model.foldedThrough!;
    expect(Date.parse(through.at)).toBeLessThanOrEqual(Date.now() - SNAPSHOT_LAG_SECONDS * 1000);
    // concept_state still holds both answers.
    expect((await outcome(kid, DEFINE))?.answer_observations).toBe(2);
  });

  it('folds an answer that committed after a later one, with an earlier receipt', async () => {
    // Two writes for one child overlap: the one that began first (and so has
    // the earlier received_at) commits after think() has folded the other.
    const kid = await createUser(db);
    await sitting(kid, ago(48), [quiz('a1', 0)]);
    await sitting(kid, ago(0.2), [quiz('a2', 0)]);
    await think(db, [kid]);
    await sitting(kid, ago(0.3), [quiz('b1', 2)]);
    await think(db, [kid]);
    expect((await outcome(kid, CLOSURE))?.answer_observations).toBe(1);
    expect((await outcome(kid, DEFINE))?.answer_observations).toBe(2);
  });
});

describe('keeping the 90-day promise (Aarav’s choice (a), 0062)', () => {
  it('keeps mastery the purged answers earned, and builds on it', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(100 * 24), [quiz('a1', 0), quiz('a2', 0)]);
    await sitting(kid, ago(99 * 24), [quiz('a3', 0)]);
    await think(db, [kid]);
    const earned = (await outcome(kid, DEFINE))!;
    expect(earned.mastered_at).not.toBeNull();

    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    const { rows } = await db.query(`select 1 from public.ledger_event where user_id = $1`, [kid]);
    expect(rows).toEqual([]);

    await sitting(kid, ago(0), [quiz('b1', 0)]);
    await think(db, [kid]);
    const kept = (await outcome(kid, DEFINE))!;
    expect(kept.mastered_at).toBe(earned.mastered_at);
    expect(kept.unassisted_observations).toBe(earned.unassisted_observations);
    expect((await outcome(kid, CLOSURE))?.answer_observations).toBe(1);
  });

  it('GUARD: a rebuild after the purge has only what the ledger still holds', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(100 * 24), [quiz('a1', 0), quiz('a2', 0)]);
    await sitting(kid, ago(99 * 24), [quiz('a3', 0)]);
    await think(db, [kid]);
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    await sitting(kid, ago(0), [quiz('b1', 0)]);
    await think(db, [kid], { rebuild: true });
    expect((await outcome(kid, DEFINE))?.mastered_at ?? null).toBeNull();
  });
});

/**
 * Time passes for one learner: every clock the server keeps for them moves
 * `days` back, as if their answers had arrived that much earlier.
 */
async function age(user: string, days: number): Promise<void> {
  const back = `interval '${days} days'`;
  await db.query(
    `update public.ledger_event set received_at = received_at - ${back}, at = at - ${back} where user_id = $1`,
    [user],
  );
  await db.query(
    `update public.learning_session set received_at = received_at - ${back}, started_at = started_at - ${back}
      where user_id = $1`,
    [user],
  );
  await db.query(
    `update public.learner_model set folded_through_received_at = folded_through_received_at - ${back},
                                     updated_at = updated_at - ${back}
      where user_id = $1`,
    [user],
  );
  // The snapshot's cursor is a time of receipt too.
  await db.query(
    `update public.learner_model
        set snapshot = jsonb_set(snapshot, '{model,foldedThrough,at}', to_jsonb(to_char(
              ((snapshot #>> '{model,foldedThrough,at}')::timestamptz - ${back}) at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      where user_id = $1 and jsonb_typeof(snapshot #> '{model,foldedThrough}') = 'object'`,
    [user],
  );
}

describe('a sitting thought only once, the moment it was handed in (review M1)', () => {
  // think() runs straight after a hand-in, when that hand-in is still inside
  // the hour the snapshot stays behind. Nothing thinks the learner again until
  // they answer again, so the sitting is in concept_state but not the snapshot.

  it('is kept through the purge once settleDue has folded it into the snapshot', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(0), [quiz('a1', 0), quiz('b1', 2)]);
    await think(db, [kid]);
    expect((await modelRow(kid)).snapshot).toBeNull();
    const earned = (await outcome(kid, DEFINE))!;
    expect(earned.unassisted_observations).toBe(1);

    await age(kid, 91);
    expect(await settleDue(db)).toEqual({ students: 1, events: 2 });
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    expect((await db.query(`select 1 from public.ledger_event where user_id = $1`, [kid])).rows).toEqual([]);

    await sitting(kid, ago(0), [quiz('b2', 0)]);
    await think(db, [kid]);
    expect((await outcome(kid, DEFINE))?.unassisted_observations).toBe(1);
    expect((await outcome(kid, CLOSURE))?.answer_observations).toBe(2);
  });

  it('is kept on top of an older snapshot as well', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(72), [quiz('a1', 0)]);
    await think(db, [kid]);
    await sitting(kid, ago(0), [quiz('a2', 0)]);
    await think(db, [kid]);

    await age(kid, 91);
    expect(await settleDue(db)).toEqual({ students: 1, events: 1 });
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    await sitting(kid, ago(0), [quiz('b1', 0)]);
    await think(db, [kid]);
    expect((await outcome(kid, DEFINE))?.answer_observations).toBe(2);
  });

  it('settles only learners whose settled evidence the snapshot does not hold', async () => {
    const settledKid = await createUser(db);
    await sitting(settledKid, ago(48), [quiz('a1', 0)]);
    await think(db, [settledKid]);
    const freshKid = await createUser(db);
    await sitting(freshKid, ago(0), [quiz('a1', 0)]);
    await think(db, [freshKid]);
    // Neither has anything the snapshot could take yet (other tests' learners may).
    const { rows } = await db.query<{ user_id: string }>(
      `select user_id from public.learner_model where user_id = any ($1::uuid[]) and snapshot is not null`,
      [[settledKid, freshKid]],
    );
    expect(rows.map((r) => r.user_id)).toEqual([settledKid]);
    await settleDue(db);
    expect((await modelRow(freshKid)).snapshot).toBeNull();
    expect((await modelRow(settledKid)).snapshot).not.toBeNull();
    expect(await settleDue(db)).toEqual({ students: 0, events: 0 });
  });

  it('settles a learner the brain never read at all', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(2), [quiz('a1', 0)]);
    await settleDue(db);
    expect((await modelRow(kid)).snapshot?.model.version).toBe(4);
  });

  it('GUARD: without a settle pass the purge takes a sitting the snapshot never held', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(0), [quiz('a1', 0)]);
    await think(db, [kid]);
    await age(kid, 91);
    await asService(db, (tx) => tx.query(`select public.purge_old_ledger(90)`));
    await sitting(kid, ago(0), [quiz('b1', 0)]);
    await think(db, [kid]);
    expect((await outcome(kid, DEFINE))?.answer_observations ?? 0).toBe(0);
  });
});

describe('a model of another version', () => {
  it('is rebuilt from the ledger, not folded into', async () => {
    const kid = await createUser(db);
    await sitting(kid, ago(72), [quiz('a1', 0)]);
    await sitting(kid, ago(48), [quiz('b1', 2)]);
    await think(db, [kid]);
    const built = await stored(kid);

    // A snapshot written by an older fold, holding a belief this fold would not.
    await db.query(
      `update public.learner_model
          set snapshot = jsonb_set(jsonb_set(snapshot, '{model,version}', '3'),
                                   '{model,states,planted-outcome}', '{"outcomeId": "planted-outcome"}')
        where user_id = $1`,
      [kid],
    );
    expect(await think(db, [kid])).toEqual({ students: 1, events: 2 });
    expect(await stored(kid)).toEqual(built);
    const row = await modelRow(kid);
    expect(row.version).toBe(4);
    expect(row.snapshot!.model.version).toBe(4);
    expect(row.snapshot!.model.states).not.toHaveProperty('planted-outcome');
  });
});
