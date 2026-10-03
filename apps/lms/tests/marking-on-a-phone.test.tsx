import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AssignmentOverview, AssignmentSummary, AttendanceRow, AttendanceTotals, ResultRow } from '@ai-tutor/lms-client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * A teacher marks on her phone. Below Tailwind's sm breakpoint (40rem) every
 * screen where she marks or reviews each child's work — a homework's
 * students, a test on paper, the gradebook, the day's attendance — is a
 * stack of cards, one per child, with nothing that scrolls sideways; from sm
 * up it is the table it always was.
 *
 * jsdom lays nothing out, so "nothing scrolls sideways" is checked as: no
 * table, and no overflow-x container, on the phone.
 */

const fake = vi.hoisted(() => ({ narrow: false, targeted: false }))

vi.mock('@tanstack/react-router', async (real) => ({
  ...(await real<typeof import('@tanstack/react-router')>()),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href='#' className={className}>
      {children}
    </a>
  ),
  useNavigate: () => () => undefined,
}))

const PAST = '2026-09-20T10:00:00.000Z'
const row = (over: Partial<ResultRow>): ResultRow => ({
  studentUserId: 'u1',
  displayName: 'Riya Sharma',
  loginId: 'DEMO-8A-1',
  rollNumber: '1',
  submitted: false,
  submissionId: null,
  attempts: 0,
  submittedAt: null,
  late: false,
  machineCorrect: null,
  machineTotal: null,
  teacherScore: null,
  teacherMax: null,
  photoSubmissionId: null,
  photoCount: 0,
  photoTeacherScore: null,
  photoTeacherMax: null,
  tasksDone: 0,
  tasksTotal: 0,
  paperScore: null,
  paperMax: null,
  teacherStatus: null,
  startedAt: null,
  ...over,
})
const summary = (over: Partial<AssignmentSummary>): AssignmentSummary => ({
  id: 'w1',
  kind: 'homework',
  title: 'Fractions quiz',
  instructions: null,
  dueAt: PAST,
  published: true,
  publishedAt: PAST,
  answerTypes: ['mcq', 'photo'],
  attemptsAllowed: 1,
  items: 5,
  submitted: 1,
  students: 2,
  opensAt: null,
  timeLimitMinutes: null,
  maxMarks: null,
  resultsReleasedAt: null,
  tasks: 0,
  targeted: false,
  ...over,
})
const overview = (over: Partial<AssignmentSummary>): AssignmentOverview => ({
  ...summary(over),
  sectionId: 's8a',
  grade: 8,
  sectionName: 'A',
  subjectId: 'maths',
  subjectName: 'Mathematics',
})

const QUIZ = overview({})
const QUIZ_ROWS = [
  row({ submitted: true, submissionId: 'sub1', attempts: 1, submittedAt: PAST, machineCorrect: 4, machineTotal: 5, photoSubmissionId: 'ph1', photoCount: 2 }),
  row({ studentUserId: 'u2', displayName: 'Arjun Mehta', loginId: 'DEMO-8A-2', rollNumber: '2' }),
]
const PAPER = overview({ id: 'w2', kind: 'test', title: 'Unit test on paper', answerTypes: ['paper'], maxMarks: 20 })
const PAPER_ROWS = [
  row({ submitted: true, paperScore: 15, paperMax: 20 }),
  row({ studentUserId: 'u2', displayName: 'Arjun Mehta', loginId: 'DEMO-8A-2', rollNumber: '2' }),
]
const SHEET: AttendanceRow[] = [
  { studentUserId: 'u1', displayName: 'Riya Sharma', rollNumber: '1', status: 'present', markedByName: null },
  { studentUserId: 'u2', displayName: 'Arjun Mehta', rollNumber: '2', status: null, markedByName: null },
]
const TOTALS: AttendanceTotals[] = [
  { studentUserId: 'u1', displayName: 'Riya Sharma', rollNumber: '1', present: 10, late: 1, absent: 1, leave: 0, rate: 11 / 12 },
  { studentUserId: 'u2', displayName: 'Arjun Mehta', rollNumber: '2', present: 6, late: 0, absent: 6, leave: 1, rate: 0.5 },
]

