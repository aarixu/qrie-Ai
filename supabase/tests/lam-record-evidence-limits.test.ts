// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createUser, freshDatabase } from './harness';

/**
 * 0111: record_evidence bounds what one event can name (lam-one-brain M2
 * review).
 *
 * Since 0110 record_evidence is the phone's only way to write evidence, and
 * 0107 bounded only the payload. The brain makes a concept_state row for every
 * outcome id it reads, graph or not, so a child's token could make any number
 * of rows and ledger bytes. 0111 refuses an event naming more than 32 outcomes
 * or an outcome id over 200 characters ('bad-outcomes'), a topicRef over 200
 * characters on the event or its sitting ('bad-topic'), and a call with more
 * than 500 sittings (22023, as for more than 500 events).
 */

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

interface Result {
  id: string;
  status: 'recorded' | 'duplicate' | 'refused';
  reason: string | null;
}

type Json = Record<string, unknown>;

const record = (user: string, sessions: unknown, events: unknown): Promise<Result[]> =>
  asUser(db, user, async (tx) =>
    (
      await tx.query<Result>(`select id, status, reason from public.record_evidence($1::jsonb, $2::jsonb)`, [
        JSON.stringify(sessions),
        JSON.stringify(events),
      ])
    ).rows,
  );

const code = (fn: () => Promise<unknown>): Promise<string | null> =>
  fn().then(
    () => null,
    (e: { code?: string }) => e.code ?? 'no-code',
  );

const sitting = (over: Json = {}): Json => ({
  id: crypto.randomUUID(),
  source: 'class',
  topicRef: 'class8-mathematics/rational-numbers',
  startedAt: new Date().toISOString(),
  ...over,
});

const taught = (session: Json, seq: number, outcomeIds: unknown, over: Json = {}): Json => ({
  id: crypto.randomUUID(),
  sessionId: session.id,
  seq,
  at: new Date().toISOString(),
  kind: 'taught',
  source: session.source,
  surface: 'tap',
  outcomeIds,
  payload: { lessonId: 'l1' },
  ...over,
});

const outcomes = (n: number, length = 60): string[] =>
  Array.from({ length: n }, (_, i) => `o${i}-`.padEnd(length, 'x'));

const countEvents = async (user: string): Promise<number> =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.ledger_event where user_id = $1`, [user]))
    .rows[0].n;

const countSittings = async (user: string): Promise<number> =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.learning_session where user_id = $1`, [user]))
    .rows[0].n;

describe('0111 record_evidence: what one event may name', () => {
  it('takes 32 outcome ids of 200 characters, and refuses 33 or one of 201 as bad-outcomes', async () => {
    const kid = await createUser(db);
    const s = sitting();
    const out = await record(kid, [s], [
      taught(s, 0, outcomes(32, 200)),
      taught(s, 1, outcomes(33)),
      taught(s, 2, [...outcomes(1), 'y'.repeat(201)]),
    ]);
    expect(out.map((r) => [r.status, r.reason])).toEqual([
      ['recorded', null],
      ['refused', 'bad-outcomes'],
      ['refused', 'bad-outcomes'],
    ]);
    expect(await countEvents(kid)).toBe(1);
  });

  it('refuses a topicRef over 200 characters, on the event or on the sitting it would open', async () => {
    const kid = await createUser(db);
    const ok = sitting({ topicRef: 't'.repeat(200) });
    const longSitting = sitting({ topicRef: 't'.repeat(201) });
    const out = await record(kid, [ok, longSitting], [
      taught(ok, 0, outcomes(1), { topicRef: 't'.repeat(200) }),
      taught(ok, 1, outcomes(1), { topicRef: 't'.repeat(201) }),
      taught(longSitting, 0, outcomes(1)),
    ]);
    expect(out.map((r) => [r.status, r.reason])).toEqual([
      ['recorded', null],
      ['refused', 'bad-topic'],
      ['refused', 'bad-topic'],
    ]);
    expect(await countEvents(kid)).toBe(1);
    // The refused sitting was never opened.
    expect(await countSittings(kid)).toBe(1);
  });

  it('refuses a call of more than 500 sittings, as malformed (22023), and takes 500', async () => {
    const kid = await createUser(db);
    const s = sitting();
    const filler = Array.from({ length: 500 }, () => sitting());
    expect(await code(() => record(kid, [s, ...filler], [taught(s, 0, outcomes(1))]))).toBe('22023');
    expect(await countEvents(kid)).toBe(0);
    expect((await record(kid, [s, ...filler.slice(1)], [taught(s, 0, outcomes(1))]))[0].status).toBe('recorded');
  });
});
