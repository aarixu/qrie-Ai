import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { emptyModel, foldSession, type LearnerModel } from '../src/index';

/**
 * THE PHASE'S OWN DEFINITION OF DONE, ASSERTED RATHER THAN IMPLIED.
 *
 * "A replayed session reproduces the model exactly." Until 2026-09-16 the suite
 * proved determinism (the same input twice gives the same output) and cursor
 * idempotency (the same event twice folds once) — necessary, and strictly
 * weaker than what the phase promises. The device folds ONE EVENT AT A TIME as
 * the class happens; the rebuild folds a whole session in one call. Those are
 * different code paths through `foldSession`, and nothing asserted they land
 * on the same bytes. These tests do.
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

const ev = (
  session: { id: string; startedAt: string },
  seq: number,
  kind: string,
  outcomeIds: string[],
  payload: unknown,
  surface = 'tap',
): LedgerEvent =>
  ({
    id: `${session.id}-e${seq}`,
    sessionId: session.id,
    seq,
    at: session.startedAt,
    kind,
    source: 'quiz',
    surface,
    outcomeIds,
    // Every answer here counts as server-graded (v5), so this fixture keeps
    // exercising the mastery rule; graded.test.ts covers the phone-graded path.
    payload: kind === 'answered' ? { ...(payload as object), graded: 'server' } : payload,
  }) as unknown as LedgerEvent;

/**
 * One ledger, exercising every fold path at once: attendance, help arriving
 * before an answer, a cold multi-outcome answer, a raised hand, a SPOKEN
 * answer (no chosenIndex — the silence defect's shape), a cold wrong answer.
 * Seq restarts at 0 per session, exactly as the real ledger's does.
 */
const SESSION_1: LedgerEvent[] = [
  ev(S1, 0, 'taught', ['a'], { beatId: 'T1' }),
  ev(S1, 1, 'helped', ['b'], { beatId: 'B1', rung: 3, requested: false }),
  ev(S1, 2, 'answered', ['b'], {
    beatId: 'B1',
    correct: true,
    ms: 4000,
    attempt: 1,
    assistanceRung: 0, // the recorded rung LIES here; the helped row above is the truth
    hintsShown: 1,
    chosenIndex: 0,
  }),
  ev(S1, 3, 'answered', ['a', 'b'], {
    beatId: 'B2',
    correct: true,
    ms: 5000,
    attempt: 1,
    assistanceRung: 0,
    hintsShown: 0,
    chosenIndex: 1,
  }),
  ev(S1, 4, 'confused', ['b'], { beatId: 'B2' }),
];

const SESSION_2: LedgerEvent[] = [
  ev(
    S2,
    0,
    'answered',
    ['b'],
    {
      beatId: 'B3',
      correct: true,
      ms: 6000,
      attempt: 1,
      assistanceRung: 0,
      hintsShown: 0,
      verdict: 'right', // spoken: no chosenIndex on purpose
    },
    'voice',
  ),
  ev(S2, 1, 'answered', ['a'], {
    beatId: 'B4',
    correct: false,
    ms: 3000,
    attempt: 1,
    assistanceRung: 0,
    hintsShown: 0,
    chosenIndex: 2,
  }),
  ev(S2, 2, 'session-ended', [], { activeMs: 300_000, completed: true }),
];

/** The device path: one foldSession call per event, as a live class folds. */
function foldIncrementally(): LearnerModel {
  let m = emptyModel();
  for (const e of SESSION_1) m = foldSession(m, S1, [e], index, params);
  for (const e of SESSION_2) m = foldSession(m, S2, [e], index, params);
  return m;
}

/** The rebuild path: whole sessions at once, as rebuildFromLedger folds. */
function foldFromZero(): LearnerModel {
  let m = emptyModel();
  m = foldSession(m, S1, SESSION_1, index, params);
  m = foldSession(m, S2, SESSION_2, index, params);
  return m;
}

