import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import { emptyModel, foldSession, type LearnerModel } from '@ai-tutor/learner-model';
import type { LedgerEvent } from '@ai-tutor/ledger';

/**
 * THE LIVE EMBODIMENT OF "REPLAY", TESTED FOR THE FIRST TIME.
 *
 * `rebuildFromLedger` is the /model inspector's whole claim to be believed:
 * it reads the server's rows, folds them from zero, and says where the device
 * disagrees. Until 2026-09-16 not one of its moving parts — the snake_case
 * mapping, the capped-page refusal, the per-session seq sort, the orphan
 * count, the diff — had a test. A tool that exists to catch divergence and is
 * itself unchecked is the kind of confidence this repo is built to refuse.
 *
 * The supabase client and the graph context are mocked at the module seam, so
 * this file needs no cloud, no env, and no map on disk.
 */

const sessionsResult = { data: null as unknown, error: null as unknown };
const eventsResult = { data: null as unknown, error: null as unknown };

const chain = (result: { data: unknown; error: unknown }) => {
  const q = {
    select: () => q,
    order: () => q,
    contains: () => q,
    limit: () => Promise.resolve(result),
  };
  return q;
};

vi.mock('../src/lib/supabase', () => ({
  supabase: () => ({
    from: (table: string) => chain(table === 'learning_session' ? sessionsResult : eventsResult),
  }),
}));

const node = (id: string, prerequisites: string[]) => ({
  id,
  klass: 10,
  subject: 'Science',
  chapter: 'ch1',
  title: id.toUpperCase(),
  outcome: `can do ${id}`,
  prerequisites,
  difficulty: 2,
  topicRef: 'class10-science/ch1/t1',
});
const index = new GraphIndex({ version: 1, nodes: [node('a', []), node('b', ['a'])] } as never);
const params = emptyParams();

vi.mock('../src/lib/graphContext', () => ({
  currentIndex: () => index,
  currentParams: () => params,
}));

import { evidenceFor, rebuildFromLedger } from '../src/lib/rebuildModel';

/** A server row, exactly as PostgREST hands it back. */
const row = (
  sessionId: string,
  seq: number,
  at: string,
  kind: string,
  outcomeIds: string[],
  payload: unknown,
  surface = 'tap',
) => ({
  id: `${sessionId}-e${seq}`,
  session_id: sessionId,
  seq,
  at,
  kind,
  source: 'quiz',
  surface,
  outcome_ids: outcomeIds,
  topic_ref: null,
  payload,
});

const S1 = { id: 's1', started_at: '2026-09-14T10:00:00.000Z' };
const S2 = { id: 's2', started_at: '2026-09-15T10:00:00.000Z' };

const answeredPayload = (correct: boolean, rung = 0) => ({
  correct,
  ms: 4000,
  attempt: 1,
  assistanceRung: rung,
  hintsShown: 0,
  chosenIndex: 0,
});

const ROWS = [
  row(S1.id, 0, S1.started_at, 'helped', ['b'], { beatId: 'B1', rung: 3, requested: false }),
  row(S1.id, 1, S1.started_at, 'answered', ['b'], { ...answeredPayload(true), beatId: 'B1' }),
  row(S2.id, 0, S2.started_at, 'answered', ['a', 'b'], { ...answeredPayload(true), beatId: 'B2' }),
  row(S2.id, 1, S2.started_at, 'confused', ['b'], { beatId: 'B2' }),
];

/** What the device itself would believe after the same history. */
function deviceModel(): LearnerModel {
  const toEvent = (r: (typeof ROWS)[number]): LedgerEvent =>
    ({
      id: r.id,
      sessionId: r.session_id,
      seq: r.seq,
      at: r.at,
      kind: r.kind,
      source: r.source,
      surface: r.surface,
      outcomeIds: r.outcome_ids,
      payload: r.payload,
    }) as unknown as LedgerEvent;
  let m = emptyModel();
  m = foldSession(m, { id: S1.id, startedAt: S1.started_at }, ROWS.slice(0, 2).map(toEvent), index, params);
  m = foldSession(m, { id: S2.id, startedAt: S2.started_at }, ROWS.slice(2).map(toEvent), index, params);
  return m;
}

beforeEach(() => {
  sessionsResult.data = [S1, S2];
  sessionsResult.error = null;
  eventsResult.data = [...ROWS];
  eventsResult.error = null;
});

