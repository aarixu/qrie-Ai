import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import {
  MODEL_VERSION,
  emptyConceptState,
  emptyModel,
  evidenceSet,
  foldSession,
  unassistedEvidence,
  unassistedView,
  type ConceptState,
} from '../src/index';

/**
 * Two nodes, `b` resting on `a` — the smallest graph with an edge in it.
 * `GraphIndex` takes a `KnowledgeGraph` (`{ version, nodes }`), not an array.
 */
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

const S1 = { id: 's1', startedAt: '2026-09-14T10:00:00.000Z' };
const S2 = { id: 's2', startedAt: '2026-09-15T10:00:00.000Z' };

let seq = 0;
const ev = (
  kind: string,
  outcomeIds: string[],
  payload: unknown,
  at?: string,
  surface = 'tap',
): LedgerEvent =>
  ({
    id: `e${seq}`,
    sessionId: 's1',
    seq: seq++,
    at: at ?? '2026-09-14T10:00:00.000Z',
    kind,
    source: 'quiz',
    surface,
    outcomeIds,
    payload,
  }) as unknown as LedgerEvent;

const answered = (rung: number, correct = true, ids = ['b'], beatId?: string) =>
  ev('answered', ids, {
    correct,
    ms: 4000,
    attempt: 1,
    assistanceRung: rung,
    hintsShown: rung > 0 ? 1 : 0,
    chosenIndex: 0,
    ...(beatId ? { beatId } : {}),
  });

const helped = (rung: number, ids = ['b'], beatId?: string) =>
  ev('helped', ids, { rung, requested: false, ...(beatId ? { beatId } : {}) });