describe('replay', () => {
  it('folds to the same bytes one event at a time and a session at a time', () => {
    expect(foldIncrementally()).toEqual(foldFromZero());
  });

  it('re-folding the whole history into the finished model changes nothing', () => {
    // The rebuild's own idempotency: a retried batch, a second Rebuild click.
    const once = foldFromZero();
    let twice = foldSession(once, S1, SESSION_1, index, params);
    twice = foldSession(twice, S2, SESSION_2, index, params);
    expect(twice).toEqual(once);
  });

  /**
   * THE KNOWN STATE, FROZEN. Authored by running the 2026-09-16 fold once and
   * writing down every byte it produced — the spec's "reproduces a known state
   * byte for byte", and a tripwire: any change to the fold's arithmetic, the
   * propagation, the cursor or the help tracking breaks this test LOUDLY
   * instead of silently reshaping every student's belief.
   *
   * The numbers themselves tell the design's story, which is why toEqual runs
   * against all of them and not a rounded few: `b.unassistedMastery` (0.928)
   * sits far ABOVE `b.mastery` (0.361) because unassisted belief is folded in
   * isolation while overall belief hears the failed prerequisite `a` through
   * the graph — the assisted/unassisted split doing exactly what it is for.
   */
  /**
   * These numbers moved on 2026-09-17, and the OLD ones were the bug.
   *
   * `a` was recorded with 6 observations against 2 answers and 1 lesson, and
   * `b` with 4 against 3 answers and no lesson. Both are counters larger than
   * the set they count, from a fold that walked `event.outcomeIds` applying
   * evidence once per named outcome against states the previous iteration had
   * already moved. The seq-3 answer names BOTH nodes, so it was counted twice
   * and propagated twice. `a` is named by exactly three events -- one taught
   * and two answers -- and `b` by three answers, and three is what each now
   * reads. `a`'s mastery fell by 0.0039, which is the compounded pull removed.
   */
  /**
   * And again on 2026-09-29, deliberately (MODEL_VERSION 2). B4: the seq-1
   * help makes the seq-2 right answer a rung-3 answer, which now moves belief
   * `defaultCredit(3)` = 0.7 of the way a cold one would -- so `b.mastery` fell
   * 0.0050 and `a.mastery`, which that answer propagates to, fell 0.0615. B8
   * added `masteredAt` and `coldWins`. Nothing else moved: every unassisted
   * number, count and date is byte for byte what it was.
   */
  /**
   * And a third time on 2026-09-29, deliberately (MODEL_VERSION 3, F1-F3).
   * `a` was taught on day 1 and answered right cold in that same session:
   * listening, not remembering, so that cold win no longer counts toward
   * `masteredAt` (its coldWins are now empty — masteredAt was null anyway).
   * Its day-2 cold miss is a retrieval that failed: box 0, due a day later.
   * `b` was never taught: its first answer opens box 0, and each cold right
   * answer after that climbs, once a session and only when due (box 1, due two days on). No belief moved.
   */
  /**
   * And a fourth time on 2026-10-07, deliberately (MODEL_VERSION 4, the one-brain
   * plan's Task 1). Changed fields: `version` 3 -> 4, and a new `misconceptions`
   * on every state. `a`'s day-2 cold miss chose option 2 of beat B4, which names
   * no idea, so it is kept as `option:beat:/B4#2` — one item, one sitting, a
   * slip and not confirmed. `b` was never answered wrong: `{}`. Nothing else
   * moved: every belief, count, date and box is byte for byte what it was.
   */
  /**
   * And a fifth time on 2026-10-11, deliberately (MODEL_VERSION 5, the one-brain
   * plan's Task 15). Every answer in the fixture is marked server-graded, and
   * each state gains `verifiedMastery` and `verifiedObservations`, equal here
   * to the unassisted pair because the server graded every cold answer.
   * Nothing else moved.
   */
  /**
   * And a sixth time on 2026-10-11, deliberately (MODEL_VERSION 6, the one-brain
   * plan's Task 16). Each state gains `askedItems`, the beats its answers were
   * to, in the order answered: `a` was asked B2 (with `b`) and B4, `b` was
   * asked B1, B2 and B3. Nothing else moved.
   */
  it('reproduces the known state byte for byte', () => {
    // The invariant the old fixture violated, asserted here so a future fold
    // cannot quietly reintroduce it: a node is observed once per event that
    // names it, never once per outcome that event happened to name beside it.
    for (const state of Object.values(foldFromZero().states)) {
      expect(
        state.observations,
        `${state.outcomeId}: ${state.observations} observations`,
      ).toBeLessThanOrEqual(state.answerObservations + state.taughtCount);
    }

    expect(foldFromZero()).toEqual({
      states: {
        a: {
          outcomeId: 'a',
          mastery: 0.8018333333333334,
          unassistedMastery: 0.32432432432432434,
          assistedPerformance: 0.5,
          observations: 3,
          answerObservations: 2,
          doubtCount: 0,
          unassistedObservations: 2,
          verifiedMastery: 0.32432432432432434,
          verifiedObservations: 2,
          taughtCount: 1,
          lastPracticedAt: '2026-09-15T10:00:00.000Z',
          lastUnassistedSuccessAt: '2026-09-14T10:00:00.000Z',
          // No cold win: the one right answer came in the session it was taught.
          masteredAt: null,
          coldWins: {},
          box: 0,
          lastExposedAt: '2026-09-14T10:00:00.000Z',
          lastRetrievedAt: '2026-09-15T10:00:00.000Z',
          memoryStrength: 0,
          nextReviewAt: '2026-09-16T10:00:00.000Z',
          retrievalCount: 1,
          retrievalAccuracy: 0,
          misconceptions: {
            'option:beat:/B4#2': {
              label: null,
              count: 1,
              items: ['beat:/B4'],
              sittings: ['s2'],
              firstAt: '2026-09-15T10:00:00.000Z',
              lastAt: '2026-09-15T10:00:00.000Z',
              clearedAt: null,
              clearing: [],
            },
          },
          askedItems: ['beat:/B2', 'beat:/B4'],
        },
        b: {
          outcomeId: 'b',
          mastery: 0.3567657996488772,
          unassistedMastery: 0.9283667621776505,
          assistedPerformance: 0.782608695652174,
          observations: 3,
          answerObservations: 3,
          doubtCount: 1,
          unassistedObservations: 2,
          verifiedMastery: 0.9283667621776505,
          verifiedObservations: 2,
          taughtCount: 0,
          lastPracticedAt: '2026-09-15T10:00:00.000Z',
          lastUnassistedSuccessAt: '2026-09-15T10:00:00.000Z',
          // B8 holds: cold wins on two distinct items (B2, B3) a day apart, and
          // unassisted belief 0.928. Blended `mastery` is 0.357 at the same
          // moment -- the hint, the hand and `a`'s miss pull THAT down, and it
          // is display only. The rule reads what they did alone.
          masteredAt: '2026-09-15T10:00:00.000Z',
          coldWins: {
            'beat:/B2': { first: '2026-09-14T10:00:00.000Z', last: '2026-09-14T10:00:00.000Z' },
            'beat:/B3': { first: '2026-09-15T10:00:00.000Z', last: '2026-09-15T10:00:00.000Z' },
          },
          // Once a session, when due (sixth review): box 0 on day 1, one climb on day 2.
          box: 1,
          lastExposedAt: null,
          lastRetrievedAt: '2026-09-15T10:00:00.000Z',
          memoryStrength: 0,
          nextReviewAt: '2026-09-17T10:00:00.000Z',
          retrievalCount: 2,
          retrievalAccuracy: 1,
          misconceptions: {},
          askedItems: ['beat:/B1', 'beat:/B2', 'beat:/B3'],
        },
      },
      foldedThrough: { at: '2026-09-15T10:00:00.000Z', sessionId: 's2', seq: 2 },
      helpInFlight: { sessionId: 's2', byAsk: {} },
      version: 6,
    });
  });
});
