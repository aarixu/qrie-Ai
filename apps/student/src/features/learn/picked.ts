import type { PracticeForMe } from '@ai-tutor/lms-client'

/**
 * The lines on the "Picked for you" card, from a round lms.practice_for_me
 * (0064) ranked by the child's own answers: the first outcome due for review,
 * then the first outcome to practise (a wrong idea to fix, or an outcome they
 * are not yet strong on alone) with the idea to watch out for. None when the
 * round holds only questions new to them or ones they are strong on, because
 * then the evidence picked nothing. The child never reads "misconception" or
 * "confirmed" (review SF10).
 */
export function pickedForYou(rows: readonly PracticeForMe[]): string[] {
  const review = rows.find((r) => r.reason === 'review')
  const practise = rows.find((r) => r.reason === 'misconception' || r.reason === 'weak')
  const lines: string[] = []
  if (review) lines.push(`Review due: ${review.outcomeTitle}`)
  if (practise) {
    lines.push(
      practise.watchOut
        ? `Practise this: ${practise.outcomeTitle}, watch out for: ${practise.watchOut}`
        : `Practise this: ${practise.outcomeTitle}`
    )
  }
  return lines
}
