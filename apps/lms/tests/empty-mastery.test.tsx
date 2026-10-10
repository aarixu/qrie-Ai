import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  ChapterStanding,
  LikelyMisconception,
  SchoolClass,
  SchoolOverview,
  SchoolStudent,
  StudentChapter,
  StudentSubject,
  TrendPoint,
} from '@ai-tutor/lms-client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * EVERY MASTERY SURFACE, WITH NO MASTERY AT ALL. On a project where nothing
 * has folded any answers into the learning model yet, there are no rows of
 * belief: the class insights and a student's chapters come back empty, and
 * every mastery figure is null. Each surface then says so — "No mastery
 * yet" — instead of "No answers yet" (answers there may be), a 0 or a
 * "Needs help". A REAL low mastery, 0% included, is shown as it is.
 */

const fake = vi.hoisted(() => ({ mode: 'none' as 'none' | 'low' }))

vi.mock('@tanstack/react-router', async (real) => ({
  ...(await real<typeof import('@tanstack/react-router')>()),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href='#' className={className}>
      {children}
    </a>
  ),
  useNavigate: () => () => undefined,
}))

// The header bar's search and menus need the whole app around them; the page's own content is what is checked.
vi.mock('@/components/layout/page', async (real) => ({
  ...(await real<typeof import('@/components/layout/page')>()),
  Page: ({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {description && <div>{description}</div>}
      {children}
    </main>
  ),
}))

const PAST = '2026-09-20T10:00:00.000Z'
const riya = { studentUserId: 'u1', displayName: 'Riya Sharma', rollNumber: '1' }

const standing = (): ChapterStanding[] =>
  fake.mode === 'none'
    ? []
    : [{ ...riya, chapter: 'rational-numbers', outcomesSeen: 3, answers: 5, mastery: 0.1, unassistedMastery: 0.1 }]
const likely: LikelyMisconception[] = [
  { chapter: 'rational-numbers', label: 'adds the denominators', students: 1, children: [riya], questions: 4 },
]
const trend: TrendPoint[] = [
  { assignmentId: 'w1', title: 'Fractions quiz', kind: 'homework', dueAt: PAST, students: 2, handedIn: 2, late: 0, averageScore: 0.6 },
]
const overview = (): SchoolOverview => ({
  schoolName: 'Demo School',
  students: 2,
  teachers: 1,
  classes: 1,
  subjects: 1,
  workSet30d: 3,
  handinRate30d: 0.9,
  averageScore30d: 0.6,
  activeStudents7d: 2,
  mastery: fake.mode === 'none' ? null : 0.1,
})
const schoolClass = (): SchoolClass => ({
  sectionId: 's8a',
  subjectId: 'maths',
  className: '8A',
  grade: 8,
  subjectName: 'Mathematics',
  teacherName: 'Neha Sharma',
  teacherLoginId: 'DEMO-T01',
  students: 2,
  workSet: 3,
  handinRate: 0.9,
  averageScore: 0.6,
  mastery: fake.mode === 'none' ? null : 0,
})
const student = (over: Partial<SchoolStudent>): SchoolStudent => ({
  userId: 'u1',
  displayName: 'Riya Sharma',
  loginId: 'DEMO-8A-1',
  sectionId: 's8a',
  className: '8A',
  rollNumber: '1',
  workDue: 3,
  handinRate: 1,
  averageScore: 0.6,
  mastery: null,
  lastActive: PAST,
  ...over,
})
const students = (): SchoolStudent[] => [
  student({ mastery: fake.mode === 'none' ? null : 0.2 }),
  student({ userId: 'u2', displayName: 'Arjun Mehta', loginId: 'DEMO-8A-2', rollNumber: '2' }),
]
const subjects = (): StudentSubject[] => [
  {
    subjectId: 'maths',
    subjectName: 'Mathematics',
    teacherName: 'Neha Sharma',
    workDue: 3,
    handedIn: 3,
    handinRate: 1,
    averageScore: 0.6,
    mastery: fake.mode === 'none' ? null : 0.05,
    chaptersSeen: fake.mode === 'none' ? 0 : 1,
  },
]
const chapters = (): StudentChapter[] =>
  fake.mode === 'none' ? [] : [{ subject: 'Mathematics', chapter: 'rational-numbers', outcomesSeen: 3, answers: 5, mastery: 0.05 }]

vi.mock('@/lib/backend', () => {
  const known: Record<string, (...args: unknown[]) => unknown> = {
    classInsights: standing,
    classMisconceptions: () => [],
    classLikelyMisconceptions: () => likely,
    classTrend: () => trend,
    schoolOverview: overview,
    schoolClasses: () => [schoolClass()],
    schoolStudents: students,
    schoolLicence: () => ({ plan: null, seats: null, seatsUsed: 0, validUntil: null, daysLeft: null }),
    schoolLogo: () => null,
    studentCard: () => ({
      userId: 'u1',
      displayName: 'Riya Sharma',
      loginId: 'DEMO-8A-1',
      rollNumber: '1',
      sectionId: 's8a',
      grade: 8,
      className: '8A',
      schoolName: 'Demo School',
    }),
    studentSubjects: subjects,
    studentChapters: chapters,
    studentAttendance: () => ({ marked: 0, rate: null }),
    reportRemark: () => ({ text: null, writtenByName: null, writtenAt: null, canEdit: false }),
  }
  // Anything else a screen asks for (photos, events, attendance today, leavers) is an empty list.
  const api = new Proxy(known, {
    get: (target, name: string) => async (...args: unknown[]) => (name in target ? target[name](...args) : []),
  })
  return { api, backend: { api }, isSignedOutError: () => false }
})

const { band, NO_MASTERY } = await import('@/features/analytics/charts')
const { Insights } = await import('@/features/class/insights')
const { ClassAnalytics } = await import('@/features/class/analytics')
const { SchoolOverviewPage } = await import('@/features/school/overview')
const { SchoolClassesPage } = await import('@/features/school/classes')
const { SchoolStudentsPage } = await import('@/features/school/students')
const { StudentReport } = await import('@/features/students/report')

const CLASS_EMPTY = 'No mastery yet. It appears once Qrie has worked through this class’s answers in the app.'
const SCHOOL_EMPTY = 'No mastery yet. It appears once Qrie has worked through the school’s answers in the app.'
const STUDENT_EMPTY = 'No mastery yet. It appears once Qrie has worked through this student’s answers in the app.'

const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  fake.mode = 'none'
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

/** Renders `ui` and waits until `ready` is on the screen. */
async function show(ui: ReactNode, ready: string): Promise<string> {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>))
  for (let i = 0; i < 100 && !host.textContent?.includes(ready); i += 1) {
    await act(async () => new Promise((r) => setTimeout(r, 0)))
  }
  // Whatever else is still on its way lands too.
  for (let i = 0; i < 10; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(host.textContent).toContain(ready)
  return host.textContent ?? ''
}

