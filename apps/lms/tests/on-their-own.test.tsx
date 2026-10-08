import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ChapterStanding } from '@ai-tutor/lms-client'
import { DELAYED_AFTER_MS, freshness, waitingText } from '@/features/analytics/freshness'
import { Heatmap, needsHelp } from '@/features/class/insights'

/**
 * The teacher's figures for a class (lam-one-brain Task 3, truth test D08,
 * D26): what each child does on their own first, with help beside it; a
 * child carried by hints is never shown as secure; and how fresh the
 * figures are, "Results delayed" once answers have waited over half an hour.
 */

const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

const row = (name: string, roll: string, over: Partial<ChapterStanding>): ChapterStanding => ({
  studentUserId: `id-${name}`,
  displayName: name,
  rollNumber: roll,
  chapter: 'rational-numbers',
  outcomesSeen: 2,
  answers: 30,
  mastery: 0.9,
  unassistedMastery: null,
  unassistedObservations: 0,
  assistedPerformance: null,
  ...over,
})

// Kabir: thirty right answers after hints, none alone (unassisted-standing.test.ts).
const kabir = row('Kabir', '3', { mastery: 0.88, assistedPerformance: 0.93 })
const riya = row('Riya', '1', { answers: 3, mastery: 0.52, unassistedMastery: 0.52, unassistedObservations: 3 })
const dev = row('Dev', '2', { answers: 6, mastery: 0.45, unassistedMastery: 0.21, unassistedObservations: 4, assistedPerformance: 0.81 })

describe('every student, every chapter', () => {
  it('shows the figure on their own first and the figure with help beside it, never the blend', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    roots.push(root)
    await act(async () => root.render(<Heatmap rows={[kabir, riya, dev]} />))
    const text = host.textContent ?? ''
    expect(text).toContain('On their own')
    expect(text).toContain('With help')
    const cell = (name: string) =>
      [...host.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(name))!.querySelectorAll('td')[1]
        .textContent
    expect(cell('Riya')).toBe('52%')
    expect(cell('Dev')).toBe('21%with help 81%')
    // Kabir's blend reads 88%; nothing alone is shown as nothing alone.
    expect(cell('Kabir')).toBe('—with help 93%')
    expect(text).not.toContain('88%')
  })
})

describe('who needs help', () => {
  it('reads the figure on their own, after enough answers alone', () => {
    const listed = needsHelp([kabir, riya, dev]).map((r) => r.displayName)
    expect(listed).toEqual(['Dev'])
  })
})

describe('how fresh the figures are', () => {
  const now = Date.parse('2026-10-08T10:00:00Z')
  const ago = (min: number) => new Date(now - min * 60_000).toISOString()

  it('says when the brain last worked them out', () => {
    expect(freshness({ updatedAt: ago(5), waitingSince: null, studentsWaiting: 0 }, now)).toEqual({
      text: 'Updated 5 minutes ago',
      delayed: false,
    })
  })

  it('says "Results delayed" once an answer has waited over half an hour', () => {
    expect(DELAYED_AFTER_MS).toBe(30 * 60_000)
    expect(freshness({ updatedAt: ago(45), waitingSince: ago(29), studentsWaiting: 1 }, now)).toEqual({
      text: 'Updated 45 minutes ago',
      delayed: false,
    })
    expect(freshness({ updatedAt: ago(45), waitingSince: ago(31), studentsWaiting: 2 }, now)).toEqual({
      text: 'Results delayed · updated 45 minutes ago',
      delayed: true,
    })
    expect(freshness({ updatedAt: null, waitingSince: ago(31), studentsWaiting: 1 }, now)).toEqual({
      text: 'Results delayed',
      delayed: true,
    })
  })

  it('says nothing when the brain has nothing of theirs', () => {
    expect(freshness({ updatedAt: null, waitingSince: null, studentsWaiting: 0 }, now)).toBeNull()
    expect(freshness(null, now)).toBeNull()
  })

  it('with no figures yet: answers are in and being worked out, not "no answers"', () => {
    expect(waitingText({ updatedAt: null, waitingSince: ago(2), studentsWaiting: 3 }, now)).toBe(
      'Answers are in from 3 students. Qrie is working them out; results show here in a few minutes.',
    )
    expect(waitingText({ updatedAt: null, waitingSince: ago(40), studentsWaiting: 1 }, now)).toBe(
      'Results delayed: answers are in from 1 student, not worked out yet.',
    )
    expect(waitingText({ updatedAt: ago(1), waitingSince: null, studentsWaiting: 0 }, now)).toBeNull()
    expect(waitingText(undefined, now)).toBeNull()
  })
})