describe('foldSession', () => {
  it('records an unassisted right answer as unassisted mastery', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [answered(0)], index, params);
    expect(m.states.b.unassistedObservations).toBe(1);
    expect(m.states.b.unassistedMastery).toBeGreaterThan(0.5);
    expect(m.states.b.lastUnassistedSuccessAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('refuses a hinted right answer as unassisted evidence', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [answered(3)], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
    expect(m.states.b.unassistedMastery).toBe(0.5);
    // It is still evidence, just not THAT evidence.
    expect(m.states.b.mastery).toBeGreaterThan(0.5);
    expect(m.states.b.assistedPerformance).toBeGreaterThan(0.5);
  });

  it('uses a helped row the answer forgot about', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [helped(4), answered(0)], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
  });

  it('ignores a helped row that came after the answer', () => {
    seq = 0;
    const first = answered(0);
    const m = foldSession(emptyModel(), S1, [first, helped(4)], index, params);
    expect(m.states.b.unassistedObservations).toBe(1);
  });

  /**
   * THE DEVICE FOLDS ONE EVENT AT A TIME, as the class happens. Help held in a
   * local was invisible to the next call, and the answer was then scored as
   * unassisted — manufacturing mastery a child does not have, which is the one
   * error `deriveRung` says nothing downstream can correct.
   */
  it('remembers help across separate fold calls in one session', () => {
    seq = 0;
    const h = helped(5, ['b'], 'B3');
    const a = answered(0, true, ['b'], 'B3');
    const afterHelp = foldSession(emptyModel(), S1, [h], index, params);
    const afterAnswer = foldSession(afterHelp, S1, [a], index, params);
    expect(afterAnswer.states.b.unassistedObservations).toBe(0);
  });

  it('forgets that help when a different sitting begins', () => {
    seq = 0;
    const afterHelp = foldSession(emptyModel(), S1, [helped(5, ['b'], 'B3')], index, params);
    const next = foldSession(afterHelp, S2, [answered(0, true, ['b'], 'B3')], index, params);
    expect(next.states.b.unassistedObservations).toBe(1);
  });

  it('moves the prerequisite too, because a right answer speaks about what it rests on', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [answered(0)], index, params);
    expect(m.states.a.mastery).toBeGreaterThan(0.5);
    // Propagated belief is NOT unassisted evidence about `a` — nobody asked.
    expect(m.states.a.unassistedObservations).toBe(0);
  });

  /**
   * A beat's `checks` is a LIST: 27 of the 126 authored beats that name any
   * outcome name more than one, and one names seven. Taking only the first
   * threw the rest away — no belief, no observation, no date.
   */
  it('speaks about every outcome the beat said it was checking', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [answered(0, true, ['a', 'b'])], index, params);
    expect(m.states.a.unassistedObservations).toBe(1);
    expect(m.states.b.unassistedObservations).toBe(1);
    expect(m.states.a.lastPracticedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  /**
   * A belief pinned at the floor stops moving, and the region loop skips
   * anything unchanged — so the asked node used to stop being counted while
   * `unassistedObservations` kept rising. A subset counter larger than its own
   * superset is the record disagreeing with itself, and `chooseAsk` ranks on it.
   */
  it('counts the asked outcome even once its belief has stopped moving', () => {
    seq = 0;
    let m = emptyModel();
    for (let i = 0; i < 10; i += 1) {
      m = foldSession(m, { id: `s${i}`, startedAt: `2026-09-${10 + i}T10:00:00.000Z` }, [answered(0, false)], index, params);
    }
    expect(m.states.b.mastery).toBeLessThan(0.1);
    expect(m.states.b.unassistedObservations).toBe(10);
    expect(m.states.b.observations).toBeGreaterThanOrEqual(m.states.b.unassistedObservations);
  });

  it('saturates attendance instead of counting it twice', () => {
    seq = 0;
    const taught = () => ev('taught', ['a'], { beatId: 'x' });
    const once = foldSession(emptyModel(), S1, [taught()], index, params);
    const twice = foldSession(once, S2, [taught()], index, params);
    expect(twice.states.a.taughtCount).toBe(2);
    expect(twice.states.a.mastery).toBeGreaterThan(once.states.a.mastery);
    const firstGain = once.states.a.mastery - 0.5;
    const secondGain = twice.states.a.mastery - once.states.a.mastery;
    expect(secondGain).toBeLessThan(firstGain);
  });

  it('reproduces applyTaught exactly for an outcome with no other evidence', () => {
    seq = 0;
    let m = emptyModel();
    const worth = [0.59, 0.6524, 0.675];
    for (let i = 0; i < 3; i += 1) {
      m = foldSession(m, { id: `t${i}`, startedAt: `2026-09-${10 + i}T10:00:00.000Z` }, [ev('taught', ['a'], {})], index, params);
      expect(m.states.a.mastery).toBeCloseTo(worth[i], 3);
    }
  });

  /**
   * applyDoubt's own rule: "a hand is a nudge rather than a verdict, and a
   * student who asks a lot must never be modelled as a student who knows
   * nothing." `evidenceSet` reads `observations` to decide what may become a
   * gap, so a raised hand must not land there.
   */
  it('counts a raised hand as doubt, never as evidence', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [ev('confused', ['a'], {})], index, params);
    expect(m.states.a.doubtCount).toBe(1);
    expect(m.states.a.observations).toBe(0);
    expect(m.states.a.mastery).toBeLessThan(0.5);
  });

  it('carries the cursor forward and refuses to fold the same event twice', () => {
    seq = 0;
    const one = answered(0);
    const first = foldSession(emptyModel(), S1, [one], index, params);
    const again = foldSession(first, S1, [one], index, params);
    expect(again.states.b.observations).toBe(1);
    expect(again.states.b.unassistedObservations).toBe(1);
    expect(again.foldedThrough).toEqual({ at: S1.startedAt, sessionId: 's1', seq: 0 });
  });

  /**
   * ORDERING IS BY THE SESSION'S CLOCK, NEVER THE DEVICE'S. `at` is stamped by
   * the phone, and phones lie. An earlier draft cursored on it, and one NTP
   * correction mid-session then put the rest of that session permanently behind
   * the cursor — lost for the student's whole life, and not recoverable by a
   * rebuild, because the rebuild replays the same events and re-poisons it.
   */
  it('survives a device clock that steps backwards mid-session', () => {
    seq = 0;
    const events = [
      answered(0, true, ['b']),
      ev('answered', ['b'], { correct: true, ms: 1000, attempt: 1, assistanceRung: 0, hintsShown: 0, chosenIndex: 0 }, '2026-09-14T09:59:00.000Z'),
      ev('answered', ['b'], { correct: true, ms: 1000, attempt: 1, assistanceRung: 0, hintsShown: 0, chosenIndex: 0 }, '2026-09-14T09:59:30.000Z'),
    ];
    const m = foldSession(emptyModel(), S1, events, index, params);
    expect(m.states.b.unassistedObservations).toBe(3);
  });

  it('does not let one future-dated sitting freeze the model', () => {
    seq = 0;
    const future = { id: 'sf', startedAt: '2027-05-01T10:00:00.000Z' };
    const frozen = foldSession(emptyModel(), future, [answered(0)], index, params);
    // A later real session. Its start is EARLIER than the poisoned one, so it
    // is legitimately behind the cursor — but a rebuild folds in started_at
    // order, and then the future sitting comes last and nothing is lost.
    const rebuilt = foldSession(
      foldSession(emptyModel(), S1, [answered(0)], index, params),
      future,
      [answered(0)],
      index,
      params,
    );
    expect(frozen.states.b.unassistedObservations).toBe(1);
    expect(rebuilt.states.b.unassistedObservations).toBe(2);
  });

  it('reads two renderings of the same instant as the same instant', () => {
    seq = 0;
    const zForm = { id: 's1', startedAt: '2026-09-14T10:00:00.000Z' };
    const offsetForm = { id: 's1', startedAt: '2026-09-14T10:00:00+00:00' };
    const one = answered(0);
    const first = foldSession(emptyModel(), zForm, [one], index, params);
    // THE SAME event, re-folded under the other rendering. A string compare
    // reads +00:00 as LATER than Z and folds it again, double-counting the
    // answer. The device writes Z; PostgREST hands back the offset form.
    const again = foldSession(first, offsetForm, [one], index, params);
    expect(again.states.b.unassistedObservations).toBe(1);
  });

  it('keeps two sittings apart even when they begin in the same millisecond', () => {
    seq = 0;
    const first = foldSession(emptyModel(), { id: 'aaa', startedAt: S1.startedAt }, [answered(0)], index, params);
    const second = foldSession(first, { id: 'bbb', startedAt: S1.startedAt }, [answered(0)], index, params);
    expect(second.states.b.unassistedObservations).toBe(2);
  });

  it('rebuilds rather than folding into a model of a different shape', () => {
    seq = 0;
    const stale = { ...emptyModel(), version: 0 };
    stale.states.b = { ...emptyModel().states.b, outcomeId: 'b' } as never;
    const m = foldSession(stale, S1, [answered(0)], index, params);
    expect(m.version).toBe(MODEL_VERSION);
    expect(m.states.b.unassistedObservations).toBe(1);
  });

  /**
   * VERSION 1 HAD NO `masteredAt`, AND ITS BELIEF WAS NOT DISCOUNTED FOR HELP.
   *
   * A stored v1 model is a cache of a fold whose arithmetic was wrong (B4) and
   * whose shape lacks the mastery stamp (B8). Folding new rules into it would
   * leave every old hinted answer credited at full weight and every state with
   * an undefined stamp, so it must be rebuilt, not continued.
   */
  it('rebuilds a version-1 model instead of folding into it', () => {
    seq = 0;
    const v1 = { ...emptyModel(), version: 1 };
    const { masteredAt: _dropped, ...oldShape } = emptyConceptState('b') as ConceptState;
    v1.states.b = { ...oldShape, mastery: 0.99, observations: 40 } as never;
    const m = foldSession(v1, S1, [answered(0)], index, params);
    expect(m.version).toBe(MODEL_VERSION);
    expect(m.states.b.observations).toBe(1);
    expect(m.states.b.masteredAt).toBeNull();
  });

  it('is the same state for the same events, every time', () => {
    seq = 0;
    const events = [answered(0)];
    expect(foldSession(emptyModel(), S1, events, index, params)).toEqual(
      foldSession(emptyModel(), S1, events, index, params),
    );
  });

  it('never mutates what it was given', () => {
    seq = 0;
    const model = emptyModel();
    Object.freeze(model);
    Object.freeze(model.states);
    const events = Object.freeze([answered(0)]);
    expect(() => foldSession(model, S1, events, index, params)).not.toThrow();
    expect(model.states).toEqual({});
  });

  /**
   * A SKIP IS NOT "THEY CHOSE OPTION 0". `applyEvidence` reads a null
   * chosenIndex as a skip — a soft "probably not" that moves the node alone and
   * deliberately does not propagate.
   */
  it('keeps a skip a skip', () => {
    seq = 0;
    const skip = ev('answered', ['b'], {
      correct: false,
      ms: 2000,
      attempt: 1,
      assistanceRung: 0,
      hintsShown: 0,
      chosenIndex: null,
    });
    const m = foldSession(emptyModel(), S1, [skip], index, params);
    expect(m.states.b.mastery).toBeLessThan(0.5);
    // A skip says nothing about anything else, so `a` is never even created.
    expect(m.states.a).toBeUndefined();
  });


  /**
   * THE WORST BUG THIS FILE HAS HELD. A spoken answer carries no
   * `chosenIndex` — there are no options to index — and an earlier version
   * passed `payload.chosenIndex ?? null`, which `applyEvidence` reads as a
   * SKIP: belief pulled toward 0, `correct` never read, no propagation.
   *
   * So a correct answer said OUT LOUD was numerically identical to saying
   * nothing, on a product whose primary loop is a tutor who asks out loud and
   * listens. Measured on the real map: 0.350 spoken against 0.783 tapped.
   */
  it('folds a spoken right answer as an answer, not as silence', () => {
    seq = 0;
    const spoken = ev(
      'answered',
      ['b'],
      { correct: true, ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0, verdict: 'right' },
      undefined,
      'voice',
    );
    const m = foldSession(emptyModel(), S1, [spoken], index, params);
    expect(m.states.b.mastery).toBeGreaterThan(0.5);
    expect(m.states.b.unassistedMastery).toBeGreaterThan(0.5);
    // And it propagates, the way a tapped answer does: `a` is `b`'s prerequisite.
    expect(m.states.a).toBeDefined();
  });

  it('folds a spoken WRONG answer as a wrong answer', () => {
    seq = 0;
    const spoken = ev(
      'answered',
      ['b'],
      { correct: false, ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0, verdict: 'wrong' },
      undefined,
      'voice',
    );
    const m = foldSession(emptyModel(), S1, [spoken], index, params);
    // The magnitude is what separates the two readings. A skip pulls to 0.350
    // by SKIP_STRENGTH; a wrong answer takes the BKT posterior and lands near
    // 0.118. Nothing but a real wrong answer can get this low.
    expect(m.states.b.mastery).toBeLessThan(0.2);
  });

  it('reaches the same belief whether the right answer was tapped or spoken', () => {
    seq = 0;
    const base = { correct: true, ms: 4000, attempt: 1, assistanceRung: 0, hintsShown: 0 };
    const tapped = foldSession(
      emptyModel(), S1, [ev('answered', ['b'], { ...base, chosenIndex: 0 })], index, params);
    seq = 0;
    const spoken = foldSession(
      emptyModel(), S1, [ev('answered', ['b'], base, undefined, 'voice')], index, params);
    expect(spoken.states.b.mastery).toBeCloseTo(tapped.states.b.mastery, 10);
  });

  /**
   * A TAP WITH NO INDEX IS STILL A SKIP. Only a surface that offered options
   * can produce one, and that meaning has to survive the fix above.
   */
  it('still reads a tapped answer with no index as a skip', () => {
    seq = 0;
    const skipped = ev('answered', ['b'], {
      correct: false, ms: 2000, attempt: 1, assistanceRung: 0, hintsShown: 0, chosenIndex: null,
    });
    const m = foldSession(emptyModel(), S1, [skipped], index, params);
    expect(m.states.b.mastery).toBeLessThan(0.5);
    // Silence says nothing about the rest of the map.
    expect(m.states.a).toBeUndefined();
  });

  /**
   * THE SIDE DOOR. `packages/diagnostic/src/session.ts` states the rule:
   * attendance raises belief and so can never create a gap on its own, because
   * that lets the difficulty prior back in. Measured on the real class10-science
   * map, one `taught` on a difficulty-4 node was enough to return it as a
   * remedial step at 0.46 — a prior nothing had measured.
   */
  it('does not let attendance alone open the evidence gate', () => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [ev('taught', ['a'], {})], index, params);
    expect(m.states.a.observations).toBe(1);
    expect(m.states.a.answerObservations).toBe(0);
    expect([...evidenceSet(m)]).toEqual([]);
  });

  it('lets an answer open it, and a raised hand too', () => {
    seq = 0;
    const answered0 = foldSession(emptyModel(), S1, [answered(0)], index, params);
    expect([...evidenceSet(answered0)]).toContain('b');
    seq = 0;
    const hand = foldSession(emptyModel(), S1, [ev('confused', ['a'], {})], index, params);
    // applyDoubt LOWERS belief, so a hand is the kind of evidence that may
    // legitimately make an outcome a gap.
    expect([...evidenceSet(hand)]).toEqual(['a']);
  });

  /**
   * IF THIS EVER PASSES WITH THE ORDER SHUFFLED, `seq` IS DECORATIVE. The
   * counters replay in packages/ledger commutes and says so in its header; the
   * learner model must not.
   */
  it('is NOT order-independent within a session', () => {
    seq = 0;
    const h = helped(4);
    const ans = answered(0);
    const inOrder = foldSession(emptyModel(), S1, [h, ans], index, params);
    const reversed = foldSession(emptyModel(), S1, [ans, h], index, params);
    expect(inOrder.states.b.unassistedObservations).not.toBe(
      reversed.states.b.unassistedObservations,
    );
  });
});

