import type { BrainStatus, PracticeForMe } from '@ai-tutor/lms-client'
import { chaptersEmptyText } from '../standing'

/**
 * The lines on the "Picked for you" card, from a round lms.practice_for_me
 * (0104) ranked by the child's own answers: the first outcome due for review,
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

/**
 * What the "Picked for you" card shows: the picked round to open, with its
 * lines (pickedForYou); else, while the brain has not read answers the
 * server holds (lms.brain_status, 0105), the chapter list's words for that
 * (chaptersEmptyText), with nothing to open; else nothing.
 */
export function pickedCard(
  rows: readonly PracticeForMe[],
  status: BrainStatus | null | undefined
): { open: boolean; lines: string[] } | null {
  const lines = pickedForYou(rows)
  if (lines.length > 0) return { open: true, lines }
  if (status?.waitingSince) return { open: false, lines: [chaptersEmptyText(status)] }
  return null
}