vi.mock('@/lib/backend', () => {
  const api = {
    workComments: async () => [{ studentUserId: 'u1', text: 'Show your working.', writtenByName: 'Neha Sharma', writtenAt: PAST }],
    accountPhotos: async () => [],
    classAssignments: async () => [
      summary({}),
      summary({ id: 'w2', title: 'Unit test on paper', answerTypes: ['paper'], maxMarks: 20 }),
      ...(fake.targeted ? [summary({ id: 'w3', title: 'Practice for some', targeted: true, students: 1, submitted: 0 })] : []),
    ],
    // The practice is set for Riya only, so only her row comes back for it.
    assignmentResults: async (id: string) => (id === 'w1' ? QUIZ_ROWS : id === 'w3' ? [row({})] : PAPER_ROWS),
    attendanceSheet: async () => SHEET,
    attendanceSummary: async () => TOTALS,
    recordPaperMark: async () => undefined,
    setWorkStatus: async () => undefined,
  }
  return { api, backend: { api, workUrl: async () => '' }, isSignedOutError: () => false }
})

const { PaperMarks, Students } = await import('@/features/homework/detail')
const { Gradebook } = await import('@/features/class')
const { Attendance } = await import('@/features/class/attendance')

const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // A phone held upright matches "below sm"; nothing else is asked here.
  window.matchMedia = ((query: string) => ({
    matches: fake.narrow && query.includes('40rem'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  fake.targeted = false
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

async function show(ui: ReactNode, narrow: boolean, ready: string): Promise<HTMLElement> {
  fake.narrow = narrow
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>))
  for (let i = 0; i < 50 && !host.textContent?.includes(ready); i += 1) {
    await act(async () => new Promise((r) => setTimeout(r, 0)))
  }
  expect(host.textContent).toContain(ready)
  return host
}

const label = (host: HTMLElement, name: string) => host.querySelector(`[aria-label="${name}"]`)
const cards = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-student]')]

function sidewaysFree(host: HTMLElement) {
  expect(host.querySelector('table')).toBeNull()
  expect(host.querySelector('.overflow-x-auto')).toBeNull()
}

describe("a homework's students, on a phone", () => {
  it('is one card per child, each with everything the table row had to mark with', async () => {
    const host = await show(<Students a={QUIZ} rows={QUIZ_ROWS} mcq photo checklist={false} />, true, 'Show your working.')
    sidewaysFree(host)
    const [riya, arjun] = cards(host)
    expect(riya.textContent).toContain('Riya Sharma')
    expect(riya.textContent).toContain('Handed in')
    expect(riya.textContent).toContain('4 / 5')
    expect(label(riya, 'Select Riya Sharma')).not.toBeNull()
    expect([...riya.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(
      expect.arrayContaining(['Add mark', '2 · mark']),
    )
    expect(label(riya, 'Comment for Riya Sharma: Show your working.')).not.toBeNull()
    expect(arjun.textContent).toContain('Missing')
    expect(label(arjun, 'Add a comment for Arjun Mehta')).not.toBeNull()
    expect(label(host, 'Select every student')).not.toBeNull()
  })

  it('is the table it always was from sm up', async () => {
    const host = await show(<Students a={QUIZ} rows={QUIZ_ROWS} mcq photo checklist={false} />, false, 'Arjun Mehta')
    expect(host.querySelector('table')).not.toBeNull()
    expect(cards(host)).toEqual([])
    expect([...host.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      '', 'Roll', 'Student', 'Status', 'Your check', 'Auto score', 'Your mark', 'Photos', 'Comment',
    ])
  })
})

describe('marks for a test on paper, on a phone', () => {
  it('is one card per child with the mark box, absent and the comment', async () => {
    const host = await show(<PaperMarks a={PAPER} rows={PAPER_ROWS} />, true, 'Show your working.')
    sidewaysFree(host)
    expect(host.textContent).toContain('Marks are out of 20.')
    expect(label(host, 'Comment for Riya Sharma: Show your working.')).not.toBeNull()
    const [riya, arjun] = cards(host)
    expect((label(riya, 'Marks for Riya Sharma') as HTMLInputElement).value).toBe('15')
    expect(label(arjun, 'Arjun Mehta was absent')).not.toBeNull()
    expect(label(arjun, 'Add a comment for Arjun Mehta')).not.toBeNull()
  })

  it('moves on to the next child’s box on Enter, on a phone and from sm up', async () => {
    for (const narrow of [true, false]) {
      const host = await show(<PaperMarks a={PAPER} rows={PAPER_ROWS} />, narrow, 'Arjun Mehta')
      const first = label(host, 'Marks for Riya Sharma') as HTMLInputElement
      first.focus()
      await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      expect(document.activeElement).toBe(label(host, 'Marks for Arjun Mehta'))
      for (const root of roots.splice(0)) act(() => root.unmount())
      document.body.innerHTML = ''
    }
  })
})

describe('the gradebook, on a phone', () => {
  it('is one card per child: every piece of work and its mark, and the average', async () => {
    const host = await show(<Gradebook sectionId='s8a' subjectId='maths' />, true, 'Arjun Mehta')
    sidewaysFree(host)
    const [riya, arjun] = cards(host)
    expect(riya.textContent).toContain('Fractions quiz')
    expect(riya.textContent).toContain('80%')
    expect(riya.textContent).toContain('Unit test on paper')
    expect(riya.textContent).toContain('75%')
    expect(riya.textContent).toContain('Average 78%')
    expect(arjun.textContent).toContain('Missing')
    expect(arjun.textContent).toContain('Average —')
  })

  it('says "Not set", not "Missing", for practice set for other children only — on a phone and from sm up', async () => {
    fake.targeted = true
    for (const narrow of [true, false]) {
      const host = await show(<Gradebook sectionId='s8a' subjectId='maths' />, narrow, 'Practice for some')
      const cell = (name: string) =>
        narrow
          ? cards(host).find((c) => c.textContent?.includes(name))!.querySelectorAll('dd')[2].textContent
          : [...host.querySelectorAll('tr')].find((r) => r.textContent?.includes(name))!.querySelectorAll('td')[3].textContent
      expect(cell('Riya Sharma')).toBe('Missing')
      expect(cell('Arjun Mehta')).toBe('Not set')
      for (const root of roots.splice(0)) act(() => root.unmount())
      document.body.innerHTML = ''
    }
  })

  it('is the table it always was from sm up', async () => {
    const host = await show(<Gradebook sectionId='s8a' subjectId='maths' />, false, 'Arjun Mehta')
    expect([...host.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      'Student', 'Fractions quiz', 'Unit test on paper', 'Average',
    ])
    expect(cards(host)).toEqual([])
  })
})

describe("the day's attendance, on a phone", () => {
  it('marks each child on their own card, and shows the month as cards too', async () => {
    const host = await show(<Attendance sectionId='s8a' />, true, 'This month')
    for (let i = 0; i < 50 && !host.textContent?.includes('50%'); i += 1) {
      await act(async () => new Promise((r) => setTimeout(r, 0)))
    }
    sidewaysFree(host)
    const groups = [...host.querySelectorAll('[role="radiogroup"]')]
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(["Riya Sharma's attendance", "Arjun Mehta's attendance"])
    for (const g of groups) expect(g.querySelectorAll('[role="radio"]')).toHaveLength(4)
    expect(host.textContent).toContain('92%')
    expect(host.textContent).toContain('50%')
  })

  it('shows the month as the table it always was from sm up', async () => {
    const host = await show(<Attendance sectionId='s8a' />, false, 'This month')
    for (let i = 0; i < 50 && !host.querySelector('table'); i += 1) {
      await act(async () => new Promise((r) => setTimeout(r, 0)))
    }
    expect([...host.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      'Roll', 'Student', 'Present', 'Absent', 'Late', 'On leave', 'Rate',
    ])
  })
})