/**
 * ONE ANSWER IS ONE ANSWER, HOWEVER MANY OUTCOMES THE BEAT NAMED.
 *
 * `classLedger` files an answer with `beat.checks`, and across the fifteen
 * authored lessons 27 of the 126 beats that name any outcome name more than
 * one; one names seven. `foldAnswer` walked that list calling `applyEvidence`
 * once per id, each call rebuilding `before` from the states the PREVIOUS
 * iteration had already moved -- so propagation ran N times for one answer.
 *
 * Measured on a seven-node chain before the fix: one CORRECT answer left every
 * node above the 0.75 settled line, the chain reading 0.96/0.96/0.96/0.95/
 * 0.94/0.91 against an honest 0.52/0.55/0.59/0.67/0.80. One WRONG answer ran
 * the same chain to four nodes pinned exactly on the 0.02 floor, against an
 * honest 0.41/0.45/0.48. That is the shape of the harm: a single misheard
 * Hinglish answer on a five-outcome ask could floor five outcomes and put a
 * child on a remedial plan for things they can already do.
 *
 * The rest of the repo already had the rule and states it twice --
 * `diagnostic/src/session.ts` and `adapt.ts`: "what a student actually answered
 * must not be overwritten by belief propagating from a later question." Not one
 * test in this package passed more than a single outcome id before these, which
 * is how it survived.
 */
