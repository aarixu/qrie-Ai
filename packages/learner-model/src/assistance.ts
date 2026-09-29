import type {
  AnsweredPayload,
  AssistanceRung,
  HelpedPayload,
  LedgerEvent,
} from '@ai-tutor/ledger';
import { atLeastANudge, deriveRung } from './rung.ts';

/**
 * THE ASSISTANCE-BLENDED SCORE, PER OUTCOME.
 *
 * Percent-correct treats a cold right answer and a right answer four hints
 * later as the same event. ASSISTments found that a score blending correctness
 * with how much assistance the answer needed predicted external post-tests
 * BETTER than percent-correct — the help a student needed is evidence about
 * them, not noise around the answer. This is that score: per answered event,
 * `correct ? credit(rung) : 0`, averaged per outcome.
 *
 * The default credit curve satisfies the discount invariant the 2026-09-14
 * spec fixes (learner-model-design.md:339-346): a correct answer at rung k
 * never credits more than the same answer at rung k-1, and a rung-8 correct
 * answer still credits above zero — a student who got there with the full
 * answer in hand did learn something; they did not learn as much as the one
 * who got there cold. `defaultCredit(8) = 0.2`, with a 0.1 floor so no curve
 * change can ever make full help worth nothing.
 */
export const defaultCredit = (rung: AssistanceRung): number => Math.max(0.1, 1 - rung / 10);

/**
 * One ask, however the surface happens to name it. The same rule as fold.ts's
 * private `askKey`, restated here because 3.7's projections read the raw
 * ledger rather than the fold — if the two ever disagree, an answer and its
 * help stop finding each other, so any change there must land here too.
 */
export function askKey(
  beatId: string | undefined,
  probeId: string | undefined,
  ids: readonly string[],
): string {
  return beatId ?? probeId ?? ids.join(',');
}

/**
 * WALKS THE FLAT STREAM AND HANDS EACH ANSWER ITS REAL RUNG.
 *
 * `events` is the exact order `rebuildFromLedger` and `foldSession` consume:
 * (session start, seq). Help is tracked per session and per ask — max rung
 * wins, exactly as in fold.ts — and because the walk is in `seq` order, a
 * `helped` row only reaches an answer it PRECEDED. Help never crosses a
 * session: each session has its own map, so the same ask key in the next
 * sitting starts cold.
 *
 * The rung is derived, not trusted: `deriveRung` takes the larger of the
 * durable helped rows and the rung the client recorded, because the client's
 * rung comes from a per-mount ref and losing it manufactures unassisted
 * mastery. Shared by `assistanceScore` and `wheelSpinning` so the two cannot
 * drift about which answers were cold.
 */
export function eachAnswerWithRung(
  events: readonly LedgerEvent[],
  visit: (event: LedgerEvent, payload: AnsweredPayload, rung: AssistanceRung) => void,
): void {
  const helpBySession = new Map<string, Record<string, number>>();
  for (const event of events) {
    if (event.kind === 'helped') {
      const payload = event.payload as HelpedPayload;
      const key = askKey(payload.beatId, payload.probeId, event.outcomeIds);
      const help = helpBySession.get(event.sessionId) ?? {};
      help[key] = Math.max(help[key] ?? 0, payload.rung);
      helpBySession.set(event.sessionId, help);
      continue;
    }
    if (event.kind !== 'answered') continue;
    const payload = event.payload as AnsweredPayload;
    const help = helpBySession.get(event.sessionId) ?? {};
    const key = askKey(payload.beatId, payload.probeId, event.outcomeIds);
    // The fold's rule exactly, including B4's "a second attempt is at least a
    // nudge" — the two must agree about which answers were cold.
    const rung = atLeastANudge(
      deriveRung([(help[key] ?? 0) as AssistanceRung], payload.assistanceRung),
      payload.attempt,
    );
    visit(event, payload, rung);
  }
}

/**
 * Mean assistance-blended score per outcome, over answered evidence only.
 *
 * An outcome with no answered events is ABSENT from the result, never 0 — the
 * same rule `evidenceSet` and `unassistedGain` enforce: a prior is not a
 * finding, and a 0 here would read as "always wrong" about a student nobody
 * asked. An answer that names several outcomes scores each of them, because
 * the beat claimed to be checking all of them.
 */
export function assistanceScore(
  events: readonly LedgerEvent[],
  credit: (rung: AssistanceRung) => number = defaultCredit,
): Record<string, number> {
  const sums: Record<string, { total: number; count: number }> = {};
  eachAnswerWithRung(events, (event, payload, rung) => {
    const score = payload.correct ? credit(rung) : 0;
    for (const id of event.outcomeIds) {
      const cell = (sums[id] ??= { total: 0, count: 0 });
      cell.total += score;
      cell.count += 1;
    }
  });
  const result: Record<string, number> = {};
  for (const [id, { total, count }] of Object.entries(sums)) result[id] = total / count;
  return result;
}
