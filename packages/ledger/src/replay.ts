import type { AnsweredPayload, LedgerEvent } from './types.ts';

/**
 * REPLAY — the test that says these rows are a record rather than a log.
 *
 * A ledger is only correct if the state it replaces can be rebuilt from it. If
 * it cannot, it is a pile of interesting text that happens to sit next to the
 * real state, and every later phase that reads it as ground truth is reading
 * something nobody has checked.
 *
 * So this rebuilds exactly what `apps/classroom/src/stores/outcomes.ts` keeps —
 * the four counters the ledger is there to replace. Matching them is the floor,
 * not the ceiling: the point of the ledger is everything it holds that they
 * cannot. But a ledger that cannot even reproduce the counters is not ready to
 * take over from them, and this is how that claim stops being an opinion.
 *
 * Pure, and order-independent by construction: counters are commutative, which
 * is why this is the right first replay target. The learner model is not, and
 * when it arrives its replay will have to respect `seq`.
 */

export interface Counters {
  /** Outcomes sat through in a finished class. Real evidence, and weak. */
  taught: Record<string, number>;
  /** Outcomes a hand went up on. */
  confused: Record<string, number>;
  answeredRight: Record<string, number>;
  answeredWrong: Record<string, number>;
}

export const emptyCounters = (): Counters => ({
  taught: {},
  confused: {},
  answeredRight: {},
  answeredWrong: {},
});

const bump = (into: Record<string, number>, ids: readonly string[]): void => {
  for (const id of ids) into[id] = (into[id] ?? 0) + 1;
};

export function replayCounters(events: readonly LedgerEvent[]): Counters {
  const out = emptyCounters();
  for (const event of events) {
    // An event that speaks about no outcome changes no belief. A hook beat, a
    // recap, a class whose lesson predates the map: the store returns early on
    // exactly the same condition, and replay has to agree or the two diverge
    // on the quietest possible case.
    if (event.outcomeIds.length === 0) continue;

    switch (event.kind) {
      case 'taught':
        bump(out.taught, event.outcomeIds);
        break;
      case 'confused':
        bump(out.confused, event.outcomeIds);
        break;
      case 'answered': {
        const { correct } = event.payload as AnsweredPayload;
        bump(correct ? out.answeredRight : out.answeredWrong, event.outcomeIds);
        break;
      }
      default:
        // asked, helped, intervened, reflected and the session markers move no
        // counter. They are the half the counters could never hold, and the
        // reason this ledger exists.
        break;
    }
  }
  return out;
}
