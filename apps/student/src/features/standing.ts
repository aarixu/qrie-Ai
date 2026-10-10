import type { BrainStatus, OnTheirOwn, PracticeChapter } from '@ai-tutor/lms-client'
import { FEW_ANSWERS, GETTING_THERE, STRONG } from '../components/mastery-info'

export type Standing = {
  word: string
  tone: string
  bar: string
  /** The figure from answers given alone, 0-1, for the bar; null under FEW_ANSWERS of them. */
  value: number | null
}

/**
 * Words for a child, not a number: the model's belief is a guide, not a grade.
 * MasteryInfo says what they mean. Read from what the child did on their own
 * (lms.* unassisted_mastery, 0105), never from the figure help is folded into:
 *   - "Strong": FEW_ANSWERS or more answers alone, and STRONG or more alone;
 *   - "Getting there (with help)": otherwise, when they reach STRONG with help;
 *   - "Just started": under FEW_ANSWERS answers alone;
 *   - "Getting there" / "Needs practice": the figure alone, at GETTING_THERE.
 */
export function standingOf(s: OnTheirOwn): Standing {
  const value = s.unassistedMastery !== null && s.unassistedObservations >= FEW_ANSWERS ? s.unassistedMastery : null
  if (value !== null && value >= STRONG) {
    return { word: 'Strong', tone: 'bg-green-600/15 text-green-700', bar: 'bg-green-600', value }
  }
  if (s.assistedPerformance !== null && s.assistedPerformance >= STRONG) {
    return { word: 'Getting there (with help)', tone: 'bg-amber-500/15 text-amber-700', bar: 'bg-amber-500', value }
  }
  if (value === null) return { word: 'Just started', tone: 'bg-muted text-muted-foreground', bar: 'bg-slate-400', value }
  if (value >= GETTING_THERE) return { word: 'Getting there', tone: 'bg-amber-500/15 text-amber-700', bar: 'bg-amber-500', value }
  return { word: 'Needs practice', tone: 'bg-red-500/15 text-red-700', bar: 'bg-red-500', value }
}

/**
 * The open chapter (questions to practise) the child is weakest in on their
 * own: a chapter answered only with help counts as nothing alone (0), one not
 * answered yet as 0.5. Null when no chapter is open.
 */
export function weakestAlone(chapters: PracticeChapter[]): PracticeChapter | null {
  const alone = (c: PracticeChapter) => c.unassistedMastery ?? (c.answers > 0 ? 0 : 0.5)
  const open = chapters.filter((c) => c.questions > 0)
  return open.length ? [...open].sort((a, b) => alone(a) - alone(b))[0] : null
}

/**
 * What the chapter list says when it has no chapter: the brain has not read
 * the answers the server holds yet (lms.brain_status, 0105), or there are none
 * to read. `name` is a parent's child.
 */
export function chaptersEmptyText(status: BrainStatus | null | undefined, name?: string): string {
  if (status?.waitingSince) {
    return name ? `Checking ${name}’s answers, back in a few minutes.` : 'Checking your answers, back in a few minutes.'
  }
  return name
    ? `When ${name} hands in work or practises in Learn, their chapters show up here.`
    : 'Hand in work or practise in Learn, and your chapters show up here.'
}
