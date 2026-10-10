import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { MessageSquareQuote } from 'lucide-react'
import type { StudentSubject, TimelineRow } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
// Relative: the tests' `@` is the teacher app's, which has no such file.
import { FEW_ANSWERS, GETTING_THERE, MasteryInfo, STRONG } from '../components/mastery-info'
import { SubjectBadge } from '@/components/subject-icon'
import { MyReportCard } from './report-card'

export const chapterTitle = (slug: string) => {
  const words = slug.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

type Standing = { word: string; tone: string; bar: string }

/**
 * Words for a child, not a number: the model's belief is a guide, not a grade. MasteryInfo says what they mean.
 * None without a belief: the model has not read any answers of theirs there yet, and "Just started" would say
 * there were a few.
 */
export function standingOf(mastery: number, answers: number): Standing
export function standingOf(mastery: number | null, answers: number): Standing | null
export function standingOf(mastery: number | null, answers: number): Standing | null {
  if (mastery === null) return null
  if (answers < FEW_ANSWERS) return { word: 'Just started', tone: 'bg-muted text-muted-foreground', bar: 'bg-slate-400' }
  if (mastery >= STRONG) return { word: 'Strong', tone: 'bg-green-600/15 text-green-700', bar: 'bg-green-600' }
  if (mastery >= GETTING_THERE) return { word: 'Getting there', tone: 'bg-amber-500/15 text-amber-700', bar: 'bg-amber-500' }
  return { word: 'Needs practice', tone: 'bg-red-500/15 text-red-700', bar: 'bg-red-500' }
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`)

/** One child, as a parent sees them (lms.my_children, 0045). */
export type ChildShown = { userId: string; displayName: string }

/**
 * A child's progress: how much work they hand in, their teacher's remark for
 * the year, their marks over time (a test's only once released), and,
 * chapter by chapter, what the learning model believes from every answer
 * (lms.student_* and lms.report_remark). The child's own, or — with `child` —
 * one of a parent's children, read-only, with the year's attendance.
 */
export function ProgressPage({ child }: { child?: ChildShown } = {}) {
  const me = useAuthStore((s) => s.me)
  const studentId = child?.userId ?? me?.userId
  const subjects = useQuery({
    queryKey: ['my-subjects', studentId],
    queryFn: () => api.studentSubjects(studentId!),
    enabled: !!studentId,
  })
  const remark = useQuery({
    queryKey: ['my-remark', studentId],
    queryFn: () => api.reportRemark(studentId!),
    enabled: !!studentId,
  })
  // The child's own last 30 days; a parent, the year so far (lms.student_attendance).
  const attendance = useQuery({
    queryKey: ['my-attendance', studentId],
    queryFn: async () => {
      if (!child) {
        const r = await api.myAttendance(30)
        return { rate: r.rate, hint: r.days.length ? 'Last 30 days' : 'Not marked yet' }
      }
      const r = await api.studentAttendance(child.userId)
      return { rate: r.rate, hint: r.marked ? 'This year' : 'Not marked yet' }
    },
    enabled: !!studentId,
  })
  const timeline = useQuery({
    queryKey: ['my-timeline', studentId],
    queryFn: () => api.studentTimeline(studentId!),
    enabled: !!studentId,
  })

  if (subjects.isPending) return <p className='text-muted-foreground'>Loading the progress…</p>
  if (subjects.isError) return <p className='text-destructive'>{say(subjects.error)}</p>

  const due = subjects.data.reduce((n, x) => n + x.workDue, 0)
  const handed = subjects.data.reduce((n, x) => n + x.handedIn, 0)
  const scored = subjects.data.map((x) => x.averageScore).filter((x): x is number => x !== null)
  const average = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null

  return (
    <div className='space-y-6'>
      <h1 className='text-2xl font-bold'>{child ? `${child.displayName}’s progress` : 'Your progress'}</h1>
      <MyReportCard studentId={child?.userId} />
      <div className='grid grid-cols-3 gap-2'>
        <Ring label='Handed in' value={due ? handed / due : null} hint={`${handed} of ${due}`} colour='#059669' />
        <Ring label='Average mark' value={average} hint='Marked work' colour='#2563eb' />
        <Ring
          label='Attendance'
          value={attendance.data?.rate ?? null}
          hint={attendance.data?.hint ?? 'Not marked yet'}
          colour='#0284c7'
        />
      </div>

      {remark.data?.text && (
        <section className='space-y-1 rounded-2xl border border-primary/40 bg-primary/5 p-4'>
          <h2 className='flex items-center gap-2 text-sm font-semibold'>
            <MessageSquareQuote className='size-4' /> {child ? 'The teacher’s remark' : 'Your teacher’s remark'}
          </h2>
          <p className='text-sm whitespace-pre-wrap'>{remark.data.text}</p>
          {remark.data.writtenByName && <p className='text-xs text-muted-foreground'>{remark.data.writtenByName}</p>}
        </section>
      )}

      {timeline.data && <Marks rows={timeline.data} title={child ? 'Last marks' : 'Your last marks'} />}

      <section>
        <h2 className='mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>Subjects</h2>
        <ul className='space-y-2'>
          {subjects.data.map((x) => (
            <li key={x.subjectId}>
              <SubjectCard s={x} />
            </li>
          ))}
        </ul>
      </section>

      <Chapters child={child} />
    </div>
  )
}

function Ring({ label, value, hint, colour }: { label: string; value: number | null; hint: string; colour: string }) {
  const deg = (value ?? 0) * 360
  return (
    <div className='flex flex-col items-center rounded-2xl border bg-card px-2 py-3'>
      <div
        className='flex size-[72px] items-center justify-center rounded-full'
        style={{ background: `conic-gradient(${colour} ${deg}deg, var(--muted) 0deg)` }}
      >
        <div className='flex size-[58px] items-center justify-center rounded-full bg-card text-base font-bold tabular-nums'>
          {pct(value)}
        </div>
      </div>
      <p className='mt-2 text-center text-xs font-medium'>{label}</p>
      <p className='text-xs text-muted-foreground'>{hint}</p>
    </div>
  )
}

/** The last marks, oldest on the left, as bars a child can read at a glance. */
function Marks({ rows, title }: { rows: TimelineRow[]; title: string }) {
  const marked = rows
    .filter((r) => r.score !== null)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(-8)
  if (marked.length === 0) return null
  return (
    <section>
      <h2 className='mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>{title}</h2>
      <div className='rounded-2xl border bg-card p-3'>
        <div className='flex h-36 items-end gap-2'>
          {marked.map((r) => {
            const v = Math.round(r.score! * 100)
            return (
              <div key={r.assignmentId} className='flex h-full flex-1 flex-col items-center justify-end gap-1' title={r.title}>
                <span className='text-[10px] font-medium tabular-nums'>{v}%</span>
                <div
                  className={cn('w-full rounded-t-md', v >= 70 ? 'bg-green-600' : v >= 40 ? 'bg-amber-500' : 'bg-red-500')}
                  style={{ height: `${Math.max(4, v)}%` }}
                />
              </div>
            )
          })}
        </div>
        <div className='mt-1 flex gap-2'>
          {marked.map((r) => (
            <span key={r.assignmentId} className='flex-1 truncate text-center text-[10px] text-muted-foreground'>
              {format(new Date(r.dueAt), 'd MMM')}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function SubjectCard({ s }: { s: StudentSubject }) {
  const st = standingOf(s.mastery, s.chaptersSeen > 0 ? FEW_ANSWERS : 0)
  return (
    <div className='rounded-2xl border bg-card p-3'>
      <div className='flex items-center gap-3'>
        <SubjectBadge subject={s.subjectName} className='size-10 rounded-xl' />
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>{s.subjectName}</p>
          {s.teacherName && <p className='text-xs text-muted-foreground'>{s.teacherName}</p>}
        </div>
        {st && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', st.tone)}>{st.word}</span>}
      </div>
      <div className='mt-2 grid grid-cols-2 gap-3 text-xs'>
        <div>
          <div className='flex justify-between text-muted-foreground'>
            <span>Handed in</span>
            <span className='tabular-nums'>
              {s.handedIn}/{s.workDue}
            </span>
          </div>
          <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-muted'>
            <div className='h-full rounded-full bg-primary' style={{ width: `${(s.handinRate ?? 0) * 100}%` }} />
          </div>
        </div>
        <div>
          <div className='flex justify-between text-muted-foreground'>
            <span>Average mark</span>
            <span className='tabular-nums'>{pct(s.averageScore)}</span>
          </div>
          <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-muted'>
            <div className='h-full rounded-full bg-primary' style={{ width: `${(s.averageScore ?? 0) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The child's standing per chapter, from every answer they have given: their
 * own (lms.my_progress), or a parent's child's (lms.student_chapters).
 */
function Chapters({ child }: { child?: ChildShown }) {
  const mine = useQuery({
    queryKey: ['my-progress', child?.userId],
    queryFn: () => (child ? api.studentChapters(child.userId) : api.myProgress()),
  })
  if (mine.isPending) return null
  if (mine.isError) return <p className='text-sm text-destructive'>{say(mine.error)}</p>
  if (mine.data.length === 0) {
    return (
      <p className='rounded-xl bg-muted p-3 text-sm text-muted-foreground'>
        {child
          ? `${child.displayName}’s chapters show up here once Qrie has worked through their answers in the app.`
          : 'Your chapters show up here once Qrie has worked through your answers in the app.'}
      </p>
    )
  }

  const subjects = [...new Set(mine.data.map((c) => c.subject))]
  return (
    <section>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <h2 className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>Chapter by chapter</h2>
        <MasteryInfo />
      </div>
      <div className='space-y-4'>
        {subjects.map((subject) => (
          <div key={subject} className='rounded-xl border bg-card p-3'>
            <p className='mb-2 flex items-center gap-2 font-medium'>
              <SubjectBadge subject={subject} className='size-7 rounded-lg' />
              {subject}
            </p>
            <ul className='space-y-2.5'>
              {mine.data
                .filter((c) => c.subject === subject)
                .map((c) => {
                  const s = standingOf(c.mastery, c.answers)
                  return (
                    <li key={c.chapter} className='text-sm'>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='min-w-0 truncate'>{chapterTitle(c.chapter)}</span>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', s.tone)}>{s.word}</span>
                      </div>
                      <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-muted'>
                        <div className={cn('h-full rounded-full', s.bar)} style={{ width: `${Math.max(4, Math.round(c.mastery * 100))}%` }} />
                      </div>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
