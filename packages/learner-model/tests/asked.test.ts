import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { ASKED_ITEM_KEY_MAX, ASKED_ITEMS_LIMIT, MODEL_VERSION, emptyConceptState, emptyModel, foldSession, migrateModel } from '../src/index';

/**
 * WHICH QUESTIONS AN OUTCOME WAS ASKED BY (lam-one-brain Task 16).
 *
 * A node may hold several questions, and a review must ask one the learner
 * has not answered when there is one (apps/classroom warmUp.ts). So each
 * outcome keeps the questions its answers were to, by item key, the latest
 * last, at most ASKED_ITEMS_LIMIT.
 */

const node = (id: string) => ({
  id, klass: 10, subject: 'Maths', chapter: 'ch', title: id, outcome: id, prerequisites: [], difficulty: 2, topicRef: 'x/ch/t',
});
const index = new GraphIndex({ version: 1, nodes: [node('a'), node('b')] } as never);
const params = emptyParams();
const sitting = { id: 's1', startedAt: '2026-09-01T10:00:00.000Z' };

let seq = 0;
const answer = (payload: Record<string, unknown>, outcomeIds = ['a'], extra: Record<string, unknown> = {}): LedgerEvent =>
  ({
    id: `e${seq}`,
    sessionId: sitting.id,
    seq: seq++,
    at: '2026-09-01T10:00:00.000Z',
    kind: 'answered',
    source: 'quiz',
    surface: 'tap',
    outcomeIds,
    payload: { correct: true, ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0, chosenIndex: 0, ...payload },
    ...extra,
  }) as unknown as LedgerEvent;

const fold = (events: LedgerEvent[]) => foldSession(emptyModel(), sitting, events, index, params);

describe('the questions an outcome was asked by', () => {
  it('starts empty', () => {
    expect(emptyConceptState('x').askedItems).toEqual([]);
  });

  it('records every answer\'s question, right or wrong, cold or helped, the latest last', () => {
    const m = fold([
      answer({ probeId: 'p1' }),
      answer({ probeId: 'p2', correct: false, chosenIndex: 1 }),
      answer({ itemId: 'i9', assistanceRung: 3 }),
    ]);
    expect(m.states.a.askedItems).toEqual(['probe:p1', 'probe:p2', 'item:i9']);
  });

  it('a question asked again moves to the end, once', () => {
    const m = fold([answer({ probeId: 'p1' }), answer({ probeId: 'p2' }), answer({ probeId: 'p1' })]);
    expect(m.states.a.askedItems).toEqual(['probe:p2', 'probe:p1']);
  });

  it('files the question under every outcome the answer names', () => {
    const m = fold([answer({ probeId: 'p1' }, ['a', 'b'])]);
    expect(m.states.a.askedItems).toEqual(['probe:p1']);
    expect(m.states.b.askedItems).toEqual(['probe:p1']);
  });

  it('a beat is its lesson\'s; an answer naming no question records none', () => {
    const m = fold([answer({ beatId: 'b3_4' }, ['a'], { topicRef: 'x/ch/t' }), answer({})]);
    expect(m.states.a.askedItems).toEqual(['beat:x/ch/t/b3_4']);
  });

  it('leaves out a key too long to be a question the bank holds, so the list stays small', () => {
    const long = 'x'.repeat(ASKED_ITEM_KEY_MAX);
    const m = fold([answer({ probeId: 'p1' }), answer({ probeId: long })]);
    expect(m.states.a.askedItems).toEqual(['probe:p1']);
    expect(m.states.a.observations).toBe(2);
  });

  it('measures a key in bytes, as concept_state does: eight long multibyte keys stay inside its 4 KB line', () => {
    // As concept_state.asked_items::text spells the list (0116's check):
    // UTF-8, each key quoted and escaped, ", " between them.
    const bytes = (keys: string[]) => new TextEncoder().encode(`[${keys.map((k) => JSON.stringify(k)).join(', ')}]`).length;
    // 240 Devanagari letters are 241 characters, under 256, but 720 bytes:
    // eight of them were past 4096 and broke the learner's brain run.
    const tooLong = Array.from({ length: ASKED_ITEMS_LIMIT }, (_, n) => answer({ probeId: `${n}${'अ'.repeat(240)}` }));
    const dropped = fold(tooLong);
    expect(dropped.states.a.askedItems).toEqual([]);
    expect(dropped.states.a.observations).toBe(ASKED_ITEMS_LIMIT);
    // Short enough in bytes: kept, and the list still fits.
    const fits = Array.from({ length: ASKED_ITEMS_LIMIT }, (_, n) => answer({ probeId: `${n}${'अ'.repeat(80)}` }));
    const kept = fold(fits);
    expect(kept.states.a.askedItems).toHaveLength(ASKED_ITEMS_LIMIT);
    expect(bytes(kept.states.a.askedItems)).toBeLessThanOrEqual(4096);
    // A key that needs escaping counts its escapes.
    const quoted = fold([answer({ probeId: '"'.repeat(125) })]);
    expect(quoted.states.a.askedItems).toEqual([]);
  });

  it('keeps the latest ASKED_ITEMS_LIMIT and lets the oldest go', () => {
    const many = Array.from({ length: ASKED_ITEMS_LIMIT + 3 }, (_, i) => answer({ probeId: `p${i}` }));
    const m = fold(many);
    expect(m.states.a.askedItems).toHaveLength(ASKED_ITEMS_LIMIT);
    expect(m.states.a.askedItems[0]).toBe('probe:p3');
    expect(m.states.a.askedItems.at(-1)).toBe(`probe:p${ASKED_ITEMS_LIMIT + 2}`);
  });
});

describe('version 6', () => {
  it('is the version that holds them', () => {
    expect(MODEL_VERSION).toBeGreaterThanOrEqual(6);
  });

  it('a v5 model brought forward has asked nothing yet, and keeps every number', () => {
    const v5 = { version: 5, foldedThrough: null, helpInFlight: null, states: { a: { ...emptyConceptState('a'), observations: 4 } } };
    delete (v5.states.a as Partial<ReturnType<typeof emptyConceptState>>).askedItems;
    const m = migrateModel(v5);
    expect(m.version).toBe(MODEL_VERSION);
    expect(m.states.a.observations).toBe(4);
    expect(m.states.a.askedItems).toEqual([]);
  });
});
