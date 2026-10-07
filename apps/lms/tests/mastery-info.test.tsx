import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { band } from '@/features/analytics/charts'
import { MasteryInfo } from '@/features/analytics/mastery-info'

/**
 * "What is mastery?" beside every Mastery figure in the teacher app and the
 * school portal. What it says has to be true of how the brain works the
 * figure out (packages/lms-brain folds only the answers in the ledger), and
 * of the bands the figures are coloured by (band in charts.tsx).
 */

const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // Radix measures the popover's anchor; jsdom has nothing to measure with.
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

async function open(): Promise<string> {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<MasteryInfo />))
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="What is mastery?"]')
  if (!button) throw new Error('there is no "What is mastery?" button')
  expect(document.body.textContent).not.toContain('not a mark')
  await act(async () => button.click())
  return document.body.textContent ?? ''
}

describe('what is mastery', () => {
  it('opens a few plain sentences: the learning model’s estimate from every answer, not a mark', async () => {
    const text = await open()
    expect(text).toContain('What is mastery?')
    expect(text).toMatch(/Qrie’s learning model’s estimate of how well a student knows each topic/)
    expect(text).toMatch(/every answer they give in the app — homework, tests and practice/)
    expect(text).toContain('It is not a mark.')
    // Ticks, paper marks and a teacher's own mark never reach the ledger
    // (tools/lms-demo/src/seed.ts step 7; lms.set_teacher_mark writes none).
    expect(text).toContain('Marks teachers give, tests on paper, photos of notebook work and ticked tasks do not change it.')
  })

  it('names the same bands every Mastery figure is coloured by', async () => {
    const text = await open()
    const secure = Number(/Secure is (\d+)% or more/.exec(text)?.[1])
    const help = Number(/Needs help under (\d+)%/.exec(text)?.[1])
    const there = /Getting there (\d+)–(\d+)%/.exec(text)
    expect([Number(there?.[1]), Number(there?.[2])]).toEqual([help, secure])
    expect(band(secure / 100).label).toBe('Secure')
    expect(band((secure - 1) / 100).label).toBe('Getting there')
    expect(band(help / 100).label).toBe('Getting there')
    expect(band((help - 1) / 100).label).toBe('Needs help')
  })
})
