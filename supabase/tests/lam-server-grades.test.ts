// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from './fixtures';
import { asUser, freshDatabase } from './harness';

/**
 * 0115: the server grades the tutor answers it has a key for (lam-one-brain
 * Task 15, C2).
 *
 * record_evidence looks an answer's `probeId` up in the library
 * (lms.item.library_ref). With a `chosenIndex` and a key, `correct` is the
 * key's verdict, not the phone's, the outcomes are the item's, a wrong
 * answer's misconceptionId is the bank's label for the option chosen, and the
 * payload says `graded: 'server'`. Every other answer says `graded: 'phone'`,
 * whatever the phone sent. Run as the real roles.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';

let db: PGlite;
let school: School;

beforeAll(async () => {
  db = await freshDatabase();
  school = await buildSchool(db, 'GRD');
  await db.query(
    `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
     values ('probe-grd-1', $1, 8, 'Mathematics', 'mcq', 'Which is rational?', '["1/2","pi","root 2"]'::jsonb, 0,
             '["", "thinks pi is a fraction", ""]'::jsonb)`,
    [[DEFINE]],
  );
});
afterAll(async () => {
  await db.close();
});

type Json = Record<string, unknown>;

const record = (user: string, sessions: unknown, events: unknown): Promise<{ id: string; status: string; reason: string | null }[]> =>
  asUser(db, user, async (tx) =>
    (
      await tx.query<{ id: string; status: string; reason: string | null }>(
        `select id, status, reason from public.record_evidence($1::jsonb, $2::jsonb)`,
        [JSON.stringify(sessions), JSON.stringify(events)],
      )
    ).rows,
  );

const sitting = (source = 'quiz'): Json => ({
  id: crypto.randomUUID(),
  source,
  topicRef: 'class8-mathematics/rational-numbers',
  startedAt: new Date().toISOString(),
});

const event = (session: Json, seq: number, kind: string, payload: Json, outcomeIds = [DEFINE]): Json => ({
  id: crypto.randomUUID(),
  sessionId: session.id,
  seq,
  at: new Date().toISOString(),
  kind,
  source: session.source,
  surface: 'tap',
  outcomeIds,
  payload,
});

const answer = (session: Json, seq: number, payload: Json, outcomeIds?: string[]): Json =>
  event(session, seq, 'answered', { ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0, ...payload }, outcomeIds);

const stored = async (id: unknown): Promise<{ payload: Json; outcome_ids: string[] }> =>
  (
    await db.query<{ payload: Json; outcome_ids: string[] }>(
      `select payload, outcome_ids from public.ledger_event where id = $1`,
      [id],
    )
  ).rows[0];

describe('record_evidence grades an answer to a bank probe', () => {
  it('six phone-claimed rights with the wrong option chosen are stored as wrongs, with the bank’s wrong idea', async () => {
    const s = sitting();
    const events = Array.from({ length: 6 }, (_, n) =>
      answer(s, n, { probeId: 'probe-grd-1', chosenIndex: 1, correct: true, verdict: 'right' }),
    );
    const receipts = await record(school.kid8a, [s], events);
    expect(receipts.every((r) => r.status === 'recorded')).toBe(true);
    for (const e of events) {
      const { payload } = await stored(e.id);
      expect(payload.correct).toBe(false);
      expect(payload.graded).toBe('server');
      expect(payload.verdict).toBe('wrong');
      expect(payload.misconceptionId).toBe('thinks pi is a fraction');
      // The rest of what the phone sent keeps its meaning.
      expect(payload.chosenIndex).toBe(1);
      expect(payload.probeId).toBe('probe-grd-1');
      expect(payload.ms).toBe(4000);
    }
  });

  it('a right option the phone called wrong is right, with no wrong idea', async () => {
    const s = sitting('diagnostic');
    const e = answer(s, 0, { probeId: 'probe-grd-1', chosenIndex: 0, correct: false, misconceptionId: 'made up' });
    await record(school.kid8a, [s], [e]);
    const { payload } = await stored(e.id);
    expect(payload.correct).toBe(true);
    expect(payload.graded).toBe('server');
    expect(payload).not.toHaveProperty('misconceptionId');
    expect(payload).not.toHaveProperty('verdict');
  });

  it('files the answer under the probe’s outcome, not the one the phone named', async () => {
    const s = sitting();
    const e = answer(s, 0, { probeId: 'probe-grd-1', chosenIndex: 0, correct: true }, [CLOSURE]);
    await record(school.kid8a, [s], [e]);
    expect((await stored(e.id)).outcome_ids).toEqual([DEFINE]);
  });

  it('an option the question does not have is wrong', async () => {
    const s = sitting();
    const e = answer(s, 0, { probeId: 'probe-grd-1', chosenIndex: 7, correct: true });
    await record(school.kid8a, [s], [e]);
    const { payload } = await stored(e.id);
    expect(payload.correct).toBe(false);
    expect(payload.graded).toBe('server');
  });
});

describe('every other answer is the phone’s word, and says so', () => {
  it('a class lesson’s beat, which no key on the server covers', async () => {
    const s = sitting('class');
    const e = answer(s, 0, { beatId: 'b3_4', chosenIndex: 1, correct: true });
    await record(school.kid8a, [s], [e]);
    const { payload } = await stored(e.id);
    expect(payload.correct).toBe(true);
    expect(payload.graded).toBe('phone');
  });

  it('a probe the library does not hold', async () => {
    const s = sitting();
    const e = answer(s, 0, { probeId: 'probe-not-in-the-library', chosenIndex: 1, correct: true });
    await record(school.kid8a, [s], [e]);
    expect((await stored(e.id)).payload).toMatchObject({ correct: true, graded: 'phone' });
  });

  it('a bank probe answered out loud, with no option chosen', async () => {
    const s = sitting('class');
    const e: Json = { ...answer(s, 0, { probeId: 'probe-grd-1', correct: true, verdict: 'right' }), surface: 'voice' };
    await record(school.kid8a, [s], [e]);
    expect((await stored(e.id)).payload).toMatchObject({ correct: true, graded: 'phone', verdict: 'right' });
  });

  it('a phone that writes graded: server itself is overruled', async () => {
    const s = sitting('class');
    const e = answer(s, 0, { beatId: 'b1', chosenIndex: 0, correct: true, graded: 'server' });
    await record(school.kid8a, [s], [e]);
    expect((await stored(e.id)).payload.graded).toBe('phone');
  });

  it('only answers carry a grade: one sent on anything else is dropped (0118)', async () => {
    const s = sitting('class');
    const e = event(s, 0, 'taught', { lessonId: 'l1', graded: 'server' });
    await record(school.kid8a, [s], [e]);
    expect((await stored(e.id)).payload).toEqual({ lessonId: 'l1' });
  });

  it('a payload the grade would push past the ledger’s limit is refused as too big', async () => {
    const s = sitting('class');
    const e = answer(s, 0, { beatId: 'b1', correct: true, pad: '' });
    const size = async (p: unknown) =>
      (await db.query<{ n: number }>(`select octet_length($1::jsonb::text) as n`, [JSON.stringify(p)])).rows[0].n;
    // 4,090 bytes as sent, under the limit; the grade adds more than six.
    (e.payload as Json).pad = 'x'.repeat(4090 - (await size(e.payload)));
    expect(await size(e.payload)).toBe(4090);
    const [r] = await record(school.kid8a, [s], [e]);
    expect(r).toMatchObject({ status: 'refused', reason: 'too-big' });
  });
});

describe('the verified figures (0115)', () => {
  it('concept_state holds them, unverified by default, and the model is version 5 or later', async () => {
    const { rows } = await db.query<{ column_name: string; column_default: string }>(
      `select column_name, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'concept_state'
          and column_name in ('verified_mastery', 'verified_observations') order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(['verified_mastery', 'verified_observations']);
    expect(Number(rows[0].column_default)).toBe(0.5);
    expect(Number(rows[1].column_default)).toBe(0);
    const v = await db.query<{ column_default: string }>(
      `select column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'learner_model' and column_name = 'version'`,
    );
    // 0116 moved it on to 6 (Task 16); lam-asked-items.test.ts pins that.
    expect(Number(v.rows[0].column_default)).toBeGreaterThanOrEqual(5);
  });
});
