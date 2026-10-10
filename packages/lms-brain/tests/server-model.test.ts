// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyParams } from '@ai-tutor/knowledge-graph';
import {
  MODEL_VERSION,
  foldSessionReport,
  placeOnArrival,
  type ConceptState,
  type LearnerModel,
} from '@ai-tutor/learner-model';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { asUser, createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import {
  heldByServer,
  libraryIndex,
  modelFromServer,
  onServerModel,
  think,
  type SentEvent,
  type ServerModel,
} from '../src/index.ts';

/**
 * THE PHONE BUILDS ON THE SERVER'S MODEL (lam-one-brain Task 11, review SF4).
 *
 * The tutor takes what the brain wrote (public.my_learner_model, 0109) as its
 * base and folds on top only its own events the brain had not read: the ones
 * still in its outbox, and the ones the server acknowledged after the brain's
 * cursor. Real migrations on PGlite, the real record_evidence and think():
 * the phone's model before it syncs must be the model the server makes once
 * it has.
 */

const DEFINE = 'class8-mathematics-rational-numbers-define-rational-number';
const CLOSURE = 'class8-mathematics-rational-numbers-closure-addition';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.close();
});

/** One quiz sitting: E1 opens it, E2 a cold miss, E3 help on p2, E4 the answer to p2 after it, E5 a cold right on CLOSURE. */
function sitting(): { id: string; startedAt: string; events: LedgerEvent[] } {
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  const base = { sessionId: id, at, source: 'quiz', surface: 'tap' };
  const answer = (seq: number, outcome: string, probeId: string, correct: boolean) => ({
    ...base, id: crypto.randomUUID(), seq, kind: 'answered', outcomeIds: [outcome],
    payload: { correct, chosenIndex: correct ? 0 : 1, probeId, ms: 3000, attempt: 1, assistanceRung: 0, hintsShown: 0 },
  });
  const events = [
    { ...base, id: crypto.randomUUID(), seq: 0, kind: 'session-started', outcomeIds: [], payload: {} },
    answer(1, DEFINE, 'p1', false),
    { ...base, id: crypto.randomUUID(), seq: 2, kind: 'helped', outcomeIds: [DEFINE], payload: { probeId: 'p2', rung: 3, requested: true } },
    answer(3, DEFINE, 'p2', true),
    answer(4, CLOSURE, 'p3', true),
  ] as unknown as LedgerEvent[];
  return { id, startedAt: at, events };
}

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** Sent through record_evidence as the learner; each event with the receipt the server answered. */
async function send(user: string, s: ReturnType<typeof sitting>, events: LedgerEvent[]): Promise<SentEvent[]> {
  const rows = await asUser(db, user, async (tx) =>
    (
      await tx.query<{ id: string; status: string; received_at: unknown }>(
        `select * from public.record_evidence($1::jsonb, $2::jsonb)`,
        [JSON.stringify([{ id: s.id, source: 'quiz', topicRef: null, startedAt: s.startedAt }]), JSON.stringify(events)],
      )
    ).rows,
  );
  expect(rows.map((r) => r.status)).toEqual(events.map(() => 'recorded'));
  return events.map((event) => ({ event, receivedAt: iso(rows.find((r) => r.id === event.id)!.received_at) }));
}

const read = (user: string): Promise<ServerModel> =>
  asUser(db, user, async (tx) => (await tx.query<{ m: ServerModel }>(`select public.my_learner_model() as m`)).rows[0].m);

/** Every number and count ConceptState holds that does not depend on whose clock timed the sitting. */
const SHARED: (keyof ConceptState)[] = [
  'mastery', 'unassistedMastery', 'assistedPerformance', 'observations', 'answerObservations',
  'unassistedObservations', 'taughtCount', 'doubtCount', 'retrievalCount', 'retrievalAccuracy', 'box',
];

