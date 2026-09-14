import type { AssistanceRung } from '@ai-tutor/ledger';

/**
 * WHICH RUNG WAS REALLY IN FORCE WHEN THIS ANSWER WAS GIVEN.
 *
 * Two witnesses, and neither is trustworthy alone.
 *
 * The client's recorded rung comes from a per-mount React ref
 * (`classLedger.ts:186`), so a remount between the hint and the answer loses
 * it. And it fails in the worst direction available: rung 0 is produced by the
 * ABSENCE of a `helped` call rather than by positive evidence, so a `helped`
 * that never reached the ledger MANUFACTURES unassisted mastery instead of
 * losing it.
 *
 * The `helped` rows are durable and ordered by `seq`, but a `helped` the app
 * failed to emit at all leaves no trace anywhere.
 *
 * SO: TAKE THE ONE WITH MORE HELP. The two errors are not symmetrical.
 * Deciding a student was helped when they were not costs one piece of
 * unassisted evidence, and the next question they are asked restores it.
 * Deciding they were UNASSISTED when they were helped credits them with mastery
 * they do not have — and this product's whole job is to teach what a student
 * cannot yet do alone, so that error removes the teaching they needed and
 * nothing downstream ever corrects it.
 */
export function deriveRung(
  helpedBefore: readonly AssistanceRung[],
  recorded: AssistanceRung,
): AssistanceRung {
  let most: AssistanceRung = recorded;
  for (const rung of helpedBefore) if (rung > most) most = rung;
  return most;
}
