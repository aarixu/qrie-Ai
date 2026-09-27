import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { StudentSubject, TimelineRow } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

export const chapterTitle = (slug: string) => {
  const words = slug.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Words for a child, not a number: the model's belief is a guide, not a grade. */
export function standingOf(mastery: number | null, answers: number): { word: string; tone: string; bar: string } {
  if (mastery === null || answers < 3) return { word: 'Just started', tone: 'bg-muted text-muted-foreground', bar: 'bg-slate-400' }
  if (mastery >= 0.7) return { word: 'Strong', tone: 'bg-green-600/15 text-green-700', bar: 'bg-green-600' }
  if (mastery >= 0.4) return { word: 'Getting there', tone: 'bg-amber-500/15 text-amber-700', bar: 'bg-amber-500' }
  return { word: 'Needs practice', tone: 'bg-red-500/15 text-red-700', bar: 'bg-red-500' }
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`)

/**
 * The child's own progress: how much work they hand in, their marks over
 * time (a test's only once released), and, chapter by chapter, what the
 * learning model believes from every answer (lms.student_* for themselves,
 * lms.my_progress).
 */
export function ProgressPage() {
  const me = useAuthStore((s) => s.me)
  const subjects = useQuery({
    queryKey: ['my-subjects'],
    queryFn: () => api.studentSubjects(me!.userId),
    enabled: !!me,
  })
  const timeline = useQuery({
    queryKey: ['my-timeline'],
    queryFn: () => api.studentTimeline(me!.userId),
    enabled: !!me,
  })

  if (subjects.isPending) return <p className='text-muted-foreground'>Loading your progress…</p>
  if (subjects.isError) return <p className='text-destructive'>{say(subjects.error)}</p>

  const due = subjects.data.reduce((n, x) => n + x.workDue, 0)
  const handed = subjects.data.reduce((n, x) => n + x.handedIn, 0)
  const scored = subjects.data.map((x) => x.averageScore).filter((x): x is number => x !== null)
  const average = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null

  return (
    <div className='space-y-6'>
      <h1 className='text-2xl font-bold'>Your progress</h1>
      <div className='grid grid-cols-2 gap-2'>
        <Ring label='Work handed in' value={due ? handed / due : null} hint={`${handed} of ${due}`} />
        <Ring label='Average mark' value={average} hint='Marked work' />
      </div>

      {timeline.data && <Marks rows={timeline.data} />}

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

      <Chapters />
    </div>
  )
}

function Ring({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  const deg = (value ?? 0) * 360
  return (
    <div className='flex flex-col items-center rounded-2xl border bg-card p-4'>
      <div
        className='flex size-20 items-center justify-center rounded-full'
        style={{ background: `conic-gradient(var(--primary) ${deg}deg, var(--muted) 0deg)` }}
      >
        <div className='flex size-16 items-center justify-center rounded-full bg-card text-lg font-bold tabular-nums'>
          {pct(value)}
        </div>
      </div>
      <p className='mt-2 text-sm font-medium'>{label}</p>
      <p className='text-xs text-muted-foreground'>{hint}</p>
    </div>
  )
}

/** The last marks, oldest on the left, as bars a child can read at a glance. */
function Marks({ rows }: { rows: TimelineRow[] }) {
  const marked = rows
    .filter((r) => r.score !== null)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(-8)
  if (marked.length === 0) return null
  return (
    <section>
      <h2 className='mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>Your last marks</h2>
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
  const st = standingOf(s.mastery, s.chaptersSeen > 0 ? 3 : 0)
  return (
    <div className='rounded-xl border bg-card p-3'>
      <div className='flex items-baseline justify-between gap-2'>
        <p className='font-medium'>{s.subjectName}</p>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', st.tone)}>{st.word}</span>
      </div>
      {s.teacherName && <p className='text-xs text-muted-foreground'>{s.teacherName}</p>}
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

/** The child's own standing per chapter, from every answer they have given (lms.my_progress). */
function Chapters() {
  const mine = useQuery({ queryKey: ['my-progress'], queryFn: api.myProgress })
  if (mine.isPending) return null
  if (mine.isError) return <p className='text-sm text-destructive'>{say(mine.error)}</p>
  if (mine.data.length === 0) {
    return (
      <p className='rounded-xl bg-muted p-3 text-sm text-muted-foreground'>
        Hand in work or practise in Learn, and your chapters show up here.
      </p>
    )
  }

  const subjects = [...new Set(mine.data.map((c) => c.subject))]
  return (
    <section>
      <h2 className='mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>Chapter by chapter</h2>
      <div className='space-y-4'>
        {subjects.map((subject) => (
          <div key={subject} className='rounded-xl border bg-card p-3'>
            <p className='mb-2 font-medium'>{subject}</p>
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
