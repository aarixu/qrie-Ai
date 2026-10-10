// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from './fixtures';
import { asUser, createUser, freshDatabase } from './harness';

/**
 * 0107: public.record_evidence, the one door the tutor's evidence comes in by
 * (lam-one-brain Task 7a, review MF1, MF2, MF3, SF2).
 *
 * Run as the real roles: a student's token calls it as `authenticated`, and
 * the function decides the org, the learner and the server's clock itself.
 * Since 0110 (Task 7b) it is the phone's only way in: direct inserts are
 * refused (supabase/tests/lam-revoke-direct-inserts.test.ts). Nothing here
 * depends on that.
 */

let db: PGlite;
let school: School;

beforeAll(async () => {
  db = await freshDatabase();
  school = await buildSchool(db, 'REV');
});
afterAll(async () => {
  await db.close();
});

interface Result {
  id: string;
  status: 'recorded' | 'duplicate' | 'refused';
  reason: string | null;
  received_at: string | Date | null;
}

type Json = Record<string, unknown>;

const record = (user: string, sessions: unknown, events: unknown): Promise<Result[]> =>
  asUser(db, user, async (tx) =>
    (
      await tx.query<Result>(`select * from public.record_evidence($1::jsonb, $2::jsonb)`, [
        JSON.stringify(sessions),
        JSON.stringify(events),
      ])
    ).rows,
  );

const sitting = (over: Json = {}): Json => ({
  id: crypto.randomUUID(),
  source: 'class',
  topicRef: 'class8-mathematics/rational-numbers',
  startedAt: new Date().toISOString(),
  ...over,
});

const answer = (session: Json, seq: number, over: Json = {}, payload: Json = {}): Json => ({
  id: crypto.randomUUID(),
  sessionId: session.id,
  seq,
  at: new Date().toISOString(),
  kind: 'answered',
  source: session.source,
  surface: 'tap',
  outcomeIds: ['class8-mathematics-rational-numbers-define-rational-number'],
  payload: { correct: true, chosenIndex: 0, ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0, ...payload },
  ...over,
});

const eventRow = async (id: string): Promise<Json | undefined> =>
  (
    await db.query<Json>(
      `select id, org_id, user_id, session_id, seq, source, at, received_at, payload from public.ledger_event where id = $1`,
      [id],
    )
  ).rows[0];

const sessionRow = async (id: string): Promise<Json | undefined> =>
  (await db.query<Json>(`select * from public.learning_session where id = $1`, [id])).rows[0];

