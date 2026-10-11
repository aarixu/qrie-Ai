import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import {
  MISCONCEPTION_LIMITS,
  MODEL_VERSION,
  confirmedMisconceptions,
  emptyConceptState,
  emptyModel,
  foldSession,
  migrateModel,
  normaliseMisconception,
  similarMisconceptions,
  type LearnerModel,
} from '../src/index';

/**
 * LEARNER-MODEL V4 (Task 1 of the one-brain plan): item identity for school
 * homework, misconceptions inside the model, and the retry rule kept to the
 * tutor's own sources.
 */

const node = (id: string) => ({
  id, klass: 8, subject: 'Mathematics', chapter: 'ch', title: id, outcome: id, prerequisites: [], difficulty: 2, topicRef: 'x/ch/t',
});
const index = new GraphIndex({ version: 1, nodes: [node('a'), node('b')] } as never);
const params = emptyParams();

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 1, 10);
const sitting = (hours: number, id = `s${hours}`) => ({ id, startedAt: new Date(T0 + hours * HOUR).toISOString() });

let seq = 0;
interface Ans {
  correct: boolean;
  item?: string;
  probe?: string;
  beat?: string;
  label?: string;
  chosen?: number | null;
  attempt?: number;
  rung?: number;
  source?: string;
  outcomes?: string[];
}
const answer = (session: { id: string }, a: Ans): LedgerEvent =>
  ({
    id: `e${seq}`,
    sessionId: session.id,
    seq: seq++,
    at: '2026-09-01T10:00:00.000Z',
    kind: 'answered',
    source: a.source ?? 'quiz',
    surface: 'tap',
    outcomeIds: a.outcomes ?? ['a'],
    payload: {
      correct: a.correct,
      ms: 4000,
      attempt: a.attempt ?? 1,
      assistanceRung: a.rung ?? 0,
      hintsShown: 0,
      chosenIndex: a.chosen === undefined ? (a.correct ? 0 : 1) : a.chosen,
      ...(a.item ? { itemId: a.item } : {}),
      ...(a.probe ? { probeId: a.probe } : {}),
      ...(a.beat ? { beatId: a.beat } : {}),
      ...(a.label !== undefined ? { misconceptionId: a.label } : {}),
    },
  }) as unknown as LedgerEvent;

const fold = (model: LearnerModel, s: { id: string; startedAt: string }, events: LedgerEvent[]) =>
  foldSession(model, s, events, index, params);

/**
 * REAL LABELS, from the chapter the demo seed plants its misconceptions in
 * (tools/lms-demo/src/seed.ts PLANTS: 8A Mathematics, homework 0 = the first
 * chapter of class8-mathematics, "rational-numbers"). Two distractors of the
 * commutative-addition probe name one idea in two wordings; the closure
 * probes name unrelated ones.
 */
const INVERSE = 'confuses the additive inverse property with commutativity';
const IDENTITY = 'confuses the additive identity property with commutativity';
const DISTRIBUTIVE = 'confuses the distributive property with commutativity';
const SCATTERED = [
  'confuses proper fractions with the general definition of rational numbers',
  'assumes adding rational numbers must cancel out negatives to make a positive',
  'thinks subtraction closure requires a positive result like natural numbers',
  'forgets that multiplying a positive and a negative rational number gives a negative number',
  'thinks decimals and rational numbers are mutually exclusive sets',
  'holds the whole number intuition that multiplication always increases value',
];

describe('the model version', () => {
  it('is past 4, and a v3 model is brought forward with no misconceptions rather than wiped', () => {
    expect(MODEL_VERSION).toBeGreaterThan(4);
    const { misconceptions: _m, ...v3 } = emptyConceptState('a');
    const migrated = migrateModel({ version: 3, foldedThrough: null, helpInFlight: null, states: { a: { ...v3, mastery: 0.7 } } });
    expect(migrated.version).toBe(MODEL_VERSION);
    expect(migrated.states.a.mastery).toBe(0.7);
    expect(migrated.states.a.misconceptions).toEqual({});
  });

  it('rebuilds rather than folds into a v3 model', () => {
    const old = { ...emptyModel(), version: 3, states: { a: { ...emptyConceptState('a'), observations: 40 } } };
    const m = fold(old as LearnerModel, sitting(0), [answer(sitting(0), { correct: true, item: 'i1' })]);
    expect(m.version).toBe(MODEL_VERSION);
    expect(m.states.a.observations).toBe(1);
  });
});

