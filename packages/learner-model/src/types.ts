import { PRIOR } from '@ai-tutor/knowledge-graph';
import type { Misconception } from './misconception.ts';

/**
 * WHAT WE BELIEVE ABOUT ONE OUTCOME, FOR ONE STUDENT.
 *
 * This replaces `Mastery = Record<string, number>` as the STORE. A bare float
 * cannot hold a date, which is why `decayMastery` has been correct and
 * uncallable for weeks, and it cannot say whether the student did it alone —
 * which is the only question that separates mastery from a hint well taken.
 *
 * Every field here is a fact the counters it replaces threw away at the moment
 * it happened.
 */
export interface ConceptState {
  outcomeId: string;

  /**
   * All evidence, assisted or not — a right answer's move discounted by the
   * rung it was given at (B4, `defaultCredit`).
   *
   * DISPLAY ONLY (B6). No decision reads this: what to ask, what to plan, what
   * to call secure all read `unassistedMastery` through `unassistedView`,
   * because a blend of cold and hinted answers cannot say which of the two a
   * student can do, and a plan built on it skips what they cannot do alone.
   */
  mastery: number;
  /**
   * Rung 0 only. The number that means they can do it without us, and the ONLY
   * belief a decision reads. Meaningless while `unassistedObservations` is 0:
   * that is the prior, and it means "unknown", never "half known".
   */
  unassistedMastery: number;
  /** How they perform WITH help. High here and low above is the signal. */
  assistedPerformance: number;

  /**
   * EVIDENCE events folded into this outcome: answers and attendance.
   *
   * A raised hand is NOT one, and is counted in `doubtCount` instead. That is
   * applyDoubt's own stated principle (mastery.ts:250-252) — "a hand is a nudge
   * rather than a verdict, and a student who asks a lot must never be modelled
   * as a student who knows nothing". Counting it here would let one raised hand
   * put an otherwise-untouched outcome on the remedial plan at confidence 0.61,
   * because `evidenceSet` reads this field to decide what may become a gap.
   */
  observations: number;
  /**
   * ANSWERS ONLY. The subset of `observations` that could have LOWERED belief.
   *
   * `evidenceSet` reads this rather than `observations`, because
   * `packages/diagnostic/src/session.ts` states the rule: "Attendance
   * (applyTaught) raises belief and so can never create a gap on its own;
   * adding it would let the difficulty prior back in through the side door,
   * which is the defect this whole gate exists to close." Measured: one `taught`
   * on a difficulty-4 node was enough to return it as a remedial step at 0.46,
   * a prior nothing had measured.
   */
  answerObservations: number;
  /**
   * Raised hands. Counted apart from `observations` so a hand cannot be read as
   * evidence the student was examined — but it DOES open the gate, because
   * `applyDoubt` lowers belief, and a student who stopped the class on an
   * outcome has told us something that may legitimately make it a gap.
   */
  doubtCount: number;
  /**
   * Rung-0 answers only, counted apart — because without it "unassisted
   * mastery 0.5" and "nobody has ever asked them cold" are the same number,
   * and they are not the same fact. Every read of `unassistedMastery` must
   * check this first.
   */
  unassistedObservations: number;
  /**
   * How many times this outcome has been TAUGHT. `applyTaught` saturates on
   * this count, so it has to be durable rather than per-session: the placement
   * screen applies attendance twice today (Diagnostic.tsx:102-105) precisely
   * because nothing held it across sittings, and attendance alone can carry a
   * node from the prior to nearly settled on zero answered questions.
   */
  taughtCount: number;

  lastPracticedAt: string | null;
  lastUnassistedSuccessAt: string | null;

