import {
  MASTERY_LINE,
  MASTERY_SPACING_MS,
  type ConceptState,
} from './types.ts';

type ColdWins = ConceptState['coldWins'];

/**
 * ONE COLD RIGHT ANSWER, ADDED TO WHAT THE MASTERY RULE REMEMBERS.
 *
 * Pure: returns a new record. `at` is the session clock the fold is using (see
 * `ConceptState.masteredAt`), never the device's event clock.
 *
 * After adding, it keeps only the items that can still be half of the widest
 * pair: the two with the earliest first win and the two with the latest last
 * win. Any pair of distinct items spans at most (latest last) − (earliest
 * first); when one item holds both extremes, the next-best on either side is
 * the only other candidate. So these at most four entries answer the rule's
 * question exactly, provided sessions are folded in time order — which the
 * fold's cursor guarantees for the server and for a rebuild.
 */
export function recordColdWin(wins: ColdWins, item: string, at: string): ColdWins {
  const prev = wins[item];
  const next: ColdWins = {
    ...wins,
    [item]: prev ? { first: prev.first, last: later(prev.last, at) } : { first: at, last: at },
  };

  const items = Object.keys(next);
  if (items.length <= 4) return next;

  const byFirst = [...items].sort((a, b) => Date.parse(next[a].first) - Date.parse(next[b].first));
  const byLast = [...items].sort((a, b) => Date.parse(next[b].last) - Date.parse(next[a].last));
  const keep = new Set([...byFirst.slice(0, 2), ...byLast.slice(0, 2)]);

  const pruned: ColdWins = {};
  for (const id of keep) pruned[id] = next[id];
  return pruned;
}

/**
 * Whether two DISTINCT items were answered right cold at least a day apart.
 * Two items in one sitting share one session time and never pass; the same
 * item twice is one key and never pairs with itself.
 */
export function spacedOnDistinctItems(wins: ColdWins): boolean {
  const items = Object.keys(wins);
  for (const early of items) {
    for (const late of items) {
      if (early === late) continue;
      const spread = Date.parse(wins[late].last) - Date.parse(wins[early].first);
      if (spread >= MASTERY_SPACING_MS) return true;
    }
  }
  return false;
}

/**
 * THE ONE MASTERY RULE (B8), applied to a state the fold has just updated.
 *
 * Holds → keep the existing stamp, or stamp `at`. Does not hold → null. Only
 * the fold's rung-0 path calls this, because only a cold answer can move
 * `unassistedMastery` or `coldWins`; a hinted answer can neither grant nor
 * take away mastery. Both beliefs must be at the line (v5): the verified one,
 * so the phone's word cannot carry it there, and the decision one, so a cold
 * miss the phone graded still takes the stamp away. The fold never lets a
 * phone-graded answer GIVE a stamp this returns (fold.ts).
 */
export function stampMastery(state: ConceptState, at: string): string | null {
  const holds =
    state.verifiedObservations > 0 &&
    state.verifiedMastery >= MASTERY_LINE &&
    state.unassistedMastery >= MASTERY_LINE &&
    spacedOnDistinctItems(state.coldWins);
  if (!holds) return null;
  return state.masteredAt ?? at;
}

const later = (a: string, b: string): string => (Date.parse(b) > Date.parse(a) ? b : a);