describe('item identity (school homework)', () => {
  it('lets homework answers on two distinct items 24 h+ apart earn masteredAt', () => {
    seq = 0;
    const d0 = sitting(0);
    const d1 = sitting(25);
    let m = fold(emptyModel(), d0, [
      answer(d0, { correct: true, item: 'item-1', source: 'homework' }),
      answer(d0, { correct: true, item: 'item-2', source: 'homework' }),
    ]);
    m = fold(m, d1, [answer(d1, { correct: true, item: 'item-3', source: 'homework' })]);
    expect(m.states.a.unassistedMastery).toBeGreaterThanOrEqual(0.8);
    expect(Object.keys(m.states.a.coldWins).sort()).toEqual(['item:item-1', 'item:item-2', 'item:item-3']);
    expect(m.states.a.masteredAt).toBe(d1.startedAt);
  });

  it('still treats the same homework item twice as one item', () => {
    seq = 0;
    const d0 = sitting(0);
    const d1 = sitting(25);
    let m = fold(emptyModel(), d0, [answer(d0, { correct: true, item: 'item-1', source: 'homework' })]);
    m = fold(m, d1, [answer(d1, { correct: true, item: 'item-1', source: 'homework' })]);
    expect(m.states.a.masteredAt).toBeNull();
  });
});

describe('the retry rule', () => {
  it('never counts a retry-right in the tutor as cold', () => {
    seq = 0;
    const d0 = sitting(0);
    const m = fold(emptyModel(), d0, [
      answer(d0, { correct: false, beat: 'q1', source: 'class' }),
      answer(d0, { correct: true, beat: 'q1', source: 'class', attempt: 2 }),
    ]);
    expect(m.states.a.unassistedObservations).toBe(1);
    expect(m.states.a.coldWins).toEqual({});
    expect(m.states.a.lastUnassistedSuccessAt).toBeNull();
  });

  it('reads a homework hand-in number as a new hand-in, not a nudge (the rule is the tutor’s)', () => {
    // 0030's submit writes `attempt` as the submission's number: a second hand-in
    // of the same homework is a new sitting with no help given in it.
    seq = 0;
    const d0 = sitting(0);
    const m = fold(emptyModel(), d0, [answer(d0, { correct: true, item: 'item-1', source: 'homework', attempt: 2 })]);
    expect(m.states.a.unassistedObservations).toBe(1);
  });
});

describe('normalising a misconception label', () => {
  it('lower-cases and collapses punctuation and spacing', () => {
    expect(normaliseMisconception('  Thinks  ZERO is   "not" a number!! ')).toBe('thinks zero is not a number');
    expect(normaliseMisconception('Confuses mass, and weight.')).toBe(normaliseMisconception('confuses mass and weight'));
    expect(normaliseMisconception('  ... ')).toBe('');
  });

  it('caps a label before it becomes an id', () => {
    const long = 'x'.repeat(500);
    expect(normaliseMisconception(long).length).toBe(MISCONCEPTION_LIMITS.label);
  });

  it('matches two wordings of one idea and not two different ideas (real seed labels)', () => {
    expect(similarMisconceptions(INVERSE, IDENTITY)).toBe(true);
    expect(similarMisconceptions(INVERSE, DISTRIBUTIVE)).toBe(false);
    for (let i = 0; i < SCATTERED.length; i++) {
      for (let j = i + 1; j < SCATTERED.length; j++) {
        expect(similarMisconceptions(SCATTERED[i], SCATTERED[j]), `${i} vs ${j}`).toBe(false);
      }
    }
  });
});

