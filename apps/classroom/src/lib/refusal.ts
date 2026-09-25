/**
 * A RELAY REFUSAL, READ — NOT REWRITTEN.
 *
 * The relay refuses a class for five reasons and writes each one as a sentence
 * for a child rather than as a code (packages/relay/src/gate.ts:198). The care
 * lives in the DISTINCTION it makes: a 429 is the student's own rate or their
 * own daily budget and says so; a 503 is our capacity or our outage, and its
 * wording deliberately does not hand a child a fault they do not have.
 *
 * THIS FILE OWNS THE SHAPE AROUND THAT SENTENCE AND NOTHING ELSE. It adds no
 * wording of its own, because two places writing the same apology drift, and
 * the one that drifts is the one nobody reads in review.
 *
 * WHY IT MATCHES ON TEXT, WHICH LOOKS WRONG AND IS NOT. `relayError`
 * (lib/relay.ts:301) turns a 429 or a 503 into `new Error(sentence)` and drops
 * the rest of the evidence: the status, the machine-readable `reason` field
 * that gate.ts puts in the same body, and the Retry-After header. By the time a
 * screen catches the thing, the sentence IS the only evidence left. Matching it
 * exactly is the honest reading of what survived; guessing from anything else
 * would turn a dropped connection into a lie about somebody's allowance.
 *
 * `apps/classroom/tests/refusal.test.ts` reads gate.ts at test time and fails
 * if the five sentences there and the five keys here stop being the same five.
 * That guard is the only thing making the duplication safe, so it must not be
 * deleted with the duplication still in place; the better fix is the handoff
 * recorded against relay.ts — carry `reason` through instead of the prose.
 *
 * WHAT THIS DOES NOT COVER, SAID PLAINLY. It is gate.ts's five and nothing
 * else. The relay hands a client other 429s and 503s in the same body shape
 * through `fail()`, and `relayError` passes every one of them to a screen
 * verbatim: the OTP rate limit (enroll.ts:482), "we cannot send a code this
 * second" (enroll.ts:477), "we cannot answer this second" (prep.ts:349), and —
 * worst of the set — "The server has no OpenRouter key configured."
 * (relays.ts:107), an operator's sentence that a child should never be shown
 * at all. All of those read as `null` here, so a screen that has adopted
 * `RefusalNotice` still falls back to its old frame for them. That is the
 * honest answer from the evidence that survives, not a claim they do not
 * matter; carrying `reason` through `relayError` is what fixes it.
 */

/** Why the relay said no. The same five names `claim_relay` answers with. */
export type RefusalReason = 'rate' | 'budget' | 'halted' | 'capped' | 'unavailable';

/**
 * How long waiting would have to be, so a screen can offer the right move.
 *
 *   'moment'   — another go in a few seconds is a real offer.
 *   'minutes'  — a deliberate pause. A "Try again" now is a promise we break.
 *   'tomorrow' — the day is spent, theirs or ours. Nothing today changes it.
 */
export type RefusalWait = 'moment' | 'minutes' | 'tomorrow';

export interface Refusal {
  reason: RefusalReason;
  /** The relay's own sentence, word for word. Never composed here. */
  message: string;
  /**
   * OURS, not theirs. True for our capacity and our outages — the 503s, where
   * the student did nothing and has nothing to do differently. A screen uses
   * this to decide whether to say sorry or to explain a limit.
   */
  ours: boolean;
  wait: RefusalWait;
}

/**
 * The five, keyed by the exact sentence gate.ts sends.
 *
 * `ours` follows gate.ts's own status choice: 429 for the student's rate and
 * budget, 503 for a halt, our spent day and a down meter. `wait` follows what
 * each sentence already promises the child — "a moment", "a few minutes",
 * "tomorrow" — so the chrome around it cannot contradict the sentence inside.
 */
const REFUSALS: Record<string, Omit<Refusal, 'message'>> = {
  'That is a lot of asking at once — give it a moment and try again.': {
    reason: 'rate',
    ours: false,
    wait: 'moment',
  },
  'You have used up today’s classes. This resets tomorrow.': {
    reason: 'budget',
    ours: false,
    wait: 'tomorrow',
  },
  'Qrie is having a rest. Classes are paused for a few minutes.': {
    reason: 'halted',
    ours: true,
    wait: 'minutes',
  },
  'Qrie has taught a lot of classes today. Please come back tomorrow.': {
    reason: 'capped',
    ours: true,
    wait: 'tomorrow',
  },
  'We cannot start a class this second. Try again in a moment.': {
    reason: 'unavailable',
    ours: true,
    wait: 'moment',
  },
};

/**
 * Was this a refusal, and which one.
 *
 * `null` for everything else, and that is the load-bearing half: a network
 * failure is not a budget, a 500 is not a limit, and a reader that guessed
 * would tell a child they had used up classes they still have. `relayError`
 * prefixes anything that is not a 429 or a 503 with "relay <status>: ", so an
 * exact match cannot be reached by a wrapped error — which is why the match is
 * exact rather than a contains.
 *
 * Takes a string as well as an Error because a screen that caught one and kept
 * `e.message` in state has only the string left (LiveClass.tsx:673 does exactly
 * that), and a reader unusable at the catch site that already exists would be
 * no use at all.
 */
export function readRefusal(thrown: unknown): Refusal | null {
  const message =
    typeof thrown === 'string' ? thrown : thrown instanceof Error ? thrown.message : null;
  if (message === null) return null;
  const known = Object.prototype.hasOwnProperty.call(REFUSALS, message)
    ? REFUSALS[message]
    : undefined;
  return known ? { ...known, message } : null;
}
