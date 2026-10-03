import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { FEW_ANSWERS, GETTING_THERE, MasteryInfo, STRONG } from '../src/components/mastery-info'

/**
 * The student app's "what do these mean?" beside its chapter standings: in
 * a child's words, true of how the learning model works the standing out,
 * and naming the same lines standingOf (features/progress.tsx) draws.
 */

const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

async function render(): Promise<{ host: HTMLElement; button: HTMLButtonElement }> {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<MasteryInfo />))
  const button = host.querySelector<HTMLButtonElement>('button[aria-expanded]')
  if (!button) throw new Error('there is no button to open it')
  return { host, button }
}

describe('what the chapter words mean', () => {
  it('is closed until asked, then says where the standing comes from and that it is not a mark', async () => {
    const { host, button } = await render()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).not.toContain('not a mark')
    await act(async () => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const text = host.textContent ?? ''
    expect(text).toContain('How sure Qrie is that you know each chapter.')
    expect(text).toContain('every answer you give in the app — homework, tests and practice')
    expect(text).toContain('It is not a mark: your teacher’s marks do not change it.')
  })

  it('names the lines the words are drawn at', async () => {
    const { host, button } = await render()
    await act(async () => button.click())
    const text = host.textContent ?? ''
    expect([STRONG, GETTING_THERE, FEW_ANSWERS]).toEqual([0.7, 0.4, 3])
    expect(text).toContain('Strong: 70% or more.')
    expect(text).toContain('Getting there: 40–70%.')
    expect(text).toContain('Needs practice: under 40%.')
    expect(text).toContain('Just started: only a few answers in that chapter so far.')
  })

  it('closes on Escape, on a tap outside, and on the button again', async () => {
    const { host, button } = await render()
    await act(async () => button.click())
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await act(async () => button.click())
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await act(async () => button.click())
    await act(async () => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).not.toContain('not a mark')
  })
})