function expectSame(phone: LearnerModel, server: LearnerModel): void {
  expect(Object.keys(phone.states).sort()).toEqual(Object.keys(server.states).sort());
  for (const [id, s] of Object.entries(server.states)) {
    for (const field of SHARED) {
      const a = phone.states[id][field];
      const b = s[field];
      if (typeof a === 'number' && typeof b === 'number') expect(Math.abs(a - b), `${id}.${field}`).toBeLessThan(1e-5);
      else expect(a, `${id}.${field}`).toEqual(b);
    }
    expect(phone.states[id].masteredAt === null).toBe(s.masteredAt === null);
  }
}

describe('the phone on top of the server (SF4)', () => {
  it('with E4-E5 still unsent, equals the server once they are sent and thought about', async () => {
    const kid = await createUser(db);
    const s = sitting();
    const sent = await send(kid, s, s.events.slice(0, 3));
    await think(db, [kid]);
    const before = await read(kid);

    const phone = onServerModel({
      server: before,
      sent,
      unsent: s.events.slice(3),
      openSitting: { id: s.id, startedAt: s.startedAt },
    });
    expect(phone).not.toBeNull();
    // Everything the server had read is held, so the sent log can let it go.
    expect([...phone!.held].sort()).toEqual(sent.map((x) => x.event.id).sort());

    await send(kid, s, s.events.slice(3));
    await think(db, [kid]);
    const after = modelFromServer(await read(kid));

    // Not a trivial pass: the brain's model before had seen neither answer.
    expect(modelFromServer(before).states[CLOSURE]?.observations ?? 0).toBe(0);
    expectSame(phone!.model, after);
    // E4 came after help in the same sitting, given in an event only the server
    // had: it is not counted as answered alone on the phone either.
    expect(phone!.model.states[DEFINE].unassistedObservations).toBe(1);
  });

  it('folds an event the server acknowledged after the brain last read the ledger', async () => {
    const kid = await createUser(db);
    const s = sitting();
    const first = await send(kid, s, s.events.slice(0, 3));
    await think(db, [kid]);
    // E4 reaches the server but the brain has not run since.
    const late = await send(kid, s, s.events.slice(3, 4));
    const before = await read(kid);

    const phone = onServerModel({ server: before, sent: [...first, ...late], unsent: s.events.slice(4) });
    expect(phone!.held).not.toContain(s.events[3].id);

    await send(kid, s, s.events.slice(4));
    await think(db, [kid]);
    expectSame(phone!.model, modelFromServer(await read(kid)));
  });

  it("keeps the open sitting's help the brain already read when nothing of that sitting is unread", async () => {
    const kid = await createUser(db);
    const s = sitting();
    // E1 opens the sitting and help is given on p2 (E3 renumbered to seq 1); the brain reads both.
    const help = { ...s.events[2], seq: 1 } as LedgerEvent;
    const sent = await send(kid, s, [s.events[0], help]);
    await think(db, [kid]);

    // The phone takes the server's model mid-sitting with nothing unread.
    const merged = onServerModel({
      server: await read(kid),
      sent,
      unsent: [],
      openSitting: { id: s.id, startedAt: s.startedAt },
    });
    expect(merged!.model.helpInFlight).toMatchObject({ sessionId: s.id });

    // The sitting's next answer, folded as the classroom folds it (learnerModel.ts recordLocally).
    const answer = { ...s.events[3], seq: 2 } as LedgerEvent;
    const phone = foldSessionReport(
      merged!.model,
      placeOnArrival(merged!.model, { id: s.id, startedAt: s.startedAt }),
      [answer],
      libraryIndex(),
      emptyParams(),
    ).model;

    await send(kid, s, [answer]);
    await think(db, [kid]);
    const after = modelFromServer(await read(kid));
    expect(after.states[DEFINE].unassistedObservations).toBe(0);
    expect(phone.states[DEFINE].unassistedObservations).toBe(after.states[DEFINE].unassistedObservations);
    expect(Math.abs(phone.states[DEFINE].unassistedMastery - after.states[DEFINE].unassistedMastery)).toBeLessThan(1e-5);
  });

  it('takes a learner the brain never wrote as an empty model and folds everything the phone has', async () => {
    const s = sitting();
    const phone = onServerModel({ server: { version: null, foldedThrough: null, states: [] }, sent: [], unsent: s.events });
    expect(phone!.model.states[CLOSURE].observations).toBe(1);
    expect(phone!.folded.map((e) => e.id)).toEqual(s.events.map((e) => e.id));
  });

  it('refuses to build on rows another model version wrote', () => {
    expect(onServerModel({ server: { version: MODEL_VERSION - 1, foldedThrough: null, states: [] }, sent: [], unsent: [] })).toBeNull();
  });
});

