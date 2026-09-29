import type { ConceptState } from './types.ts';

/**
 * F1-F3: MEMORY, IN THE PURE FOLD (T4a).
 *
 * Each outcome sits in a box, 0 to 5, and the box decides when it comes back:
 * 1, 2, 5, 12, 30 or 60 days after the last time it was met. The rules:
 *   - the first taught or answered event opens box 0, with a review a day on;
 *   - an unassisted right answer that is a RETRIEVAL, given once the review
 *     is due, moves up one box — at most once a session (sixth review,
 *     2026-09-29: six right answers in one sitting reached box 5, a 60-day
 *     review, on one afternoon's evidence);
 *   - any wrong answer, helped or not, goes back to box 0;
 *   - a right answer with help, or a cold one that is not a retrieval, holds.
 *
 * EXPOSURE IS NOT RETRIEVAL. An exposure is being shown the thing: a taught
 * beat, or an answer given at rung 5 or above (a worked example, the answer on
 * screen). A retrieval is an unassisted answer at least 24 hours after the
 * last exposure. A child who answers right a minute after the lesson has
 * shown they were listening, not that they remember — so that answer holds
 * the box, and (fold.ts) never counts toward `masteredAt`.
 *
 * THE CLOCK is the session's start, the same clock `masteredAt` is stamped
 * on (see `FoldSession`): on the server fold that is Postgres's clock, and a
 * device's own clock only until then.
 */

/** Days until the next review, by box. */
export const REVIEW_LADDER_DAYS = [1, 2, 5, 12, 30, 60] as const;

/** The top box. */
export const TOP_BOX = REVIEW_LADDER_DAYS.length - 1;

/** How long after an exposure a cold answer counts as remembering rather than repeating. */
export const RETRIEVAL_GAP_MS = 24 * 60 * 60 * 1000;

/** The rung from which an answer counts as the child having been SHOWN it. */
export const EXPOSURE_RUNG = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When an outcome in `box` is next due, counted from `at`. */
export function reviewAt(at: string, box: number): string {
  const b = Math.min(TOP_BOX, Math.max(0, Math.floor(box)));
  return new Date(Date.parse(at) + REVIEW_LADDER_DAYS[b] * DAY_MS).toISOString();
}

/** A taught beat, a live page or a recap: the child was shown it at `at`. */
export function onExposure(prev: ConceptState, at: string): Partial<ConceptState> {
  return {
    lastExposedAt: at,
    ...(prev.box === null ? { box: 0, nextReviewAt: reviewAt(at, 0) } : {}),
  };
}

/** Whether an unassisted answer at `at` is a retrieval: not within a day of being shown it. */
export function isRetrieval(prev: ConceptState, at: string, rung: number): boolean {
  if (rung !== 0) return false;
  if (prev.lastExposedAt === null) return true;
  return Date.parse(at) - Date.parse(prev.lastExposedAt) >= RETRIEVAL_GAP_MS;
}

/** An answer at `at`, given at `rung`, right or wrong. */
export function onAnswer(prev: ConceptState, at: string, rung: number, correct: boolean): Partial<ConceptState> {
  const retrieval = isRetrieval(prev, at, rung);
  let box = prev.box ?? 0;
  if (!correct) box = 0;
  // The first meeting opens box 0 whatever the answer; after that, only a
  // right retrieval climbs — once a session, and only when it was due.
  else if (
    retrieval &&
    prev.box !== null &&
    (prev.lastRetrievedAt === null || Date.parse(at) > Date.parse(prev.lastRetrievedAt)) &&
    (prev.nextReviewAt === null || Date.parse(at) >= Date.parse(prev.nextReviewAt))
  ) {
    box = Math.min(TOP_BOX, box + 1);
  }

  // Rescheduled only when something changed — first meeting, a miss, a
  // climb, or a due retrieval at the top box, which cannot climb (eighth
  // review: holding its date kept a mastered outcome due forever). Any other
  // right answer that holds keeps the date it was due: resetting it pushed the
  // review away every time a keen child practised early, and the box never
  // climbed (seventh review, 2026-09-29).
  const dueNow = prev.nextReviewAt !== null && Date.parse(at) >= Date.parse(prev.nextReviewAt);
  const held =
    correct && prev.box !== null && box === prev.box && prev.nextReviewAt !== null && !(retrieval && dueNow && box === TOP_BOX);
  const out: Partial<ConceptState> = { box, nextReviewAt: held ? prev.nextReviewAt : reviewAt(at, box) };
  if (rung >= EXPOSURE_RUNG) out.lastExposedAt = at;
  if (retrieval) {
    const n = prev.retrievalCount + 1;
    out.lastRetrievedAt = at;
    out.retrievalCount = n;
    out.retrievalAccuracy = (prev.retrievalAccuracy * prev.retrievalCount + (correct ? 1 : 0)) / n;
  }
  return out;
}

/** Shown it in this very session — so a right answer now is not evidence of mastery. */
export function exposedThisSession(prev: ConceptState, sessionStartedAt: string): boolean {
  return prev.lastExposedAt !== null && Date.parse(prev.lastExposedAt) >= Date.parse(sessionStartedAt);
}