  /**
   * WHEN THE ONE MASTERY RULE LAST BECAME TRUE, or null while it does not hold
   * (B8).
   *
   * The rule: `unassistedMastery` at or above `MASTERY_LINE` (0.8), with right
   * answers given COLD on at least two DISTINCT items at least
   * `MASTERY_SPACING_MS` (24 h) apart. One lucky answer is not mastery; the
   * same question twice is memory of that question; two items in one sitting
   * are one sitting.
   *
   * It is a statement about NOW, so it is taken away again when a cold miss
   * drops unassisted belief below the line — a stamp that outlived its evidence
   * would tell a planner to skip what the student just showed they cannot do.
   * While the rule keeps holding the first stamp is kept.
   *
   * The time is the SESSION's `startedAt` (see `FoldSession`), which is also
   * the clock the spacing is measured on. On the server fold that is
   * Postgres's clock; the device replica reads its own stamp until B7.
   */
  masteredAt: string | null;
  /**
   * THE COLD RIGHT ANSWERS THE MASTERY RULE NEEDS, AND NO MORE.
   *
   * Per item (`itemKey` in fold.ts: probe id, else school item id, else beat
   * id), the session time of
   * its first and latest right answer at rung 0. The rule asks whether ANY two
   * distinct items are a day apart, and the widest such pair always uses one of
   * the two items with the earliest first win and one of the two with the latest
   * last win — so only those (at most four) are kept, and the record cannot grow
   * with a student's history. That pruning is exact when sessions arrive in time
   * order, which is the order the fold consumes them in.
   */
  coldWins: Record<string, { first: string; last: string }>;

  /**
   * SPACED REVIEW (F1-F3, memory.ts). `box` is 0-5 on the 1/2/5/12/30/60-day
   * ladder, null until the outcome is first taught or answered; `nextReviewAt`
   * is when it is due. `lastExposedAt` is the last time they were SHOWN it
   * (a taught beat, an answer at rung >= 5) and `lastRetrievedAt` the last
   * cold answer at least a day after that; `retrievalCount` and
   * `retrievalAccuracy` count those retrievals only.
   *
   * `memoryStrength` is still written as 0 and driven by nothing.
   */
  box: number | null;
  lastExposedAt: string | null;
  lastRetrievedAt: string | null;
  memoryStrength: number;
  nextReviewAt: string | null;
  retrievalCount: number;
  retrievalAccuracy: number;

  /**
   * THE WRONG IDEAS THIS OUTCOME'S ANSWERS SHOWED (v4, misconception.ts).
   *
   * Every wrong answer that names an idea (its label) or, failing that, a wrong
   * option on an item, is kept here with the items and sittings it came up in.
   * One is a slip; `confirmedMisconceptions` returns those shown on two
   * distinct items or in two sittings, and two later cold right answers on
   * distinct items clear one. Bounded by `MISCONCEPTION_LIMITS`.
   */
  misconceptions: Record<string, Misconception>;
}

/**
 * Bumped whenever `ConceptState` changes shape OR the fold's arithmetic
 * changes. The classroom brings a stored model of an older version forward
 * before folding into it (apps/classroom/src/lib/learnerModel.ts
 * `bringForward`): rebuilt from the ledger when the cloud has it, else
 * migrated in place by `migrateModel`. `foldSession` itself starts an
 * old-version model from empty.
 *
 * 2 (2026-09-29): help discounted by rung (B4), a second attempt counted as at
 * least a nudge (B4), and `masteredAt` / `coldWins` added (B8). A v1 model
 * credited every hinted answer at full weight; a migrated one keeps that
 * credit until a rebuild replaces it.
 *
 * 3 (2026-09-29): spaced review (F1-F3) — `box`, `lastExposedAt`,
 * `lastRetrievedAt`, and `nextReviewAt` / `retrievalCount` /
 * `retrievalAccuracy` now driven. A migrated v2 model starts every outcome
 * with no box, so its reviews begin at the next time each one is met.
 *
 * 4 (2026-10-07): misconceptions enter the model (`misconceptions`); a school
 * item id (`itemId`) is an item for the mastery rule's distinct items; the
 * second-attempt nudge is kept to the tutor's own sources, because a homework
 * `attempt` numbers a whole new hand-in. A migrated v3 model starts every
 * outcome with no misconceptions until a rebuild from the ledger fills them.
 */
