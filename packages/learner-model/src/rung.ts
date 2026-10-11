import type { AnsweredPayload, AssistanceRung, EventSource, LedgerEvent } from '@ai-tutor/ledger';

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

/**
 * A SECOND TRY IS NEVER A COLD TRY (B4).
 *
 * By the time a student answers for the second time they have been told the
 * first answer was not it — which is rung 1, "asked to rethink", whether or
 * not any surface filed a `helped` row for it. So `attempt > 1` raises the rung
 * to at least 1. The same direction as `deriveRung`: when unsure, call it help.
 *
 * THE TUTOR'S RULE, NOT THE SCHOOL'S (v4). On the school's sources `attempt`
 * is never a try at one question: the LMS's submit (0024, 0030) writes it on
 * homework and tests as the number of the whole HAND-IN, a new sitting in
 * which nobody helped; practice (0031) writes none, and nothing writes 'api'
 * today. Any other source, including one this code does not know, keeps the
 * rule: when unsure, call it help.
 *
 * Shared by the fold and by `eachAnswerWithRung`, so the model and the
 * projections cannot disagree about which answers were cold.
 */
export function atLeastANudge(rung: AssistanceRung, attempt: number, source?: EventSource): AssistanceRung {
  if (source !== undefined && SCHOOL_SOURCES.has(source)) return rung;
  return attempt > 1 && rung < 1 ? 1 : rung;
}

/**
 * Sources the LMS writes, where `attempt` numbers a hand-in (see
 * `atLeastANudge`) and `correct` is the server's own mark (see `serverGraded`).
 */
const SCHOOL_SOURCES: ReadonlySet<EventSource> = new Set<EventSource>(['homework', 'test', 'practice', 'api']);

/**
 * WHETHER THE SERVER, NOT THE PHONE, SAID THIS ANSWER WAS RIGHT OR WRONG
 * (lam-one-brain Task 15, C2).
 *
 * The LMS's own functions mark homework, tests and practice against the
 * school's key, and record_evidence (0115) grades a tutor answer to a bank
 * probe against the probe's key and writes `graded: 'server'`. Every other
 * answer is the phone's word: a class lesson's answer, which no key on the
 * server covers, an answer recorded before 0115, and the phone's own events
 * before they are sent. Same direction as `deriveRung`: when unsure, it is the
 * phone's.
 */
export function serverGraded(event: Pick<LedgerEvent, 'source'>, payload: Pick<AnsweredPayload, 'graded'>): boolean {
  return SCHOOL_SOURCES.has(event.source) || payload.graded === 'server';
}