const countEvents = async (user: string): Promise<number> =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.ledger_event where user_id = $1`, [user]))
    .rows[0].n;

const orgOf = async (user: string): Promise<string> =>
  (await db.query<{ org_id: string }>(`select org_id from public.membership where user_id = $1`, [user])).rows[0]
    .org_id;

const ms = (v: unknown): number => (v instanceof Date ? v : new Date(String(v))).getTime();

describe('0107 record_evidence: what it writes', () => {
  it('records a sitting and its answers as the caller, in the caller’s org, on the server’s clock', async () => {
    const kid = await createUser(db);
    const s = sitting();
    const e = answer(s, 1);
    const out = await record(kid, [s], [e]);

    expect(out).toEqual([
      expect.objectContaining({ id: e.id, status: 'recorded', reason: null }),
    ]);
    expect(out[0].received_at).not.toBeNull();
    const row = await eventRow(e.id as string);
    expect(row).toMatchObject({ user_id: kid, org_id: await orgOf(kid), session_id: s.id, seq: 1, source: 'class' });
    expect(ms(out[0].received_at)).toBe(ms(row!.received_at));
    expect(await sessionRow(s.id as string)).toMatchObject({
      user_id: kid,
      org_id: await orgOf(kid),
      source: 'class',
      topic_ref: 'class8-mathematics/rational-numbers',
    });
  });

  it('takes the org and the learner from the token, never from the input', async () => {
    const kid = await createUser(db);
    const s = sitting({ org_id: school.org, user_id: school.kid8a, orgId: school.org, userId: school.kid8a });
    const e = answer(s, 1, { org_id: school.org, user_id: school.kid8a, orgId: school.org, userId: school.kid8a });
    const out = await record(kid, [s], [e]);
    expect(out[0].status).toBe('recorded');
    expect(await eventRow(e.id as string)).toMatchObject({ user_id: kid, org_id: await orgOf(kid) });
    expect(await sessionRow(s.id as string)).toMatchObject({ user_id: kid, org_id: await orgOf(kid) });
  });

  it('files a school child’s tutor evidence under the school', async () => {
    const s = sitting();
    const e = answer(s, 1);
    expect((await record(school.kid8a, [s], [e]))[0].status).toBe('recorded');
    expect(await eventRow(e.id as string)).toMatchObject({ user_id: school.kid8a, org_id: school.org });
  });

  it('pulls a forged 2099 clock back to within five minutes of receipt, on the event and the sitting', async () => {
    const kid = await createUser(db);
    const s = sitting({ startedAt: '2099-01-01T00:00:00Z' });
    const e = answer(s, 1, { at: '2099-01-01T00:00:00Z' });
    const out = await record(kid, [s], [e]);
    expect(out[0].status).toBe('recorded');
    const row = await eventRow(e.id as string);
    const received = ms(row!.received_at);
    expect(ms(row!.at)).toBeLessThanOrEqual(received + 5 * 60_000);
    expect(ms((await sessionRow(s.id as string))!.started_at)).toBeLessThanOrEqual(received + 5 * 60_000);
  });

  it('pulls a backdated clock forward to within seven days of receipt', async () => {
    const kid = await createUser(db);
    const s = sitting({ startedAt: '2001-01-01T00:00:00Z' });
    const e = answer(s, 1, { at: '2001-01-01T00:00:00Z' });
    await record(kid, [s], [e]);
    const row = await eventRow(e.id as string);
    const received = ms(row!.received_at);
    expect(ms(row!.at)).toBeGreaterThanOrEqual(received - 7 * 86_400_000);
    expect(ms((await sessionRow(s.id as string))!.started_at)).toBeGreaterThanOrEqual(received - 7 * 86_400_000);
  });

  it('opens the sitting from the event itself when its opening was not sent, so no answer is lost', async () => {
    const kid = await createUser(db);
    const s = sitting({ source: 'quiz' });
    const e = answer(s, 3, { topicRef: 'class8-mathematics/rational-numbers' });
    const out = await record(kid, [], [e]);
    expect(out[0].status).toBe('recorded');
    expect(await sessionRow(s.id as string)).toMatchObject({ user_id: kid, source: 'quiz' });
  });

  it('adds to a sitting a previous call opened', async () => {
    const kid = await createUser(db);
    const s = sitting();
    await record(kid, [s], [answer(s, 1)]);
    const later = answer(s, 2);
    expect((await record(kid, [], [later]))[0].status).toBe('recorded');
    expect(await countEvents(kid)).toBe(2);
  });
});

describe('0107 record_evidence: replay is free', () => {
  it('answers a repeated event as a duplicate, with the time it first arrived, and writes nothing', async () => {
    const kid = await createUser(db);
    const s = sitting();
    const e = answer(s, 1);
    const first = await record(kid, [s], [e]);
    const again = await record(kid, [s], [e]);
    expect(again).toEqual([expect.objectContaining({ id: e.id, status: 'duplicate', reason: null })]);
    expect(ms(again[0].received_at)).toBe(ms(first[0].received_at));
    expect(await countEvents(kid)).toBe(1);
  });

  it('never moves a sitting a replay names again', async () => {
    const kid = await createUser(db);
    const s = sitting({ source: 'class' });
    await record(kid, [s], [answer(s, 1)]);
    const before = await sessionRow(s.id as string);
    await record(kid, [{ ...s, source: 'quiz', topicRef: 'elsewhere', startedAt: '2001-01-01T00:00:00Z' }], []);
    expect(await sessionRow(s.id as string)).toEqual(before);
  });
});

describe('0107 record_evidence: what it refuses, one event at a time', () => {
  it.each(['practice', 'homework', 'test', 'api'])(
    'refuses %s from a child’s phone and writes nothing (only the LMS functions write it)',
    async (source) => {
      const before = await countEvents(school.kid8a);
      const s = sitting({ source });
      const e = answer(s, 1, { source });
      const out = await record(school.kid8a, [s], [e]);
      expect(out).toEqual([expect.objectContaining({ id: e.id, status: 'refused', reason: 'source', received_at: null })]);
      expect(await countEvents(school.kid8a)).toBe(before);
      expect(await sessionRow(s.id as string)).toBeUndefined();
    },
  );

  it('refuses an event in somebody else’s sitting', async () => {
    const owner = await createUser(db);
    const thief = await createUser(db);
    const s = sitting();
    await record(owner, [s], [answer(s, 1)]);
    const e = answer(s, 2);
    const out = await record(thief, [s], [e]);
    expect(out[0]).toMatchObject({ status: 'refused', reason: 'not-your-session' });
    expect(await eventRow(e.id as string)).toBeUndefined();
  });

  it('refuses an id somebody else already holds instead of calling it a replay', async () => {
    const owner = await createUser(db);
    const thief = await createUser(db);
    const s = sitting();
    const e = answer(s, 1);
    await record(owner, [s], [e]);
    const t = sitting();
    const out = await record(thief, [t], [{ ...e, sessionId: t.id }]);
    expect(out[0]).toMatchObject({ status: 'refused', reason: 'id-taken', received_at: null });
  });

  it('refuses a second event at one place in a sitting and keeps the rest of the batch', async () => {
    const kid = await createUser(db);
    const s = sitting();
    const a = answer(s, 1);
    const b = answer(s, 1);
    const c = answer(s, 2);
    const out = await record(kid, [s], [a, b, c]);
    expect(out.map((r) => [r.id, r.status, r.reason])).toEqual([
      [a.id, 'recorded', null],
      [b.id, 'refused', 'seq-taken'],
      [c.id, 'recorded', null],
    ]);
  });

  it.each([
    ['a help rung past the ladder', { assistanceRung: 9 }, 'bad-rung'],
    ['a negative help rung', { assistanceRung: -1 }, 'bad-rung'],
    ['a fractional help rung', { assistanceRung: 2.5 }, 'bad-rung'],
    ['a payload over 4 KB', { padding: 'x'.repeat(5000) }, 'too-big'],
    ['a stored answer over 200 characters', { answerNormalised: 'a'.repeat(201) }, 'answer-too-long'],
  ])('refuses %s', async (_what, payload, reason) => {
    const kid = await createUser(db);
    const s = sitting();
    const e = answer(s, 1, {}, payload);
    const out = await record(kid, [s], [e]);
    expect(out[0]).toMatchObject({ status: 'refused', reason });
    expect(await countEvents(kid)).toBe(0);
  });

  it('refuses a helped event whose rung is off the ladder', async () => {
    const kid = await createUser(db);
    const s = sitting();
    const e = { ...answer(s, 1), kind: 'helped', payload: { rung: 12, requested: true } };
    expect((await record(kid, [s], [e]))[0]).toMatchObject({ status: 'refused', reason: 'bad-rung' });
  });

  it.each([
    ['an id that is not a uuid', { id: 'abc:0' }, 'bad-id'],
    ['a sitting id that is not a uuid', { sessionId: 'nope' }, 'bad-session'],
    ['a negative place in the sitting', { seq: -1 }, 'bad-seq'],
    ['a place that is not a whole number', { seq: 1.5 }, 'bad-seq'],
    ['an unknown kind', { kind: 'cheated' }, 'bad-kind'],
    ['an unknown surface', { surface: 'telepathy' }, 'bad-surface'],
    ['a time that is not a time', { at: 'yesterday-ish' }, 'bad-at'],
    ['outcomes that are not a list of names', { outcomeIds: 'x' }, 'bad-outcomes'],
    ['a payload that is not an object', { payload: [1, 2] }, 'bad-payload'],
  ])('refuses %s without failing the call', async (_what, over, reason) => {
    const kid = await createUser(db);
    const s = sitting();
    const bad = answer(s, 1, over);
    const good = answer(s, 2);
    const out = await record(kid, [s], [bad, good]);
    expect(out[0]).toMatchObject({ id: String(bad.id), status: 'refused', reason });
    expect(out[1]).toMatchObject({ id: good.id, status: 'recorded' });
  });
});

describe('0107 record_evidence: the call itself', () => {
  const code = async (fn: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      await fn();
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };

  it('refuses a call whose events are not a list, as malformed (22023)', async () => {
    const kid = await createUser(db);
    expect(await code(() => record(kid, [], { id: 'x' }))).toBe('22023');
  });

  it('refuses a call of more than 500 events, as malformed (22023)', async () => {
    const kid = await createUser(db);
    const s = sitting();
    const many = Array.from({ length: 501 }, (_, i) => answer(s, i));
    expect(await code(() => record(kid, [s], many))).toBe('22023');
    expect(await countEvents(kid)).toBe(0);
  });

  it('is closed to anon', async () => {
    const failure = await db
      .transaction(async (tx) => {
        await tx.exec('set local role anon');
        await tx.query(`select * from public.record_evidence('[]'::jsonb, '[]'::jsonb)`);
      })
      .then(() => null, (e: Error) => e.message);
    expect(failure).toMatch(/permission denied/);
  });
});

describe('0107 close_learning_session: time on task bounded by the sitting', () => {
  const close = (user: string, session: string, endedAt: string | null, activeMs: number): Promise<unknown> =>
    asUser(db, user, (tx) =>
      tx.query(`select public.close_learning_session($1, $2, $3)`, [session, endedAt, activeMs]),
    );

  it('pulls a forged end back to the server’s clock and active time into the sitting’s span', async () => {
    const kid = await createUser(db);
    const s = sitting();
    await record(kid, [s], []);
    await record(kid, [], [answer(s, 1)]);
    await close(kid, s.id as string, '2099-01-01T00:00:00Z', 2_147_483_647);
    const row = await sessionRow(s.id as string);
    expect(ms(row!.ended_at)).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000);
    expect(row!.active_ms as number).toBeLessThanOrEqual(ms(row!.ended_at) - ms(row!.started_at));
  });

  it('never ends a sitting before it began', async () => {
    const kid = await createUser(db);
    const s = sitting();
    await record(kid, [s], [answer(s, 1)]);
    await close(kid, s.id as string, '2001-01-01T00:00:00Z', 60_000);
    const row = await sessionRow(s.id as string);
    expect(ms(row!.ended_at)).toBe(ms(row!.started_at));
    expect(row!.active_ms).toBe(0);
  });

  it('GUARD: keeps an honest close as it was sent', async () => {
    const kid = await createUser(db);
    const started = new Date(Date.now() - 20 * 60_000).toISOString();
    const ended = new Date(Date.now() - 5 * 60_000).toISOString();
    const s = sitting({ startedAt: started });
    await record(kid, [s], [answer(s, 1)]);
    await close(kid, s.id as string, ended, 9 * 60_000);
    const row = await sessionRow(s.id as string);
    expect(ms(row!.ended_at)).toBe(ms(ended));
    expect(row!.active_ms).toBe(9 * 60_000);
  });
});