describe('misconceptions in the model', () => {
  it('tells the same wrong idea x6 on 3 items apart from 6 scattered wrong answers', () => {
    seq = 0;
    const same = [0, 1, 2, 3, 4, 5].map((n) => answer(sitting(0), { correct: false, item: `i${n % 3}`, label: INVERSE }));
    seq = 0;
    const scattered = SCATTERED.map((label, n) => answer(sitting(0), { correct: false, item: `i${n}`, label }));
    const a = fold(emptyModel(), sitting(0), same);
    const b = fold(emptyModel(), sitting(0), scattered);

    expect(a).not.toEqual(b);
    expect(confirmedMisconceptions(a.states.a).map((m) => m.label)).toEqual([INVERSE]);
    expect(confirmedMisconceptions(a.states.a)[0]).toMatchObject({ count: 6, items: ['item:i0', 'item:i1', 'item:i2'] });
    expect(confirmedMisconceptions(b.states.a)).toEqual([]);
    expect(Object.keys(b.states.a.misconceptions)).toHaveLength(6);
  });

  it('does not confirm one slip, and confirms the same idea on a second item', () => {
    seq = 0;
    const d0 = sitting(0);
    const slip = fold(emptyModel(), d0, [answer(d0, { correct: false, item: 'i1', label: INVERSE })]);
    const id = normaliseMisconception(INVERSE);
    expect(slip.states.a.misconceptions[id]).toMatchObject({ label: INVERSE, count: 1, firstAt: d0.startedAt, lastAt: d0.startedAt, clearedAt: null });
    expect(confirmedMisconceptions(slip.states.a)).toEqual([]);

    const twice = fold(slip, d0, [answer(d0, { correct: false, item: 'i2', label: INVERSE })]);
    expect(confirmedMisconceptions(twice.states.a).map((m) => m.id)).toEqual([id]);
  });

  it('confirms the same item and the same wrong option in two sittings, with no label', () => {
    seq = 0;
    const d0 = sitting(0);
    const d1 = sitting(30);
    let m = fold(emptyModel(), d0, [answer(d0, { correct: false, item: 'i1', chosen: 2, source: 'homework' })]);
    expect(confirmedMisconceptions(m.states.a)).toEqual([]);
    m = fold(m, d1, [answer(d1, { correct: false, item: 'i1', chosen: 2, source: 'homework' })]);
    const confirmed = confirmedMisconceptions(m.states.a);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ label: null, count: 2, sittings: ['s0', 's30'] });
  });

  it('does not confirm a different wrong option on the same item, and records nothing for a skip or an unlabelled spoken miss', () => {
    seq = 0;
    const d0 = sitting(0);
    const d1 = sitting(30);
    let m = fold(emptyModel(), d0, [answer(d0, { correct: false, item: 'i1', chosen: 2 })]);
    m = fold(m, d1, [
      answer(d1, { correct: false, item: 'i1', chosen: 3 }),
      answer(d1, { correct: false, item: 'i2', chosen: null }),
    ]);
    expect(confirmedMisconceptions(m.states.a)).toEqual([]);
    expect(Object.keys(m.states.a.misconceptions)).toHaveLength(2);
  });

  it('confirms two wordings of one idea on two items (content words, not exact text)', () => {
    seq = 0;
    const d0 = sitting(0);
    const m = fold(emptyModel(), d0, [
      answer(d0, { correct: false, item: 'i1', label: INVERSE }),
      answer(d0, { correct: false, item: 'i2', label: IDENTITY }),
    ]);
    const confirmed = confirmedMisconceptions(m.states.a);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ label: INVERSE, count: 2 });
  });

  it('keeps it to one outcome', () => {
    seq = 0;
    const d0 = sitting(0);
    const m = fold(emptyModel(), d0, [
      answer(d0, { correct: false, item: 'i1', label: INVERSE, outcomes: ['a'] }),
      answer(d0, { correct: false, item: 'i2', label: INVERSE, outcomes: ['b'] }),
    ]);
    expect(confirmedMisconceptions(m.states.a)).toEqual([]);
    expect(confirmedMisconceptions(m.states.b)).toEqual([]);
  });

  it('clears after two later cold right answers the server graded, on distinct items, and comes back if the idea does', () => {
    seq = 0;
    const d0 = sitting(0);
    const d1 = sitting(30);
    const d2 = sitting(60);
    const id = normaliseMisconception(INVERSE);
    let m = fold(emptyModel(), d0, [
      answer(d0, { correct: false, item: 'i1', label: INVERSE }),
      answer(d0, { correct: false, item: 'i2', label: INVERSE }),
    ]);
    // Rights the LMS marked: only a server-graded right clears (P2 security review F4).
    m = fold(m, d1, [
      answer(d1, { correct: true, item: 'i3', source: 'homework' }),
      answer(d1, { correct: true, item: 'i3', source: 'homework' }), // the same item twice is one
      answer(d1, { correct: true, item: 'i4', rung: 3, source: 'homework' }), // with help is not cold
    ]);
    expect(m.states.a.misconceptions[id].clearedAt).toBeNull();
    expect(confirmedMisconceptions(m.states.a)).toHaveLength(1);

    m = fold(m, d2, [answer(d2, { correct: true, item: 'i5', source: 'homework' })]);
    expect(m.states.a.misconceptions[id].clearedAt).toBe(d2.startedAt);
    expect(confirmedMisconceptions(m.states.a)).toEqual([]);

    m = fold(m, sitting(90), [answer(sitting(90), { correct: false, item: 'i6', label: INVERSE })]);
    expect(m.states.a.misconceptions[id].clearedAt).toBeNull();
    expect(confirmedMisconceptions(m.states.a).map((c) => c.id)).toEqual([id]);
  });

  it('does not clear on right answers given straight after being taught it', () => {
    seq = 0;
    const d0 = sitting(0);
    const d1 = sitting(30);
    const id = normaliseMisconception(INVERSE);
    let m = fold(emptyModel(), d0, [
      answer(d0, { correct: false, item: 'i1', label: INVERSE }),
      answer(d0, { correct: false, item: 'i2', label: INVERSE }),
    ]);
    const taught = { id: `e${seq}`, sessionId: d1.id, seq: seq++, at: d1.startedAt, kind: 'taught', source: 'class', surface: 'tap', outcomeIds: ['a'], payload: {} } as unknown as LedgerEvent;
    m = fold(m, d1, [taught, answer(d1, { correct: true, item: 'i3' }), answer(d1, { correct: true, item: 'i4' })]);
    expect(m.states.a.misconceptions[id].clearedAt).toBeNull();
  });

  it('is bounded: 20 ideas per outcome, 8 items each, labels capped', () => {
    seq = 0;
    const d0 = sitting(0);
    const many = Array.from({ length: 30 }, (_, n) =>
      answer(d0, { correct: false, item: `i${n}`, label: `idea${n} ${'w'.repeat(n)} unique${n}x` }),
    );
    const repeats = Array.from({ length: 12 }, (_, n) => answer(d0, { correct: false, item: `r${n}`, label: `zz ${'y'.repeat(300)}` }));
    const m = fold(emptyModel(), d0, [...many, ...repeats]);
    const all = Object.values(m.states.a.misconceptions);
    expect(all.length).toBeLessThanOrEqual(MISCONCEPTION_LIMITS.perOutcome);
    for (const mc of all) {
      expect(mc.items.length).toBeLessThanOrEqual(MISCONCEPTION_LIMITS.items);
      expect((mc.label ?? '').length).toBeLessThanOrEqual(MISCONCEPTION_LIMITS.label);
    }
    const zz = all.find((mc) => mc.label?.startsWith('zz'));
    expect(zz).toMatchObject({ count: 12 });
    expect(JSON.stringify(m.states.a.misconceptions).length).toBeLessThan(8192);
  });

  it('folds to the same misconceptions one event at a time and a sitting at a time', () => {
    seq = 0;
    const d0 = sitting(0);
    const events = [
      answer(d0, { correct: false, item: 'i1', label: INVERSE }),
      answer(d0, { correct: false, item: 'i2', label: IDENTITY }),
      answer(d0, { correct: true, item: 'i3' }),
    ];
    let one = emptyModel();
    for (const e of events) one = fold(one, d0, [e]);
    expect(one).toEqual(fold(emptyModel(), d0, events));
  });
});
