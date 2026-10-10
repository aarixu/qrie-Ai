import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PracticeChapter, StudentChapter, StudentSubject } from '@ai-tutor/lms-client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * THE STUDENT AND PARENT APP, WITH NO MASTERY AT ALL. Where nothing has
 * folded a child's answers into the learning model yet, their chapters come
 * back empty and every subject's and chapter's mastery is null. The app then
 * says the chapters show up once Qrie has worked through the answers, and
 * puts no word on a subject or chapter — not "Just started", which says
 * there have been only a few answers. A real low standing keeps its word.
 *
 * The tests' `@` is the teacher app's, so each `@/` module these screens
 * reach is pointed at the student app's own, or at a stand-in.
 */

const fake = vi.hoisted(() => ({ mode: 'none' as 'none' | 'low' }))

vi.mock('@tanstack/react-router', async (real) => ({
  ...(await real<typeof import('@tanstack/react-router')>()),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href='#' className={className}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/utils', () => import('../src/lib/utils'))
vi.mock('@/lib/palette', () => import('../src/lib/palette'))
vi.mock('@/components/subject-icon', () => import('../src/components/subject-icon'))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (pick: (s: { me: { userId: string; displayName: string } }) => unknown) =>
    pick({ me: { userId: 'u1', displayName: 'Riya Sharma' } }),
}))
// The report card's buttons are not what is checked here.
vi.mock('../src/features/report-card', () => ({ MyReportCard: () => null }))

const subjects = (): StudentSubject[] => [
  {
    subjectId: 'maths',
    subjectName: 'Mathematics',
    teacherName: 'Neha Sharma',
    workDue: 3,
    handedIn: 3,
    handinRate: 1,
    averageScore: 0.6,
    mastery: fake.mode === 'none' ? null : 0.1,
    chaptersSeen: fake.mode === 'none' ? 0 : 1,
  },
]
const chapters = (): StudentChapter[] =>
  fake.mode === 'none' ? [] : [{ subject: 'Mathematics', chapter: 'rational-numbers', outcomesSeen: 3, answers: 6, mastery: 0.1 }]
const practice = (): PracticeChapter[] => [
  {
    subjectName: 'Mathematics',
    chapter: 'rational-numbers',
    questions: 12,
    answers: fake.mode === 'none' ? 0 : 6,
    mastery: fake.mode === 'none' ? null : 0.1,
  },
]

vi.mock('@/lib/backend', () => {
  const known: Record<string, () => unknown> = {
    studentSubjects: subjects,
    studentChapters: chapters,
    myProgress: chapters,
    practiceChapters: practice,
    reportRemark: () => ({ text: null, writtenByName: null, writtenAt: null, canEdit: false }),
    myAttendance: () => ({ rate: null, days: [] }),
    studentAttendance: () => ({ marked: 0, rate: null }),
  }
  const api = new Proxy(known, {
    get: (target, name: string) => async () => (name in target ? target[name]() : []),
  })
  return { api, say: (e: unknown) => String(e) }
})

const { ProgressPage, standingOf } = await import('../src/features/progress')
const { Learn } = await import('../src/features/learn/index')

const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  fake.mode = 'none'
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

describe('the word for a standing', () => {
  it('is none without a mastery, and the band’s word for a real one, however low', () => {
    expect(standingOf(null, 0)).toBeNull()
    expect(standingOf(null, 12)).toBeNull()
    expect(standingOf(0, 6)?.word).toBe('Needs practice')
    expect(standingOf(0.9, 1)?.word).toBe('Just started')
  })
})

describe("a child's own progress", () => {
  it('says the chapters show up once Qrie has worked through their answers, and puts no word on the subject', async () => {
    const text = await show(<ProgressPage />, 'Your chapters show up here once Qrie has worked through your answers in the app.')
    expect(text).toContain('Mathematics')
    expect(text).not.toContain('Just started')
    expect(text).not.toContain('Needs practice')
  })

  it('shows a real low standing as it is', async () => {
    fake.mode = 'low'
    const text = await show(<ProgressPage />, 'Chapter by chapter')
    expect(text.split('Needs practice').length).toBe(3)
    expect(text).not.toContain('once Qrie has worked through')
  })
})

describe("a parent's view of a child", () => {
  it('says the child’s chapters show up once Qrie has worked through their answers', async () => {
    const text = await show(
      <ProgressPage child={{ userId: 'u1', displayName: 'Riya Sharma' }} />,
      'Riya Sharma’s chapters show up here once Qrie has worked through their answers in the app.'
    )
    expect(text).not.toContain('Just started')
  })
})

describe('Learn', () => {
  it('lists an open chapter with no word on it while it has no mastery', async () => {
    const text = await show(<Learn />, '12 questions')
    expect(text).not.toContain('Just started')
    expect(text).not.toMatch(/·\s*12 questions/)
  })

  it('gives an open chapter with a real low standing its word', async () => {
    fake.mode = 'low'
    await show(<Learn />, 'Needs practice · 12 questions')
  })
})
