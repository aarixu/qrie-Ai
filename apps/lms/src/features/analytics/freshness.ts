import { formatDistanceStrict } from 'date-fns'
import type { ClassBrainStatus } from '@ai-tutor/lms-client'

/** An answer the brain has not read for this long makes the figures "delayed". */
export const DELAYED_AFTER_MS = 30 * 60_000

const delayed = (s: ClassBrainStatus, now: number) =>
  s.waitingSince !== null && now - Date.parse(s.waitingSince) > DELAYED_AFTER_MS

/**
 * How fresh a class's figures are (lms.class_brain_status, 0065): when the
 * brain last wrote any child's model, and "Results delayed" once an answer of
 * theirs has waited for it over DELAYED_AFTER_MS. Null when there is nothing
 * to say.
 */
export function freshness(
  status: ClassBrainStatus | null | undefined,
  now: number = Date.now()
): { text: string; delayed: boolean } | null {
  if (!status) return null
  const updated = status.updatedAt
    ? formatDistanceStrict(new Date(status.updatedAt), new Date(now), { addSuffix: true })
    : null
  if (delayed(status, now)) {
    return { text: updated ? `Results delayed · updated ${updated}` : 'Results delayed', delayed: true }
  }
  return updated ? { text: `Updated ${updated}`, delayed: false } : null
}

/**
 * What a class's empty figures say while answers wait for the brain, instead
 * of "no answers yet"; null when none waits.
 */
export function waitingText(status: ClassBrainStatus | null | undefined, now: number = Date.now()): string | null {
  if (!status?.waitingSince) return null
  const who = `${status.studentsWaiting} ${status.studentsWaiting === 1 ? 'student' : 'students'}`
  return delayed(status, now)
    ? `Results delayed: answers are in from ${who}, not worked out yet.`
    : `Answers are in from ${who}. Qrie is working them out; results show here in a few minutes.`
}