describe('a beat that checks more than one outcome', () => {
  const shared = new GraphIndex({
    version: 1,
    nodes: [node('a', []), node('b', ['a']), node('c', ['a'])],
  } as never);

  const session = (ids: string[], correct: boolean): LedgerEvent[] => [
    ev('session-started', [], {}),
    answered(0, correct, ids),
    ev('session-ended', [], {}),
  ];

  const fold = (ids: string[], correct = true) =>
    foldSession(emptyModel(), S1, session(ids, correct), shared, params);

  for (const correct of [true, false]) {
    const word = correct ? 'a correct' : 'a wrong';

    it(`leaves each named outcome where ${word} answer about it alone would`, () => {
      const together = fold(['b', 'c'], correct);
      const bAlone = fold(['b'], correct);

      // Each outcome's own posterior is its own evidence. What the beat happened
      // to name beside it is not evidence about it.
      expect(together.states.b?.mastery).toBeCloseTo(bAlone.states.b?.mastery ?? -1, 6);
    });

    it(`moves the shared prerequisite no further on ${word} answer than one outcome would`, () => {
      const together = fold(['b', 'c'], correct);
      const alone = fold(['b'], correct);

      // The compounding, stated as an assertion: one answer is one piece of
      // evidence about `a`, whether the beat named one outcome or seven.
      expect(together.states.a?.mastery ?? 0).toBeCloseTo(alone.states.a?.mastery ?? 0, 6);
    });
  }

  it('counts an observation only where the student was actually asked', () => {
    const m = fold(['b', 'c']);

    // `a` moved by inference and was never asked, so it has no observation to
    // its name. Before the fix it collected one per iteration that moved it.
    expect(m.states.a?.observations ?? 0).toBe(0);
    expect(m.states.b?.observations).toBe(1);
    expect(m.states.c?.observations).toBe(1);
  });

  it('never lets observations exceed the answers and lessons that produced them', () => {
    // A counter larger than the set it counts is the record disagreeing with
    // itself, and `chooseAsk` ranks on exactly this field.
    const m = fold(['b', 'c']);

    for (const state of Object.values(m.states)) {
      expect(
        state.observations,
        `${state.outcomeId}: ${state.observations} observations against ${state.answerObservations} answers and ${state.taughtCount} taught`,
      ).toBeLessThanOrEqual(state.answerObservations + state.taughtCount);
    }
  });

  it('still gives every named outcome its own belief and its own answer count', () => {
    // The loop exists for a reason and must keep working: taking outcomeIds[0]
    // threw away every other outcome the beat claimed to be checking.
    const m = fold(['b', 'c']);

    for (const id of ['b', 'c']) {
      expect(m.states[id]?.answerObservations, id).toBe(1);
      expect(m.states[id]?.unassistedObservations, id).toBe(1);
    }
  });
});

