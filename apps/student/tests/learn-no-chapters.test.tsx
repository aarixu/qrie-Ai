import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { StudentSubject } from '@ai-tutor/lms-client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * LEARN WITH NO CHAPTERS AT ALL. lms.practice_chapters lists the chapters of
 * the outcomes held for the child's class and subjects; a project with none
 * for that class (the library leaves Classes 6-9 out) returns no rows, though
 * the child has subjects and teachers. Learn then says the class's chapters
 * are not in Qrie yet, not "No subjects yet", which it keeps for a child
 * with no subjects.
 *
 * The tests' `@` is the teacher app's, so each `@/` module Learn reaches is
 * pointed at the student app's own, or at a stand-in.
 */

const fake = vi.hoisted(() => ({ subjects: 1 }))

vi.mock('@/lib/utils', () => import('../src/lib/utils'))
vi.mock('@/lib/palette', () => import('../src/lib/palette'))
vi.mock('@/components/subject-icon', () => import('../src/components/subject-icon'))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (pick: (s: { me: { userId: string; displayName: string } }) => unknown) =>
    pick({ me: { userId: 'u1', displayName: 'Riya Sharma' } }),
}))

const subjects = (): StudentSubject[] =>
  fake.subjects === 0
    ? []
    : [
        {
          subjectId: 'maths',
          subjectName: 'Mathematics',
          teacherName: 'Neha Sharma',
          workDue: 0,
          handedIn: 0,
          handinRate: null,
          averageScore: null,
          mastery: null,
          chaptersSeen: 0,
        },
      ]

vi.mock('@/lib/backend', () => {
  const known: Record<string, () => unknown> = {
    practiceChapters: () => [],
    studentSubjects: subjects,
  }
  const api = new Proxy(known, {
    get: (target, name: string) => async () => (name in target ? target[name]() : []),
  })
  return { api, say: (e: unknown) => String(e) }
})

const { Learn } = await import('../src/features/learn/index')

const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  fake.subjects = 1
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

async function show(ui: ReactNode, ready: string): Promise<string> {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>))
  for (let i = 0; i < 100 && !host.textContent?.includes(ready); i += 1) {
    await act(async () => new Promise((r) => setTimeout(r, 0)))
  }
  for (let i = 0; i < 10; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(host.textContent).toContain(ready)
  return host.textContent ?? ''
}

describe('Learn with no chapters', () => {
  it('says the class’s chapters are not in Qrie yet when the child has subjects, not that there are none', async () => {
    const text = await show(
      <Learn />,
      'Your class’s chapters are not in Qrie yet, so practice is not open. Your teachers can still set homework and tests.'
    )
    expect(text).not.toContain('No subjects yet.')
  })

  it('says there are no subjects yet when the child has none', async () => {
    fake.subjects = 0
    const text = await show(<Learn />, 'No subjects yet.')
    expect(text).not.toContain('chapters are not in Qrie yet')
  })
})