export const MODEL_VERSION = 4;

/** B8's line: unassisted belief at or above this, on spaced distinct items. */
export const MASTERY_LINE = 0.8;

/** B8's spacing: two distinct items answered right cold at least this far apart. */
export const MASTERY_SPACING_MS = 24 * 60 * 60 * 1000;

/**
 * HOW FAR THE FOLD HAS CONSUMED A STUDENT'S HISTORY.
 *
 * `(learning_session.started_at, sessionId, seq)`, in that order — or, where
 * the server folds forward in its order of receipt, the batch's `orderAt`
 * (fold.ts FoldSession) in place of the start. Three parts and each earns its
 * place:
 *
 *   * `at` is the SESSION'S started_at — a server clock — and NOT the event's
 *     own `at`, which is the phone's. The ledger says so itself
 *     (packages/ledger/src/types.ts:102-108): "Ordering must not depend on
 *     `at`, because `at` is a phone's clock and phones lie." An earlier draft
 *     of this used the event clock, and a single NTP correction mid-session
 *     then put the rest of that session permanently behind the cursor — lost
 *     for the student's whole life, and not recoverable by a rebuild, because
 *     the rebuild replays the same events and re-poisons the same cursor.
 *   * `sessionId` breaks a tie between two sittings that began in the same
 *     millisecond, which `seq` cannot: `seq` restarts at 0 per session.
 *   * `seq` orders within one session, which is the only thing it can do.
 */
export interface FoldCursor {
  at: string;
  sessionId: string;
  seq: number;
}

export interface LearnerModel {
  states: Record<string, ConceptState>;
  /**
   * Makes a fold both incremental AND idempotent: an event at or behind this is
   * skipped, so a retried request cannot count one quiz twice.
   */
  foldedThrough: FoldCursor | null;
  /**
   * THE HELP ALREADY HANDED OVER IN THE SESSION BEING FOLDED, per ask.
   *
   * This is the only piece of in-flight state the model carries, and it is here
   * rather than in a local because THE DEVICE FOLDS A SESSION IN MANY CALLS —
   * one per event as it happens. Held in a local, a `helped` folded in one call
   * was invisible to the answer folded in the next, and the answer was then
   * scored as unassisted. That failure manufactures mastery a child does not
   * have, which `deriveRung` names as the one error nothing downstream can
   * correct.
   *
   * Dropped when a different session starts: help is a fact about one sitting.
   */
  helpInFlight: { sessionId: string; byAsk: Record<string, number> } | null;
  version: number;
}

/**
 * `PRIOR` is imported rather than re-declared. Two priors that can drift is
 * exactly the defect class this repo keeps finding, and a state seeded from a
 * different prior than `initialMastery` uses would be invisible until a
 * student's beliefs disagreed with their own study plan.
 */
export const emptyConceptState = (outcomeId: string): ConceptState => ({
  outcomeId,
  mastery: PRIOR,
  unassistedMastery: PRIOR,
  assistedPerformance: PRIOR,
  observations: 0,
  answerObservations: 0,
  doubtCount: 0,
  unassistedObservations: 0,
  taughtCount: 0,
  lastPracticedAt: null,
  lastUnassistedSuccessAt: null,
  masteredAt: null,
  coldWins: {},
  box: null,
  lastExposedAt: null,
  lastRetrievedAt: null,
  memoryStrength: 0,
  nextReviewAt: null,
  retrievalCount: 0,
  retrievalAccuracy: 0,
  misconceptions: {},
});

export const emptyModel = (): LearnerModel => ({
  states: {},
  foldedThrough: null,
  helpInFlight: null,
  version: MODEL_VERSION,
});
