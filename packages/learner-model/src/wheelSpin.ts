import type { EventSource, LedgerEvent } from '@ai-tutor/ledger';
import { eachAnswerWithRung } from './assistance.ts';

/**
 * WHEEL-SPINNING: ATTEMPTS WITHOUT PROGRESS, ONLY WHERE IT IS MEASURABLE.
 *
 * Beck and Gong's construct: a student who has made N failed attempts on a
 * skill without ever reaching mastery is not practising, they are spinning —
 * and more practice of the same kind is exactly what will not help them.
 * Here: N or more incorrect COLD attempts on an outcome, and no cold success
 * anywhere in the evidence.
 *
 * A cold attempt is an answer from the quiz or diagnostic surface at derived
 * rung 0. Those surfaces are unassisted by construction — `quizLedger` files
 * every answer at rung 0, hint-free — and the rung is still derived
 * defensively, exactly as in `assistanceScore`, so an assisted answer that
 * somehow reached these surfaces cannot count as cold.
 *
 * The class and doubt surfaces get an explicit NOT-MEASURABLE reading rather
 * than a silent zero, which is the plan's own instruction
 * (closed-loop-rebuild.md:540-542): a class retry follows escalating help,
 * which is assistance, not spinning, and at ~4 asks a class the volume could
 * never detect it anyway. Saying "we cannot see this here" is a finding;
 * shipping 0 would be a lie about a student.
 */
export type WheelSpinReading =
  | { measurable: true; spinning: boolean; coldAttempts: number }
  | { measurable: false; reason: 'help-saturated-surface' };

export interface WheelSpinOptions {
  /** How many failed cold attempts, with no cold success, count as spinning. */
  attempts?: number;
}

const DEFAULT_ATTEMPTS = 3;

/** The surfaces that file unassisted answers by construction. */
const measures = (source: EventSource): boolean =>
  source === 'quiz' || source === 'diagnostic';

export function wheelSpinning(
  events: readonly LedgerEvent[],
  opts?: WheelSpinOptions,
): Record<string, WheelSpinReading> {
  const attempts = opts?.attempts ?? DEFAULT_ATTEMPTS;

  interface Tally {
    measurable: boolean;
    cold: number;
    coldWrong: number;
    coldRight: boolean;
  }
  const tallies = new Map<string, Tally>();
  const tally = (id: string): Tally => {
    let t = tallies.get(id);
    if (!t) {
      t = { measurable: false, cold: 0, coldWrong: 0, coldRight: false };
      tallies.set(id, t);
    }
    return t;
  };

  // Every outcome any event names enters the result — an outcome with no
  // events at all stays absent — and it is measurable the moment any of its
  // evidence comes from a measuring surface, answered or not: the reading
  // "measurable, zero attempts" is true there, where "not measurable" is not.
  for (const event of events) {
    for (const id of event.outcomeIds) {
      const t = tally(id);
      if (measures(event.source)) t.measurable = true;
    }
  }

  eachAnswerWithRung(events, (event, payload, rung) => {
    if (!measures(event.source) || rung !== 0) return;
    for (const id of event.outcomeIds) {
      const t = tally(id);
      t.cold += 1;
      if (payload.correct) t.coldRight = true;
      else t.coldWrong += 1;
    }
  });

  const result: Record<string, WheelSpinReading> = {};
  for (const [id, t] of tallies) {
    result[id] = t.measurable
      ? { measurable: true, spinning: !t.coldRight && t.coldWrong >= attempts, coldAttempts: t.cold }
      : { measurable: false, reason: 'help-saturated-surface' };
  }
  return result;
}