describe('the server rows as a model', () => {
  it('reads every field think() writes back into a ConceptState', () => {
    const m = modelFromServer({
      version: MODEL_VERSION,
      foldedThrough: { at: '2026-10-09T10:00:00.123+00:00', sessionId: 's', seq: 2 },
      states: [
        {
          outcome_id: 'o1', mastery: 0.25, unassisted_mastery: 0.2, assisted_performance: 0.6, observations: 3,
          answer_observations: 3, unassisted_observations: 2, taught_count: 1, doubt_count: 0,
          last_practiced_at: '2026-10-09T10:00:00+00:00', last_unassisted_success_at: null, mastered_at: null,
          cold_wins: { 'probe:p1': { first: '2026-10-08T10:00:00.000Z', last: '2026-10-08T10:00:00.000Z' } },
          box: 1, last_exposed_at: null, last_retrieved_at: null, memory_strength: 0,
          next_review_at: '2026-10-10T10:00:00.5+05:30', retrieval_count: 0, retrieval_accuracy: 0,
          misconceptions: {}, updated_at: '2026-10-09T10:00:00+00:00',
        },
      ],
    });
    expect(m.version).toBe(MODEL_VERSION);
    expect(m.foldedThrough).toBeNull();
    expect(m.helpInFlight).toBeNull();
    expect(m.states.o1).toMatchObject({
      outcomeId: 'o1', unassistedMastery: 0.2, unassistedObservations: 2, box: 1,
      lastPracticedAt: '2026-10-09T10:00:00.000Z', nextReviewAt: '2026-10-10T04:30:00.500Z',
      coldWins: { 'probe:p1': { first: '2026-10-08T10:00:00.000Z', last: '2026-10-08T10:00:00.000Z' } },
    });
    expect(m.states.o1).not.toHaveProperty('updated_at');
  });
});

describe('what the brain had read (heldByServer)', () => {
  const cursor = { at: '2026-10-09T10:00:00.123+00:00', sessionId: 'b-session', seq: 4 };
  const key = (receivedAt: string, sessionId = 'b-session', seq = 4) => ({ receivedAt, sessionId, seq });

  it('orders by receipt to the millisecond, then sitting, then seq, as think() reads', () => {
    expect(heldByServer(key('2026-10-09T10:00:00.122999+00:00'), cursor)).toBe(true);
    expect(heldByServer(key('2026-10-09T10:00:00.123999+00:00'), cursor)).toBe(true);
    expect(heldByServer(key('2026-10-09T10:00:00.124+00:00'), cursor)).toBe(false);
    expect(heldByServer(key('2026-10-09T10:00:00.123Z', 'a-session', 9), cursor)).toBe(true);
    expect(heldByServer(key('2026-10-09T10:00:00.123Z', 'c-session', 0), cursor)).toBe(false);
    expect(heldByServer(key('2026-10-09T10:00:00.123Z', 'b-session', 5), cursor)).toBe(false);
  });

  it('holds nothing before the brain has run, and reads the cursor\'s own millisecond as held once its event is purged', () => {
    expect(heldByServer(key('2026-01-01T00:00:00Z'), null)).toBe(false);
    expect(heldByServer(key('2026-10-09T10:00:00.123Z', 'z', 99), { ...cursor, sessionId: null })).toBe(true);
  });
});
