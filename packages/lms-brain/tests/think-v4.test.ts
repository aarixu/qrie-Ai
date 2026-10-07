// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyParams } from '@ai-tutor/knowledge-graph';
import {
  emptyConceptState,
  isConfirmed,
  normaliseMisconception,
  type ConceptState,
  type Misconception,
} from '@ai-tutor/learner-model';
import { createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import {
  MISCONCEPTIONS_MAX_BYTES,
  foldLedger,
  jsonbTextBytes,
  libraryIndex,
  readLedger,
  think,
  thinkLearner,
  writableMisconceptions,
  type Sql,
} from '../src/index.ts';

/**
 * THE SERVER HOLDS THE WHOLE MODEL (lam-one-brain Task 2).
 *
 * think() writes every field of a v4 ConceptState to concept_state (0060),
 * times every sitting on the server's clock rather than the phone's (MF3),
 * takes a school item's labels and identity from lms.item (MF5), and does
 * each learner in one transaction under a per-learner lock (MF9).
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';
const SERVER_IDEA = 'adds the numerators and adds the denominators';
const CLIENT_WORDING = 'client wording that must not win';
const UNMATCHED_IDEA = 'SENTINEL-7Q believes closure fails';

let db: PGlite;
const ref: Record<string, string> = {};
const itemId: Record<string, string> = {};

async function libraryItem(name: string, outcome: string, misconceptions: (string | null)[]): Promise<void> {
  ref[name] = `probe-think-v4-${name}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
     values ($1, $2, 8, 'Mathematics', 'mcq', $3, '["a","b","c","d"]'::jsonb, 0, $4::jsonb) returning id`,
    [ref[name], [outcome], `Question ${name}`, JSON.stringify(misconceptions)],
  );
  itemId[name] = rows[0].id;
}

const orgOf = async (user: string): Promise<string> =>
  (await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [user])).rows[0]
    .org_id;

interface Ev {
  kind?: string;
  outcome: string;
  payload: Record<string, unknown>;
  at?: string;
}

/**
 * One sitting written straight into the ledger, as the database owner. A
 * received time is set only where a test needs the server's clock in the
 * past; otherwise Postgres stamps now(), as it does for every real write.
 */
async function sitting(
  user: string,
  source: string,
  opts: { startedAt?: string; receivedAt?: string },
  events: Ev[],
): Promise<string> {
  const org = await orgOf(user);
  const session = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at)
     values ($1, $2, $3, $4, coalesce($5::timestamptz, now()), coalesce($6::timestamptz, now()))`,
    [session, org, user, source, opts.startedAt ?? opts.receivedAt ?? null, opts.receivedAt ?? null],
  );
  for (const [seq, e] of events.entries()) {
    await db.query(
      `insert into public.ledger_event
         (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, payload)
       values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, $7::timestamptz, now()), coalesce($7::timestamptz, now()),
               $8, $9, 'tap', $10, $11::jsonb)`,
      [
        crypto.randomUUID(), org, user, session, seq + 1, e.at ?? null, opts.receivedAt ?? null,
        e.kind ?? 'answered', source, [e.outcome], JSON.stringify(e.payload),
      ],
    );
  }
  return session;
}

const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

const homework = (name: string, chosen: number): Ev => ({
  outcome: name.startsWith('a') ? DEFINE : CLOSURE,
  payload: { correct: chosen === 0, chosenIndex: chosen, itemId: itemId[name], attempt: 1, assistanceRung: 0 },
});
const quiz = (name: string, chosen: number, extra: Record<string, unknown> = {}): Ev => ({
  outcome: name.startsWith('a') ? DEFINE : CLOSURE,
  payload: { correct: chosen === 0, chosenIndex: chosen, probeId: ref[name], attempt: 1, assistanceRung: 0, ...extra },
});

type Stored = Record<string, unknown> & { outcome_id: string };
const stored = async (user: string): Promise<Stored[]> =>
  (
    await db.query<{ row: Stored }>(
      `select to_jsonb(cs) - 'updated_at' as row from public.concept_state cs where user_id = $1 order by outcome_id`,
      [user],
    )
  ).rows.map((r) => r.row);

const snake = (field: string): string => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

let riya: string;

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ['a1', 'a2', 'a3']) await libraryItem(n, DEFINE, [null, 'thinks only fractions are rational', null, null]);
  for (const n of ['b1', 'b2']) await libraryItem(n, CLOSURE, [null, null, SERVER_IDEA, null]);

  riya = await createUser(db);
  // Taught the definition five days ago (an exposure the review clock reads),
  await sitting(riya, 'class', { receivedAt: ago(120) }, [{ kind: 'taught', outcome: DEFINE, payload: { beatId: 'b1' } }]);
  // homework three days ago: two definitions right, closure wrong on the idea,
  await sitting(riya, 'homework', { receivedAt: ago(72) }, [homework('a1', 0), homework('a2', 0), homework('b1', 2)]);
  // and a tutor quiz yesterday: a third definition right; the same wrong idea
  // on a second library question (the phone sends its own wording); and a
  // wrong answer on a question the library does not hold.
  await sitting(riya, 'quiz', { receivedAt: ago(24) }, [
    quiz('a3', 0),
    quiz('b2', 2, { misconceptionId: CLIENT_WORDING }),
    {
      outcome: CLOSURE,
      payload: {
        correct: false, chosenIndex: 1, probeId: 'probe-not-in-library', attempt: 1, assistanceRung: 0,
        misconceptionId: UNMATCHED_IDEA,
      },
    },
  ]);
  await think(db, [riya]);
});
afterAll(async () => {
  await db.close();
});

describe('every v4 field reaches concept_state (Task 2)', () => {
  it('writes each ConceptState field to its column, as the fold computed it', async () => {
    const model = foldLedger(await readLedger(db, riya), libraryIndex(), emptyParams());
    const rows = await stored(riya);
    expect(rows.map((r) => r.outcome_id)).toEqual(Object.keys(model.states).sort());

    const fields = Object.keys(emptyConceptState('x')).filter((f) => f !== 'outcomeId') as (keyof ConceptState)[];
    for (const row of rows) {
      const want = model.states[row.outcome_id];
      for (const field of fields) {
        const got = row[snake(field)];
        const expected = want[field];
        expect(got, `${row.outcome_id}.${field} has no column`).not.toBeUndefined();
        if (field === 'misconceptions') {
          // Compared without the label here: the next test owns the labels.
          const strip = (m: unknown) =>
            Object.fromEntries(Object.entries(m as object).map(([k, v]) => [k, { ...v, label: undefined }]));
          expect(strip(got)).toEqual(strip(expected));
        } else if (typeof expected === 'number') {
          expect(got as number).toBeCloseTo(expected, 5);
        } else if (typeof expected === 'string') {
          expect(Date.parse(got as string), `${row.outcome_id}.${field}`).toBe(Date.parse(expected));
        } else {
          expect(got, `${row.outcome_id}.${field}`).toEqual(expected);
        }
      }
    }
  });

  it('holds what the old columns could not: mastered, review, exposure, retrieval, wrong ideas', async () => {
    const rows = await stored(riya);
    const define = rows.find((r) => r.outcome_id === DEFINE)!;
    const closure = rows.find((r) => r.outcome_id === CLOSURE)!;
    expect(define.mastered_at).not.toBeNull();
    expect(Object.keys(define.cold_wins as object).length).toBeGreaterThanOrEqual(2);
    expect(define.box).not.toBeNull();
    expect(define.last_exposed_at).not.toBeNull();
    expect(define.last_retrieved_at).not.toBeNull();
    expect(Object.keys(closure.misconceptions as object).length).toBeGreaterThan(0);
  });

  it('records the model version it wrote', async () => {
    const { rows } = await db.query<{ version: number }>(`select version from public.learner_model where user_id = $1`, [
      riya,
    ]);
    expect(rows[0].version).toBe(4);
  });
});

describe('the school bank owns item identity and wrong-idea labels (MF5)', () => {
  it('counts a library question by its library id, whether it came as homework or from the tutor', async () => {
    const define = (await stored(riya)).find((r) => r.outcome_id === DEFINE)!;
    const keys = Object.keys(define.cold_wins as object);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys.every((k) => k.startsWith('probe:probe-think-v4-'))).toBe(true);
    expect(keys).not.toContain(`item:${itemId.a1}`);
  });

  it('names a wrong option by the bank’s label, on homework and in the tutor alike, and confirms it across two items', async () => {
    const closure = (await stored(riya)).find((r) => r.outcome_id === CLOSURE)!;
    const ideas = closure.misconceptions as Record<string, { label: string | null; items: string[] }>;
    const idea = ideas[normaliseMisconception(SERVER_IDEA)];
    expect(idea.label).toBe(SERVER_IDEA);
    expect(idea.items.sort()).toEqual([`probe:${ref.b1}`, `probe:${ref.b2}`]);
    expect(JSON.stringify(ideas)).not.toContain('client wording');
  });

  it('keeps a wrong idea from a question the bank does not hold by id only, with no text', async () => {
    const closure = (await stored(riya)).find((r) => r.outcome_id === CLOSURE)!;
    const ideas = closure.misconceptions as Record<string, { label: string | null }>;
    expect(ideas[normaliseMisconception(UNMATCHED_IDEA)].label).toBeNull();
    expect(JSON.stringify(Object.values(ideas))).not.toContain('SENTINEL');
  });
});

describe('the server’s clock, not the phone’s (MF3)', () => {
  const coldRights = (
    user: string,
    first: { startedAt: string; receivedAt?: string },
  ): Promise<unknown> =>
    sitting(user, 'quiz', first, [quiz('a1', 0), quiz('a2', 0)]).then(() =>
      sitting(user, 'quiz', {}, [quiz('a3', 0)]),
    );

  it('GUARD: two sittings the server received a day apart can earn mastered', async () => {
    const kid = await createUser(db);
    await coldRights(kid, { startedAt: ago(25), receivedAt: ago(25) });
    await think(db, [kid]);
    const define = (await stored(kid)).find((r) => r.outcome_id === DEFINE)!;
    expect(define.mastered_at).not.toBeNull();
  });

  it('does not let a phone backdate a sitting to earn mastered: sent together, they are one day', async () => {
    const kid = await createUser(db);
    await coldRights(kid, { startedAt: ago(25) });
    await think(db, [kid]);
    const define = (await stored(kid)).find((r) => r.outcome_id === DEFINE)!;
    expect(define.mastered_at).toBeNull();
  });

  it('schedules nothing from a phone clock in 2099, and pulls a 2001 clock to a week before receipt', async () => {
    const kid = await createUser(db);
    await sitting(kid, 'quiz', { startedAt: '2099-01-01T00:00:00Z' }, [
      { ...quiz('a1', 0), at: '2099-01-01T00:00:00Z' },
      { ...quiz('b1', 0), at: '2001-01-01T00:00:00Z' },
    ]);
    await think(db, [kid]);
    const { rows } = await db.query<{ late: string[]; early: boolean; cursor_ok: boolean }>(
      `select
         array(select cs.outcome_id || '.' || c.name
                 from public.concept_state cs,
                      lateral (values ('last_practiced_at', cs.last_practiced_at),
                                      ('last_unassisted_success_at', cs.last_unassisted_success_at),
                                      ('mastered_at', cs.mastered_at),
                                      ('last_exposed_at', cs.last_exposed_at),
                                      ('last_retrieved_at', cs.last_retrieved_at)) as c(name, t)
                where cs.user_id = $1 and c.t > now() + interval '5 minutes'
               union all
               select cs.outcome_id || '.next_review_at' from public.concept_state cs
                where cs.user_id = $1 and cs.next_review_at > now() + interval '1 day 5 minutes') as late,
         (select last_practiced_at between now() - interval '7 days 1 minute' and now() - interval '6 days 23 hours'
            from public.concept_state where user_id = $1 and outcome_id = $2) as early,
         (select folded_through_at <= now() + interval '5 minutes' from public.learner_model where user_id = $1)
           as cursor_ok`,
      [kid, CLOSURE],
    );
    expect(rows[0]).toEqual({ late: [], early: true, cursor_ok: true });
  });
});

describe('one transaction per learner, under a lock (MF9)', () => {
  it('never reads or writes outside a transaction it was handed', async () => {
    const guarded: Sql = {
      query: () => Promise.reject(new Error('think queried outside a transaction')),
      transaction: (fn) => db.transaction(fn),
    };
    // A rebuild, so the run reads and writes everything (riya's snapshot
    // already holds her ledger, and a fold forward would read nothing).
    await expect(think(guarded, [riya], { rebuild: true })).resolves.toMatchObject({ students: 1 });
  });

  it('holds a per-learner advisory lock until the transaction ends (the lock SQL, run on PGlite)', async () => {
    const lockSql = `select count(*)::int as n from pg_locks
                      where locktype = 'advisory' and objsubid = 1
                        and objid = ((hashtext($1::text)::bigint) & 4294967295)::oid`;
    const inside = await db.transaction(async (tx) => {
      await thinkLearner(tx, riya);
      return (await tx.query<{ n: number }>(lockSql, [riya])).rows[0].n;
    });
    expect(inside).toBe(1);
    expect((await db.query<{ n: number }>(lockSql, [riya])).rows[0].n).toBe(0);
  });

  it('changes nothing when run again over the same ledger', async () => {
    const before = await stored(riya);
    await think(db, [riya]);
    await think(db, [riya]);
    expect(await stored(riya)).toEqual(before);
  });

  it('leaves the last good model in place when a write fails halfway', async () => {
    const kid = await createUser(db);
    await sitting(kid, 'quiz', {}, [quiz('a1', 0)]);
    await think(db, [kid]);
    const good = await stored(kid);
    await sitting(kid, 'quiz', {}, [quiz('b1', 2)]);
    const failing: Sql = {
      query: (sql, params) => db.query(sql, params),
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({
            query: (sql: string, params?: unknown[]) =>
              /insert into public\.learner_model/.test(sql)
                ? Promise.reject(new Error('the connection dropped'))
                : tx.query(sql, params),
          } as typeof tx),
        ),
    };
    await expect(think(failing, [kid])).rejects.toThrow(/connection dropped/);
    expect(await stored(kid)).toEqual(good);
    await think(db, [kid]);
    expect(await stored(kid)).not.toEqual(good);
  });
});

describe('what is written of the wrong ideas stays inside 0060’s size line (SF12)', () => {
  // The largest record the fold can hold: 20 ideas, each with a 120-character
  // label (quotes, a backslash and non-ASCII letters, which print as more
  // than one byte or with an escape) and 8 items and 8 sittings.
  const label = (n: number) => `${n} "thinks" \\ é\t${'x'.repeat(100)}`.slice(0, 120);
  const idea = (n: number): Misconception => {
    // Every third idea is a slip: one item, one sitting. The rest are confirmed.
    const slip = n % 3 === 0;
    return {
      label: label(n),
      count: n + 1,
      items: Array.from({ length: slip ? 1 : 8 }, (_, k) => `probe:probe-sci10-some-long-library-question-${n}-${k}`),
      sittings: Array.from({ length: slip ? 1 : 8 }, () => crypto.randomUUID()),
      firstAt: ago(200 - n),
      lastAt: ago(100 - n),
      clearedAt: null,
      clearing: [],
    };
  };
  const full: Record<string, Misconception> = Object.fromEntries(
    Array.from({ length: 20 }, (_, n) => [normaliseMisconception(label(n)), idea(n)]),
  );
  const bank = new Set(Object.values(full).map((m) => normaliseMisconception(m.label!)));

  it('measures a record exactly as Postgres prints it', async () => {
    const { rows } = await db.query<{ n: number }>(`select octet_length($1::jsonb::text)::int as n`, [
      JSON.stringify(full),
    ]);
    expect(rows[0].n).toBeGreaterThan(MISCONCEPTIONS_MAX_BYTES);
    expect(jsonbTextBytes(full)).toBe(rows[0].n);
  });

  it('drops slips before confirmed ideas until it fits, and the row then writes', async () => {
    const fitted = writableMisconceptions(full, bank);
    expect(jsonbTextBytes(fitted)).toBeLessThanOrEqual(MISCONCEPTIONS_MAX_BYTES);
    const kept = Object.values(fitted);
    const dropped = Object.entries(full).filter(([id]) => !(id in fitted)).map(([, m]) => m);
    expect(dropped.length).toBeGreaterThan(0);
    // Nothing confirmed went while a slip stayed.
    if (dropped.some(isConfirmed)) expect(kept.every(isConfirmed)).toBe(true);
    const kid = await createUser(db);
    await db.query(
      `insert into public.concept_state (org_id, user_id, outcome_id, mastery, unassisted_mastery, assisted_performance,
                                         misconceptions)
       values ($1, $2, $3, 0.35, 0.35, 0.35, $4::jsonb)`,
      [await orgOf(kid), kid, CLOSURE, JSON.stringify(fitted)],
    );
  });

  it('keeps text only for labels the bank gave', () => {
    const one = Object.fromEntries(Object.entries(full).slice(0, 2));
    const [first, second] = Object.keys(one);
    const out = writableMisconceptions(one, new Set([first]));
    expect(out[first].label).toBe(full[first].label);
    expect(out[second].label).toBeNull();
  });
});
