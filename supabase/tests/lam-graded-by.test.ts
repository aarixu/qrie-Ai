// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from './fixtures';
import { applyAfter, asUser, freshDatabase } from './harness';

/**
 * 0118: WHO GRADED AN ANSWER IS THE LEDGER'S OWN COLUMN (P2 security review, F1).
 *
 * Until 0118 the brain trusted an answer by fields a phone could write
 * before 0110 closed direct inserts: the 'api' source, a school source, or
 * `payload.graded = 'server'`. 0118 adds ledger_event.graded_by, 'phone' for
 * every row it finds, and sets 'server' only where it can prove it: a
 * homework or test answer that lms.submission_answer holds for the same
 * child (the first row per answer), and a tutor or practice answer it can
 * grade again against the library's key. From then on only the server's
 * functions write it.
 *
 * Rows are written here before 0118 exists, as the real functions wrote them
 * and as a token could have planted them, then 0118 is applied over them.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';

let db: PGlite;
let school: School;
let probe: string;
let homework: string;
let submission: string;
const ids: Record<string, string> = {};

type Row = { graded_by: string; payload: Record<string, unknown>; outcome_ids: string[]; received_at: string };
const row = async (id: string): Promise<Row> =>
  (
    await db.query<Row>(`select graded_by, payload, outcome_ids, received_at::text from public.ledger_event where id = $1`, [
      id,
    ])
  ).rows[0];

async function sittingFor(user: string, source: string, received = 'now()'): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at, received_at)
     values ($1, $2, $3, $4, ${received}, ${received})`,
    [id, school.org, user, source],
  );
  return id;
}

/** A row inserted as the owner, as a student's token could under the 0006/0034 policies. */
async function plant(
  user: string,
  source: string,
  payload: Record<string, unknown>,
  opts: { kind?: string; outcomes?: string[]; received?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const session = await sittingFor(user, source, opts.received);
  await db.query(
    `insert into public.ledger_event
       (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface, outcome_ids, payload)
     values ($1, $2, $3, $4, 0, now(), ${opts.received ?? 'now()'}, $5, $6, 'tap', $7, $8::jsonb)`,
    [id, school.org, user, session, opts.kind ?? 'answered', source, opts.outcomes ?? [CLOSURE], JSON.stringify(payload)],
  );
  return id;
}

beforeAll(async () => {
  db = await freshDatabase({ through: '0117' });
  school = await buildSchool(db, 'GBY');
  probe = (
    await db.query<{ id: string }>(
      `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
       values ('probe-gby-1', $1, 8, 'Mathematics', 'mcq', 'Which is rational?', '["1/2","pi","root 2"]'::jsonb, 0,
               '["", "thinks pi is a fraction", ""]'::jsonb) returning id`,
      [[DEFINE]],
    )
  ).rows[0].id;
  await db.query(`insert into lms.item_approval (org_id, item_id) values ($1, $2)`, [school.org, probe]);
  homework = (
    await db.query<{ id: string }>(
      `insert into lms.assignment (org_id, section_id, subject_id, created_by, kind, title, due_at, attempts_allowed,
                                   answer_types)
       values ($1, $2, $3, $4, 'homework', 'Work', now() + interval '1 day', 3, '{mcq}')
       returning id`,
      [school.org, school.s8a, school.maths, school.teacherA],
    )
  ).rows[0].id;
  await db.query(`insert into lms.assignment_item (assignment_id, item_id, position) values ($1, $2, 1)`, [homework, probe]);
  await db.query(`update lms.assignment set published_at = now() - interval '2 days' where id = $1`, [homework]);
  submission = await asUser(db, school.kid8a, async (tx) =>
    (await tx.query<{ submission_id: string }>(`select * from lms.submit_mcq($1, $2::jsonb)`, [homework, JSON.stringify({ [probe]: 0 })]))
      .rows[0].submission_id,
  );
  ids.handedIn = (
    await db.query<{ id: string }>(`select id from public.ledger_event where payload ->> 'submissionId' = $1`, [submission])
  ).rows[0].id;

  // A tutor answer through record_evidence (0115): graded by the server then.
  const session = { id: crypto.randomUUID(), source: 'quiz', startedAt: new Date().toISOString() };
  ids.recorded = crypto.randomUUID();
  await asUser(db, school.kid8a, (tx) =>
    tx.query(`select * from public.record_evidence($1::jsonb, $2::jsonb)`, [
      JSON.stringify([session]),
      JSON.stringify([
        {
          id: ids.recorded, sessionId: session.id, seq: 0, at: new Date().toISOString(), kind: 'answered', source: 'quiz',
          surface: 'tap', outcomeIds: [DEFINE],
          payload: { correct: true, chosenIndex: 0, probeId: 'probe-gby-1', ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0 },
        },
      ]),
    ]),
  );

  // Planted: a copy of the real hand-in's answer, received later.
  ids.copy = await plant(school.kid8a, 'homework', {
    correct: true, chosenIndex: 0, itemId: probe, submissionId: submission, assignmentId: homework, attempt: 1, assistanceRung: 0,
  });
  // Planted: a homework answer no submission holds.
  ids.noSubmission = await plant(school.kid8a, 'homework', {
    correct: true, chosenIndex: 0, itemId: probe, submissionId: crypto.randomUUID(), attempt: 1, assistanceRung: 0,
  });
  // Planted: another child's real submission, claimed by this one.
  ids.otherChild = await plant(school.kid8b, 'homework', {
    correct: true, chosenIndex: 0, itemId: probe, submissionId: submission, attempt: 1, assistanceRung: 0,
  });
  ids.api = await plant(school.kid8a, 'api', { correct: true, chosenIndex: 0, probeId: 'p1', attempt: 1, assistanceRung: 0 });
  ids.claimed = await plant(school.kid8a, 'class', {
    correct: true, chosenIndex: 0, beatId: 'b1', graded: 'server', attempt: 1, assistanceRung: 0,
  });
  // Before 0115: the phone's "right" on a bank probe with the wrong option chosen, filed under another outcome.
  ids.oldProbe = await plant(school.kid8a, 'quiz', {
    correct: true, chosenIndex: 1, probeId: 'probe-gby-1', verdict: 'right', attempt: 1, assistanceRung: 0,
  });
  ids.practice = await plant(school.kid8a, 'practice', { correct: true, chosenIndex: 2, itemId: probe, assistanceRung: 0 });
  ids.future = await plant(school.kid8a, 'class', { correct: true, beatId: 'b2', attempt: 1, assistanceRung: 0 }, {
    received: `now() + interval '30 days'`,
  });
  ids.taught = await plant(school.kid8a, 'class', { beatId: 'b3', graded: 'server' }, { kind: 'taught' });

  await applyAfter(db, '0117');
});
afterAll(async () => {
  await db.close();
});

describe('0118 marks what it can prove, and nothing else', () => {
  it('every row starts as the phone’s', async () => {
    const { rows } = await db.query<{ column_default: string; is_nullable: string }>(
      `select column_default, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'ledger_event' and column_name = 'graded_by'`,
    );
    expect(rows[0]).toMatchObject({ is_nullable: 'NO' });
    expect(rows[0].column_default).toMatch(/'phone'/);
  });

  it('a hand-in lms.submission_answer holds for the same child is the server’s, once', async () => {
    expect((await row(ids.handedIn)).graded_by).toBe('server');
    expect((await row(ids.copy)).graded_by).toBe('phone');
    expect((await row(ids.noSubmission)).graded_by).toBe('phone');
    expect((await row(ids.otherChild)).graded_by).toBe('phone');
  });

  it('a tutor answer to a bank probe is graded again by 0115’s rule', async () => {
    expect((await row(ids.recorded)).graded_by).toBe('server');
    const old = await row(ids.oldProbe);
    expect(old.graded_by).toBe('server');
    expect(old.payload).toMatchObject({ correct: false, verdict: 'wrong', misconceptionId: 'thinks pi is a fraction', graded: 'server' });
    expect(old.outcome_ids).toEqual([DEFINE]);
  });

  it('a practice answer is graded again against its item', async () => {
    const p = await row(ids.practice);
    expect(p.graded_by).toBe('server');
    expect(p.payload).toMatchObject({ correct: false });
  });

  it('an api row and a class answer whose payload claimed the server stay the phone’s', async () => {
    expect((await row(ids.api)).graded_by).toBe('phone');
    const claimed = await row(ids.claimed);
    expect(claimed.graded_by).toBe('phone');
    expect(claimed.payload.graded).toBe('phone');
  });

  it('pulls a receipt time in the future back to now, and strips a grade from what is not an answer', async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select received_at <= now() as ok from public.ledger_event where id = $1
       union all
       select s.received_at <= now() from public.learning_session s join public.ledger_event e on e.session_id = s.id
        where e.id = $1`,
      [ids.future],
    );
    expect(rows.map((r) => r.ok)).toEqual([true, true]);
    expect((await row(ids.taught)).payload).not.toHaveProperty('graded');
  });

  it('no API role can set it', async () => {
    await expect(
      asUser(db, school.kid8a, (tx) => tx.query(`update public.ledger_event set graded_by = 'server' where id = $1`, [ids.api])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('after 0118 the server’s functions write it', () => {
  it('record_evidence: server for a bank probe it graded, phone for the rest', async () => {
    const session = { id: crypto.randomUUID(), source: 'class', startedAt: new Date().toISOString() };
    const [graded, phone] = [crypto.randomUUID(), crypto.randomUUID()];
    const base = { sessionId: session.id, at: new Date().toISOString(), kind: 'answered', source: 'class', surface: 'tap', outcomeIds: [DEFINE] };
    const p = { ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0 };
    await asUser(db, school.kid8a, (tx) =>
      tx.query(`select * from public.record_evidence($1::jsonb, $2::jsonb)`, [
        JSON.stringify([session]),
        JSON.stringify([
          { ...base, id: graded, seq: 0, payload: { ...p, correct: true, chosenIndex: 0, probeId: 'probe-gby-1' } },
          { ...base, id: phone, seq: 1, payload: { ...p, correct: true, beatId: 'b9', graded: 'server' } },
        ]),
      ]),
    );
    expect((await row(graded)).graded_by).toBe('server');
    expect((await row(phone)).graded_by).toBe('phone');
  });

  it('a hand-in and a practice answer are the server’s', async () => {
    const again = await asUser(db, school.kid8a, async (tx) =>
      (await tx.query<{ submission_id: string }>(`select * from lms.submit_mcq($1, $2::jsonb)`, [homework, JSON.stringify({ [probe]: 1 })]))
        .rows[0].submission_id,
    );
    const { rows } = await db.query<{ graded_by: string }>(
      `select graded_by from public.ledger_event where payload ->> 'submissionId' = $1`,
      [again],
    );
    expect(rows.map((r) => r.graded_by)).toEqual(['server']);

    // Practice: the item is the school's to practise once its homework is past due.
    await db.query(`update lms.assignment set due_at = now() - interval '1 minute' where id = $1`, [homework]);
    const practice = crypto.randomUUID();
    await asUser(db, school.kid8a, (tx) =>
      tx.query(`select * from lms.check_practice_answer($1, $2, 0)`, [practice, probe]),
    );
    const { rows: done } = await db.query<{ graded_by: string }>(
      `select graded_by from public.ledger_event where session_id = $1`,
      [practice],
    );
    expect(done.map((r) => r.graded_by)).toEqual(['server']);
  });
});