describe('the words for no mastery', () => {
  it('names a null mastery "No mastery yet", and a real 0 by its band', () => {
    expect(NO_MASTERY).toBe('No mastery yet')
    expect(band(null).label).toBe('No mastery yet')
    expect(band(undefined).label).toBe('No mastery yet')
    expect(band(0).label).toBe('Needs help')
  })
})

describe("a class's insights", () => {
  it('says there is no mastery yet, and still shows the misconceptions the answers themselves point to', async () => {
    const text = await show(<Insights sectionId='s8a' subjectId='maths' />, CLASS_EMPTY)
    expect(text).toContain('Likely misconceptions in this class')
    expect(text).toContain('Adds the denominators')
    expect(text).not.toContain('No answers yet')
    expect(text).not.toContain('Who needs help')
  })

  it('shows a real low standing as it is', async () => {
    fake.mode = 'low'
    const text = await show(<Insights sectionId='s8a' subjectId='maths' />, 'Who needs help, on what')
    expect(text).toContain('Riya Sharma')
    expect(text).toContain('10%')
    expect(text).not.toContain(NO_MASTERY)
  })
})

describe("a class's analytics", () => {
  it('says there is no mastery yet beside the real work-by-work figures', async () => {
    const text = await show(<ClassAnalytics sectionId='s8a' subjectId='maths' />, CLASS_EMPTY)
    expect(text).toContain('Work by work')
    expect(text).not.toContain('No answers yet')
  })

  it('has no empty state when the class has a standing, however low', async () => {
    fake.mode = 'low'
    const text = await show(<ClassAnalytics sectionId='s8a' subjectId='maths' />, 'Chapter by chapter')
    expect(text).not.toContain(NO_MASTERY)
  })
})

describe("the school portal's overview", () => {
  it('says there is no mastery yet, in the Mastery figure and in place of where students stand', async () => {
    const text = await show(<SchoolOverviewPage />, 'Where students stand')
    expect(text.split(SCHOOL_EMPTY)).toHaveLength(3)
    expect(text).not.toContain('No answers yet')
    expect(text).not.toMatch(/Needs help\s*\d/)
  })

  it('shows a real low mastery as it is, and counts a student with none apart', async () => {
    fake.mode = 'low'
    const text = await show(<SchoolOverviewPage />, 'Needs help — from every answer')
    expect(text).toContain('10%')
    expect(text).toMatch(/Needs help\s*1/)
    expect(text).toMatch(/No mastery yet\s*1/)
    expect(text).not.toContain(SCHOOL_EMPTY)
  })
})

describe("the school portal's classes", () => {
  it('says there is no mastery yet, for the page and for each class', async () => {
    const text = await show(<SchoolClassesPage />, SCHOOL_EMPTY)
    expect(text).toContain('Neha Sharma')
    expect(text).toContain(NO_MASTERY)
    expect(text).not.toContain('No answers yet')
  })

  it('shows a real 0% as 0%, Needs help', async () => {
    fake.mode = 'low'
    const text = await show(<SchoolClassesPage />, '0% · Needs help')
    expect(text).not.toContain(SCHOOL_EMPTY)
  })
})

describe("the school portal's students", () => {
  it('says there is no mastery yet, for the page and on each card', async () => {
    const text = await show(<SchoolStudentsPage />, SCHOOL_EMPTY)
    expect(text).toContain('Arjun Mehta')
    expect(text.split(NO_MASTERY).length).toBeGreaterThan(3)
    expect(text).not.toContain('No answers yet')
  })

  it('shows a real low mastery as it is', async () => {
    fake.mode = 'low'
    const text = await show(<SchoolStudentsPage />, 'Needs help')
    expect(text).toContain('20%')
    expect(text).not.toContain(SCHOOL_EMPTY)
  })
})

describe("a student's report", () => {
  it('says there is no mastery yet, in the Mastery figure, the subjects and the chapters', async () => {
    const text = await show(<StudentReport studentId='u1' />, STUDENT_EMPTY)
    expect(text).toContain('Mathematics')
    // Chapters are counted from the model's beliefs: with none, not "0".
    expect(text).toContain('Chapters practised—No mastery yet')
    expect(text).not.toContain('No answers yet')
    expect(text).not.toContain('Needs help')
  })

  it('shows a real low mastery as it is', async () => {
    fake.mode = 'low'
    const text = await show(<StudentReport studentId='u1' />, '5% · Needs help')
    expect(text).not.toContain(STUDENT_EMPTY)
    expect(text).toContain('Chapters practised1With answers the model has read')
  })
})
