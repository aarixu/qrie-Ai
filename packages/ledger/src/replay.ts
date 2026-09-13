import type { AnsweredPayload, LedgerEvent, ReflectedPayload } from './types.ts';

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
  /**
   * THE TWO COUNTERS `outcomes.ts` DOES NOT HAVE, and the only ones here that
   * are not a parity check.
   *
   * Everything above rebuilds a counter the store already keeps, because a
   * ledger that cannot reproduce the model it replaces is not ready to take
   * over from it. These two rebuild something the store could never hold:
   * whether the student could JUSTIFY a right answer when asked one why/how/
   * when about it, which is the difference between mastery and recall.
   *
   * They are here rather than left for the learner model because a row nothing
   * ever reads is how `reflected` spent its whole life as a kind with no
   * emitter. A reflection that changes no belief anywhere is not evidence, it
   * is a log line.
   */
  justified: Record<string, number>;
  unjustified: Record<string, number>;
  /**
   * A CROSS-QUESTION THAT GOT NO WORDS BACK — counted, and counted against
   * nobody.
   *
   * `types.ts` gives the reason `ReasoningVerdict` has three states and not
   * two: "collapsing them would hide the commonest outcome of a cross-question
   * inside the rarest." This function then collapsed them anyway — 'silent'
   * and 'wobbled' both bumped `unjustified` — so the distinction survived in
   * the row and died in the only thing that reads it.
   *
   * It is separate AND it is not evidence against the student, which is the
   * part that matters. 'silent' on this path is the ear's grace window
   * expiring: a child still thinking, a noisy room, a mic the OS handed to an
   * incoming call and a genuine shrug are one signal at this layer, and five
   * lines from where the class files this it treats the identical silence on
   * an ANSWER as no evidence at all. The old comment defended the collapse by
   * analogy to a skipped question, but a skip is a deliberate tap and this is
   * a timeout. Until the product can tell a shrug from a dead mic, the honest
   * place for it is its own column.
   */
  silentOnProbe: Record<string, number>;
}

export const emptyCounters = (): Counters => ({
  taught: {},
  confused: {},
  answeredRight: {},
  answeredWrong: {},
  justified: {},
  unjustified: {},
  silentOnProbe: {},
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
      case 'reflected': {
        const { reasoningVerdict } = event.payload as ReflectedPayload;
        // No verdict means nobody weighed the reasoning — the close came back
        // with words to speak and nothing about whether they held. That is an
        // absence of judgement, not a judgement of absence, and it must not be
        // read as a failure to justify.
        if (reasoningVerdict === undefined) break;
        // Silence gets its own counter and moves neither of the other two —
        // see `silentOnProbe` for why it is not filed with the wobbles.
        if (reasoningVerdict === 'silent') {
          bump(out.silentOnProbe, event.outcomeIds);
          break;
        }
        bump(reasoningVerdict === 'held' ? out.justified : out.unjustified, event.outcomeIds);
        break;
      }
      default:
        // asked, helped, intervened and the session markers move no counter.
        // They are the half the counters could never hold, and the reason this
        // ledger exists.
        break;
    }
  }
  return out;
}
