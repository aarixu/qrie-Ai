import { describe, expect, it } from 'vitest'
import type { OnTheirOwn, PracticeChapter } from '@ai-tutor/lms-client'
import { chaptersEmptyText, standingOf, weakestAlone } from '../src/features/standing'

/**
 * The word a child's chapter or subject is shown by (lam-one-brain Task 3,
 * truth test D08): read from what they did on their own, with a floor of
 * answers given alone, and "with help" when help carried the result. And
 * what an empty list of chapters says while the brain has not read their
 * answers yet (D26).
 */

const alone = (unassistedMastery: number | null, unassistedObservations: number, assistedPerformance: number | null = null): OnTheirOwn => ({
  unassistedMastery,
  unassistedObservations,
  assistedPerformance,
})

describe('the word for a chapter', () => {
  it('thirty right answers, every one after help, none alone: not Strong, "Getting there (with help)"', () => {
    // What lms.my_progress returns for such a child (unassisted-standing.test.ts).
    const s = standingOf(alone(null, 0, 0.93))
    expect(s.word).not.toBe('Strong')
    expect(s.word).toBe('Getting there (with help)')
    expect(s.value).toBeNull()
  })

  it('strong alone is Strong, whatever help did', () => {
    expect(standingOf(alone(0.82, 4)).word).toBe('Strong')
    expect(standingOf(alone(0.82, 4, 0.95)).word).toBe('Strong')
    expect(standingOf(alone(0.82, 4)).value).toBeCloseTo(0.82)
  })

  it('high with help and low alone is "Getting there (with help)", not the figure alone', () => {
    expect(standingOf(alone(0.3, 5, 0.9)).word).toBe('Getting there (with help)')
    expect(standingOf(alone(0.55, 5, 0.9)).word).toBe('Getting there (with help)')
  })

  it('reads the figure alone, with the lines MasteryInfo names', () => {
    expect(standingOf(alone(0.55, 5)).word).toBe('Getting there')
    expect(standingOf(alone(0.55, 5, 0.6)).word).toBe('Getting there')
    expect(standingOf(alone(0.2, 5)).word).toBe('Needs practice')
    expect(standingOf(alone(0.2, 5, 0.5)).word).toBe('Needs practice')
  })

  it('under three answers alone it is "Just started", however high the figure', () => {
    expect(standingOf(alone(0.9, 2)).word).toBe('Just started')
    expect(standingOf(alone(null, 0)).word).toBe('Just started')
    expect(standingOf(alone(null, 0, 0.5)).word).toBe('Just started')
    expect(standingOf(alone(0.9, 2)).value).toBeNull()
  })
})

describe('the chapter to practise now', () => {
  const chapter = (chapter: string, over: Partial<PracticeChapter>): PracticeChapter => ({
    subjectName: 'Mathematics',
    chapter,
    questions: 5,
    answers: 0,
    mastery: null,
    unassistedMastery: null,
    unassistedObservations: 0,
    assistedPerformance: null,
    ...over,
  })

  it('is the weakest on their own: help-only counts as nothing alone, never the blend', () => {
    const helped = chapter('helped', { answers: 30, mastery: 0.88, assistedPerformance: 0.93 })
    const shaky = chapter('shaky', { answers: 6, mastery: 0.6, unassistedMastery: 0.35, unassistedObservations: 6 })
    const fresh = chapter('fresh', {})
    expect(weakestAlone([shaky, fresh, helped])?.chapter).toBe('helped')
    expect(weakestAlone([shaky, fresh])?.chapter).toBe('shaky')
    expect(weakestAlone([fresh, chapter('closed', { questions: 0 })])?.chapter).toBe('fresh')
    expect(weakestAlone([chapter('closed', { questions: 0 })])).toBeNull()
  })
})

describe('an empty list of chapters', () => {
  const waiting = { lastAnswerAt: '2026-10-08T05:00:00Z', waitingSince: '2026-10-08T05:00:00Z', updatedAt: null }

  it('while the brain has not read their answers: being checked, not "no answers"', () => {
    expect(chaptersEmptyText(waiting)).toBe('Checking your answers, back in a few minutes.')
    expect(chaptersEmptyText(waiting, 'Riya')).toBe('Checking Riya’s answers, back in a few minutes.')
  })

  it('with nothing waiting, or not known yet: how chapters come to show', () => {
    const none = { lastAnswerAt: null, waitingSince: null, updatedAt: null }
    expect(chaptersEmptyText(none)).toBe('Hand in work or practise in Learn, and your chapters show up here.')
    expect(chaptersEmptyText(undefined)).toBe('Hand in work or practise in Learn, and your chapters show up here.')
    expect(chaptersEmptyText(null, 'Riya')).toBe(
      'When Riya hands in work or practises in Learn, their chapters show up here.',
    )
  })
})
