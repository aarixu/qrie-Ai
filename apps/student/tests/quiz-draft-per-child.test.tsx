import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * A QUIZ'S ANSWERS SO FAR, ON A SHARED PHONE. Written first.
 *
 * The answers a child has picked are kept on the phone until they hand in, so
 * a dropped connection loses nothing. Brothers, sisters and classmates share
 * phones: the next child to sign in and open the same quiz starts with nothing
 * picked, and the first child finds their own picks again.
 *
 * The real Quiz and the real student auth store run here; the school is a
 * stand-in. The tests' `@` is the teacher app's, so every `@/` module the quiz
 * reaches is pointed at the student app's own, or at a stand-in.
 */

const assignment = {
  id: 'hw-1',
  kind: 'homework',
  title: 'Fractions',
  instructions: null,
  dueAt: '2026-10-20T00:00:00Z',
  publishedAt: '2026-10-10T00:00:00Z',
}

function pointAtStudentApp() {
  vi.doMock('@/lib/backend', async () => {
    const { friendlyError } = await import('@ai-tutor/lms-client')
    return {
      api: {
        assignmentQuestions: async () => [
          { itemId: 'q1', questionPosition: 1, kind: 'mcq', stem: 'Half of 8?', options: ['2', '4', '6'] },
        ],
        mySavedAnswers: async () => [],
      },
      backend: {},
      isSignedOutError: () => false,
      say: friendlyError,
    }
  })
  vi.doMock('../src/lib/outbox', () => ({ useOutbox: () => ({ box: null }) }))
  vi.doMock('@/lib/brand', () => ({ applyBrand: () => undefined }))
  vi.doMock('@/lib/utils', () => import('../src/lib/utils'))
  vi.doMock('@/stores/auth-store', () => import('../src/stores/auth-store'))
  vi.doMock('@/components/ui/button', () => import('../src/components/ui/button'))
  vi.doMock('@/components/ui/alert-dialog', () => import('../src/components/ui/alert-dialog'))
}

const roots: Root[] = []
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

async function openQuizAs(userId: string): Promise<HTMLButtonElement[]> {
  vi.resetModules()
  pointAtStudentApp()
  const { useAuthStore } = await import('../src/stores/auth-store')
  const { Quiz } = await import('../src/features/homework/quiz')
  useAuthStore.setState({ me: { userId, kind: 'student', displayName: userId } as never })
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  roots.push(root)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Quiz a={assignment as never} onDone={() => undefined} onCancel={() => undefined} />
      </QueryClientProvider>
    )
  })
  await vi.waitFor(() => expect(el.querySelectorAll('[role="radio"]').length).toBe(3))
  return [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
}

const picked = (options: HTMLButtonElement[]) => options.findIndex((o) => o.getAttribute('aria-checked') === 'true')

describe('a quiz opened on a shared phone', () => {
  it("starts the next child with nothing picked, and gives the first child their own picks back", async () => {
    localStorage.clear()
    const riya = await openQuizAs('riya')
    await act(async () => riya[1].click())
    expect(picked(riya)).toBe(1)
    for (const root of roots.splice(0)) act(() => root.unmount())

    expect(picked(await openQuizAs('arjun'))).toBe(-1)
    for (const root of roots.splice(0)) act(() => root.unmount())

    expect(picked(await openQuizAs('riya'))).toBe(1)
  })
})