/**
 * B4 — HELP IS DISCOUNTED, AND THE DISCOUNT NEVER RUNS BACKWARDS.
 *
 * `assistance.ts` has claimed the invariant since 3.7 — a correct answer at
 * rung k never credits more than the same answer at rung k-1 — while the fold
 * applied every answer at full weight whatever the rung. A right answer given
 * with the answer itself on screen moved `mastery` exactly as far as a cold
 * one. These tests hold the fold to the claim.
 */
describe('help is discounted (B4)', () => {
  const RUNGS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

  const gainAt = (rung: number): number => {
    seq = 0;
    const m = foldSession(emptyModel(), S1, [answered(rung, true)], index, params);
    return m.states.b.mastery - 0.5;
  };

  it('never credits a right answer more for having needed more help', () => {
    const gains = RUNGS.map(gainAt);
    for (let k = 1; k < gains.length; k += 1) {
      expect(gains[k], `rung ${k} against rung ${k - 1}`).toBeLessThanOrEqual(gains[k - 1]);
    }
    // And strictly less once any help was given: a discount that never bites is
    // not a discount.
    expect(gains[3]).toBeLessThan(gains[0]);
  });

  it('still credits a right answer given with the answer in hand, a little', () => {
    // defaultCredit(8) is 0.2: they did learn something, less than cold.
    expect(gainAt(8)).toBeGreaterThan(0);
    expect(gainAt(8)).toBeCloseTo(gainAt(0) * 0.2, 10);
  });

  it('discounts what propagates to the prerequisite too', () => {
    seq = 0;
    const cold = foldSession(emptyModel(), S1, [answered(0, true)], index, params);
    seq = 0;
    const revealed = foldSession(emptyModel(), S1, [answered(8, true)], index, params);
    expect(revealed.states.a.mastery - 0.5).toBeLessThan(cold.states.a.mastery - 0.5);
  });

  /**
   * FAILING WITH HELP IN HAND IS NOT FORGIVEN. Discounting a wrong answer too
   * would err toward the mastery a child does not have — the one direction
   * `deriveRung` says nothing downstream corrects.
   */
  it('does not soften a wrong answer because help had been given', () => {
    seq = 0;
    const cold = foldSession(emptyModel(), S1, [answered(0, false)], index, params);
    seq = 0;
    const hinted = foldSession(emptyModel(), S1, [answered(3, false)], index, params);
    expect(hinted.states.b.mastery).toBeCloseTo(cold.states.b.mastery, 10);
  });

  /**
   * A SECOND TRY IS NOT A COLD TRY. The student has been told the first one
   * was wrong, which is at least a nudge — rung 1, "asked to rethink" — even
   * when no surface filed a `helped` row for it.
   */
  it('counts a second attempt as at least a nudge', () => {
    seq = 0;
    const second = ev('answered', ['b'], {
      correct: true, ms: 4000, attempt: 2, assistanceRung: 0, hintsShown: 0, chosenIndex: 0,
    });
    const m = foldSession(emptyModel(), S1, [second], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
    expect(m.states.b.unassistedMastery).toBe(0.5);
    expect(m.states.b.mastery - 0.5).toBeCloseTo(gainAt(1), 10);
  });
});

/**
 * B8 — ONE MASTERY RULE: unassisted belief at or above 0.8, on at least two
 * DISTINCT items answered right cold, at least a day apart.
 *
 * One lucky answer is not mastery, the same question twice is memory of that
 * question, and two items in one sitting are one sitting. `masteredAt` is the
 * stamp of the moment all three held.
 */
describe('mastered (B8)', () => {
  const DAY1 = { id: 'd1', startedAt: '2026-09-14T10:00:00.000Z' };
  const DAY2 = { id: 'd2', startedAt: '2026-09-15T10:00:00.000Z' };
  const DAY2_EARLY = { id: 'd2e', startedAt: '2026-09-15T09:00:00.000Z' };

  const onItem = (
    session: { id: string },
    n: number,
    probeId: string,
    correct = true,
    rung = 0,
  ): LedgerEvent =>
    ({
      id: `${session.id}-${n}`,
      sessionId: session.id,
      seq: n,
      at: '2026-09-14T10:00:00.000Z',
      kind: 'answered',
      source: 'quiz',
      surface: 'tap',
      outcomeIds: ['b'],
      payload: { probeId, correct, ms: 4000, attempt: 1, assistanceRung: rung, hintsShown: 0, chosenIndex: 0 },
    }) as unknown as LedgerEvent;

  it('starts unmastered', () => {
    expect(emptyConceptState('x').masteredAt).toBeNull();
  });

  it('stamps mastery after two distinct items, cold, a day apart', () => {
    let m = foldSession(emptyModel(), DAY1, [onItem(DAY1, 0, 'p1')], index, params);
    expect(m.states.b.masteredAt).toBeNull();
    m = foldSession(m, DAY2, [onItem(DAY2, 0, 'p2')], index, params);
    expect(m.states.b.unassistedMastery).toBeGreaterThanOrEqual(0.8);
    expect(m.states.b.masteredAt).toBe(DAY2.startedAt);
  });

  it('does not count two items in one sitting as two days', () => {
    const m = foldSession(emptyModel(), DAY1, [onItem(DAY1, 0, 'p1'), onItem(DAY1, 1, 'p2')], index, params);
    expect(m.states.b.unassistedMastery).toBeGreaterThanOrEqual(0.8);
    expect(m.states.b.masteredAt).toBeNull();
  });

  it('does not count the same question twice as two items', () => {
    let m = foldSession(emptyModel(), DAY1, [onItem(DAY1, 0, 'p1')], index, params);
    m = foldSession(m, DAY2, [onItem(DAY2, 0, 'p1')], index, params);
    expect(m.states.b.unassistedMastery).toBeGreaterThanOrEqual(0.8);
    expect(m.states.b.masteredAt).toBeNull();
  });

  it('wants a full day, not the next morning an hour short of one', () => {
    let m = foldSession(emptyModel(), DAY1, [onItem(DAY1, 0, 'p1')], index, params);
    m = foldSession(m, DAY2_EARLY, [onItem(DAY2_EARLY, 0, 'p2')], index, params);
    expect(m.states.b.masteredAt).toBeNull();
  });

  it('wants the belief at the line, not just two spaced right answers', () => {
    // right, wrong, then a day later right on another item: spaced, distinct,
    // and still well short of 0.8.
    let m = foldSession(
      emptyModel(), DAY1, [onItem(DAY1, 0, 'p1'), onItem(DAY1, 1, 'p3', false)], index, params);
    m = foldSession(m, DAY2, [onItem(DAY2, 0, 'p2')], index, params);
    expect(m.states.b.unassistedMastery).toBeLessThan(0.8);
    expect(m.states.b.masteredAt).toBeNull();
  });

  /**
   * THE RULE THIS WHOLE ITEM EXISTS FOR: an outcome answered right only with
   * help is never mastered, never in the decision view, never secure.
   */
  it('never masters an outcome answered right only with help', () => {
    let m = emptyModel();
    for (let day = 0; day < 5; day += 1) {
      const s = { id: `h${day}`, startedAt: `2026-09-${14 + day}T10:00:00.000Z` };
      m = foldSession(m, s, [onItem(s, 0, `p${day}`, true, 3)], index, params);
    }
    expect(m.states.b.mastery).toBeGreaterThan(0.8);
    expect(m.states.b.masteredAt).toBeNull();
    expect(unassistedView(m).b).toBeUndefined();
    expect(unassistedEvidence(m).has('b')).toBe(false);
  });

  it('takes the stamp away when a cold miss drops belief below the line', () => {
    let m = foldSession(emptyModel(), DAY1, [onItem(DAY1, 0, 'p1')], index, params);
    m = foldSession(m, DAY2, [onItem(DAY2, 0, 'p2')], index, params);
    expect(m.states.b.masteredAt).toBe(DAY2.startedAt);
    const DAY3 = { id: 'd3', startedAt: '2026-09-16T10:00:00.000Z' };
    m = foldSession(m, DAY3, [onItem(DAY3, 0, 'p4', false)], index, params);
    expect(m.states.b.unassistedMastery).toBeLessThan(0.8);
    expect(m.states.b.masteredAt).toBeNull();
  });

  it('keeps the first stamp while the rule keeps holding', () => {
    let m = foldSession(emptyModel(), DAY1, [onItem(DAY1, 0, 'p1')], index, params);
    m = foldSession(m, DAY2, [onItem(DAY2, 0, 'p2')], index, params);
    const DAY3 = { id: 'd3', startedAt: '2026-09-16T10:00:00.000Z' };
    m = foldSession(m, DAY3, [onItem(DAY3, 0, 'p5')], index, params);
    expect(m.states.b.masteredAt).toBe(DAY2.startedAt);
  });

  it('remembers only as many items as the rule can ever need', () => {
    let m = emptyModel();
    for (let day = 0; day < 12; day += 1) {
      const s = { id: `k${day}`, startedAt: `2026-09-${10 + day}T10:00:00.000Z` };
      m = foldSession(m, s, [onItem(s, 0, `item${day}`)], index, params);
    }
    expect(Object.keys(m.states.b.coldWins).length).toBeLessThanOrEqual(4);
    expect(m.states.b.masteredAt).toBe('2026-09-11T10:00:00.000Z');
  });
});

/**
 * B6 — DECISIONS READ UNASSISTED BELIEF, AND "NEVER ASKED COLD" IS UNKNOWN.
 */
describe('the decision view (B6)', () => {
  it('holds unassisted belief, and only where a cold answer produced it', () => {
    seq = 0;
    const m = foldSession(
      emptyModel(), S1, [answered(0, true, ['b']), answered(3, true, ['a'], 'X')], index, params);
    const view = unassistedView(m);
    expect(view.b).toBe(m.states.b.unassistedMastery);
    // `a` has belief -- it was answered with a hint, and `b`'s answer
    // propagated to it -- but no cold answer, so for a decision it is unknown.
    expect(m.states.a.mastery).not.toBe(0.5);
    expect(view.a).toBeUndefined();
    expect([...unassistedEvidence(m)]).toEqual(['b']);
  });

  it('is empty for a student nobody has asked cold', () => {
    expect(unassistedView(emptyModel())).toEqual({});
    expect(unassistedEvidence(emptyModel()).size).toBe(0);
  });
});