describe('rebuildFromLedger', () => {
  it('rebuilds the device model exactly from the server rows', async () => {
    const out = await rebuildFromLedger(deviceModel());
    expect(typeof out).not.toBe('string');
    if (typeof out === 'string') return;
    expect(out.diffs).toEqual([]);
    expect(out.onlyStored).toEqual([]);
    expect(out.onlyRebuilt).toEqual([]);
    expect(out.sessions).toBe(2);
    expect(out.events).toBe(4);
    expect(out.orphanedEvents).toBe(0);
    // The folded events ride along in fold order, so the 3.7 projections read
    // exactly the evidence the rebuild read — never a second, drifting query.
    expect(out.ledger.map((e) => e.id)).toEqual(['s1-e0', 's1-e1', 's2-e0', 's2-e1']);
  });

  it('reports a divergence in the evidence-gate field instead of skipping it', async () => {
    // answerObservations is what evidenceSet gates the study plan on. The
    // FIELDS list promised "every number a ConceptState holds" and skipped it —
    // the one field whose silent divergence the inspector exists to catch.
    const stored = deviceModel();
    stored.states.b = { ...stored.states.b, answerObservations: 99 };
    const out = await rebuildFromLedger(stored);
    if (typeof out === 'string') throw new Error(out);
    expect(out.diffs).toContainEqual({
      outcomeId: 'b',
      field: 'answerObservations',
      stored: 99,
      rebuilt: 2,
    });
  });

  it('sorts each session by seq even when the server hands rows back shuffled', async () => {
    eventsResult.data = [ROWS[1], ROWS[3], ROWS[0], ROWS[2]];
    const out = await rebuildFromLedger(deviceModel());
    if (typeof out === 'string') throw new Error(out);
    // The helped row must still land BEFORE its answer, or the rebuilt model
    // credits unassisted mastery the device refused.
    expect(out.diffs).toEqual([]);
  });

  it('refuses a capped page rather than folding a partial history', async () => {
    sessionsResult.data = Array.from({ length: 1001 }, (_, i) => ({
      id: `s${i}`,
      started_at: S1.started_at,
    }));
    const out = await rebuildFromLedger(deviceModel());
    expect(out).toMatch(/will not fold a partial history/);

    sessionsResult.data = [S1, S2];
    eventsResult.data = Array.from({ length: 1001 }, (_, i) =>
      row(S1.id, i, S1.started_at, 'confused', ['b'], {}),
    );
    const capped = await rebuildFromLedger(deviceModel());
    expect(capped).toMatch(/will not fold a partial history/);
  });

  it('counts an event whose sitting is missing instead of dropping it silently', async () => {
    eventsResult.data = [...ROWS, row('ghost', 0, S1.started_at, 'confused', ['b'], {})];
    const out = await rebuildFromLedger(deviceModel());
    if (typeof out === 'string') throw new Error(out);
    expect(out.orphanedEvents).toBe(1);
    // The known history still folds clean around the orphan.
    expect(out.diffs).toEqual([]);
    // And the orphan stays out of the projections' evidence, exactly as it
    // stayed out of the fold's.
    expect(out.ledger).toHaveLength(4);
  });

  it('names the outcomes only one side holds, in both directions', async () => {
    const stored = deviceModel();
    stored.states.phantom = { ...stored.states.b, outcomeId: 'phantom' };
    const out = await rebuildFromLedger(stored);
    if (typeof out === 'string') throw new Error(out);
    expect(out.onlyStored).toEqual(['phantom']);
    expect(out.onlyRebuilt).toEqual([]);
  });

  it('hands back the database error as a sentence, not a throw', async () => {
    sessionsResult.data = null;
    sessionsResult.error = { message: 'permission denied' };
    const out = await rebuildFromLedger(deviceModel());
    expect(out).toBe('Could not read sessions: permission denied');
  });
});

describe('evidenceFor', () => {
  it('maps snake_case rows into the ledger shape', async () => {
    eventsResult.data = [ROWS[1]];
    const out = await evidenceFor('b');
    if (typeof out === 'string') throw new Error(out);
    expect(out).toHaveLength(1);
    expect(out[0].sessionId).toBe('s1');
    expect(out[0].outcomeIds).toEqual(['b']);
    // topic_ref null must not become topicRef: null — the key is absent.
    expect('topicRef' in out[0]).toBe(false);
  });

  it('hands back the database error as a sentence', async () => {
    eventsResult.data = null;
    eventsResult.error = { message: 'timeout' };
    const out = await evidenceFor('b');
    expect(out).toBe('Could not read evidence: timeout');
  });
});
