import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { CalendarDays, Camera, CheckCircle2, ChevronRight, ClipboardCheck, ClipboardList, ListChecks, NotebookPen, Sparkles, TrendingUp } from 'lucide-react'
import type { MyAssignment, UpcomingEvent } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/stores/auth-store'
import { PersonAvatar } from '@/components/person-avatar'
import { subjectHue } from '@/lib/palette'
import { usePhoto } from '@/lib/photos'
import { chapterTitle } from './progress'

export function kindLabel(a: Pick<MyAssignment, 'kind'>): string {
  return a.kind === 'test' ? 'Test' : a.kind === 'assignment' ? 'Assignment' : 'Homework'
}

/**
 * Where one piece of work stands for this student. 'none' is work with
 * nothing to do in the app — a test on paper — until its marks arrive.
 */
export function standing(a: MyAssignment): 'todo' | 'overdue' | 'done' | 'none' {
  const onlyPaper = a.answerTypes.every((t) => t === 'paper')
  if (onlyPaper) return a.resultsReleased && a.teacherScore !== null ? 'done' : 'none'
  const mcqDone = !a.answerTypes.includes('mcq') || a.mcqAttemptsUsed > 0
  const photoDone = !a.answerTypes.includes('photo') || a.photoSubmitted
  const tasksDone = !a.answerTypes.includes('checklist') || (a.tasksTotal > 0 && a.tasksDone === a.tasksTotal)
  if (mcqDone && photoDone && tasksDone) return 'done'
  return new Date(a.dueAt) < new Date() ? 'overdue' : 'todo'
}

/** The mark to show: the teacher's where given, else the best try — once the student may see it. */
export function scoreText(a: MyAssignment): string | null {
  if (!a.resultsReleased) return null
  if (a.teacherScore !== null && a.teacherMax) return `${a.teacherScore} / ${a.teacherMax}`
  if (a.bestTotal) return `${a.bestCorrect} / ${a.bestTotal}`
  return null
}

export function Home() {
  const me = useAuthStore((st) => st.me)
  const mine = useQuery({ queryKey: ['my-assignments'], queryFn: api.myAssignments })
  const subjects = useQuery({
    queryKey: ['my-subjects'],
    queryFn: () => api.studentSubjects(me!.userId),
    enabled: !!me,
  })

  if (mine.isPending) return <p className='text-muted-foreground'>Loading your work…</p>
  if (mine.isError) return <p className='text-destructive'>{say(mine.error)}</p>

  const todo = mine.data
    .filter((a) => standing(a) === 'todo')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  const overdue = mine.data.filter((a) => standing(a) === 'overdue')
  const weekAgo = Date.now() - 7 * 86_400_000
  const doneThisWeek = mine.data.filter((a) => standing(a) === 'done' && new Date(a.dueAt).getTime() > weekAgo).length
  const due = (subjects.data ?? []).reduce((n, x) => n + x.workDue, 0)
  const handed = (subjects.data ?? []).reduce((n, x) => n + x.handedIn, 0)
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const first = me?.displayName.split(' ')[0] ?? ''
  const left = todo.length + overdue.length

  return (
    <div className='space-y-6'>
      <section className='relative overflow-hidden rounded-3xl bg-primary p-5 text-primary-foreground shadow-sm'>
        <span className='pointer-events-none absolute -top-16 -right-14 size-32 rounded-full bg-brand-accent opacity-70' aria-hidden />
        <span className='pointer-events-none absolute -bottom-16 -left-10 size-32 rounded-full bg-brand-accent opacity-20' aria-hidden />
        <div className='relative flex items-center gap-4'>
          {me && <MyFace userId={me.userId} name={me.displayName} />}
          <div className='min-w-0'>
            <p className='text-xs opacity-85'>{format(new Date(), 'EEEE, d MMMM')}</p>
            <h1 className='text-xl leading-tight font-bold'>
              {hello}, {first}
            </h1>
            <p className='text-sm opacity-90'>
              {left === 0 ? 'You are all caught up. Well done!' : `You have ${left} ${left === 1 ? 'thing' : 'things'} to do.`}
            </p>
          </div>
        </div>
      </section>

      <div className='grid grid-cols-3 gap-2'>
        <Stat label='To do' value={left} colour={overdue.length > 0 ? '#ea580c' : '#2563eb'} icon={ClipboardList} to='/work' />
        <Stat label='Done this week' value={doneThisWeek} colour='#059669' icon={CheckCircle2} to='/work' />
        <Stat label='Handed in' value={due ? `${Math.round((handed / due) * 100)}%` : '—'} colour='#7c3aed' icon={TrendingUp} to='/progress' />
      </div>

      <section>
        <div className='mb-2 flex items-baseline justify-between'>
          <h2 className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>Up next</h2>
          <Link to='/work' className='text-sm font-medium text-primary'>
            All work
          </Link>
        </div>
        {overdue.length + todo.length === 0 ? (
          <p className='rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground'>
            Nothing to do right now. Well done!
          </p>
        ) : (
          <ul className='space-y-2'>
            {[...overdue, ...todo].slice(0, 3).map((a) => (
              <li key={a.id}>
                <WorkCard a={a} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <PractiseNow />
      <ComingUp />
    </div>
  )
}

function MyFace({ userId, name }: { userId: string; name: string }) {
  const photo = usePhoto(userId)
  return <PersonAvatar userId={userId} name={name} photo={photo} className='size-16 border-4 border-white/70 shadow' />
}

function Stat({
  label,
  value,
  colour,
  icon: Icon,
  to,
}: {
  label: string
  value: React.ReactNode
  colour: string
  icon: React.ElementType
  to: '/work' | '/progress'
}) {
  return (
    <Link to={to} className='rounded-2xl p-3 text-center active:scale-[0.98]' style={{ background: `${colour}17` }}>
      <span className='mx-auto mb-1 flex size-8 items-center justify-center rounded-full' style={{ background: `${colour}26`, color: colour }}>
        <Icon className='size-4' />
      </span>
      <p className='text-2xl font-bold tabular-nums' style={{ color: colour }}>
        {value}
      </p>
      <p className='text-[11px] text-muted-foreground'>{label}</p>
    </Link>
  )
}

/** The chapter the child is weakest in that has questions to practise (lms.practice_chapters). */
function PractiseNow() {
  const chapters = useQuery({ queryKey: ['practice-chapters'], queryFn: api.practiceChapters })
  const open = (chapters.data ?? []).filter((c) => c.questions > 0)
  if (open.length === 0) return null
  const pick = [...open].sort((a, b) => (a.mastery ?? 0.5) - (b.mastery ?? 0.5))[0]
  return (
    <Link
      to='/learn/practice'
      search={{ subject: pick.subjectName, chapter: pick.chapter }}
      className='flex items-center gap-3 rounded-2xl bg-brand-accent p-4 text-brand-accent-foreground shadow-sm active:opacity-90'
    >
      <div className='flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/40'>
        <Sparkles className='size-6' />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='text-xs opacity-80'>Practise now · {pick.subjectName}</p>
        <p className='truncate font-semibold'>{chapterTitle(pick.chapter)}</p>
        <p className='text-xs opacity-80'>Quick questions, with the answer shown straight away</p>
      </div>
      <ChevronRight className='size-5 shrink-0' />
    </Link>
  )
}

const EVENT_WORDS: Record<string, string> = {
  test: 'Test',
  ptm: 'PTM',
  exam: 'Exam',
  holiday: 'Holiday',
  trip: 'Trip',
  event: 'Event',
  other: 'Event',
}

/** Tests and school events in the next few weeks (lms.upcoming_events). */
export function ComingUp() {
  const upcoming = useQuery({ queryKey: ['upcoming'], queryFn: () => api.upcomingEvents(30) })
  const rows = upcoming.data ?? []
  if (upcoming.isError) return <p className='text-sm text-destructive'>{say(upcoming.error)}</p>
  if (rows.length === 0) return null
  return (
    <section>
      <h2 className='mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>Coming up</h2>
      <ul className='space-y-2'>
        {rows.slice(0, 5).map((e) => (
          <li key={`${e.source}-${e.id}`}>
            <EventRow e={e} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function EventRow({ e }: { e: UpcomingEvent }) {
  const starts = new Date(e.startsAt)
  const inner = (
    <div className='flex items-center gap-3 rounded-xl border bg-card p-3'>
      <div className='flex w-12 shrink-0 flex-col items-center rounded-lg bg-primary/10 py-1 text-primary'>
        <span className='text-xs uppercase'>{format(starts, 'MMM')}</span>
        <span className='text-lg leading-none font-bold'>{format(starts, 'd')}</span>
      </div>
      <div className='min-w-0 flex-1'>
        <p className='text-xs text-muted-foreground'>
          {EVENT_WORDS[e.kind] ?? 'Event'}
          {e.source === 'test' && e.details ? ` · ${e.details}` : ''}
          {e.source === 'event' && !e.className ? ' · Whole school' : ''}
        </p>
        <p className='truncate font-medium'>{e.title}</p>
        <p className='text-xs text-muted-foreground'>
          {starts.getHours() === 0 && starts.getMinutes() === 0 && !e.endsAt ? format(starts, 'EEEE') : format(starts, 'EEE, h:mm a')}
        </p>
        {e.source === 'event' && e.details && <p className='mt-1 text-xs text-muted-foreground'>{e.details}</p>}
      </div>
      {e.source === 'test' ? <ChevronRight className='size-4 shrink-0 text-muted-foreground' /> : <CalendarDays className='size-4 shrink-0 text-muted-foreground' />}
    </div>
  )
  return e.source === 'test' ? (
    <Link to='/homework/$assignmentId' params={{ assignmentId: e.id }} className='block active:opacity-80'>
      {inner}
    </Link>
  ) : (
    inner
  )
}

export function Section({
  title,
  items,
  empty,
  tone,
}: {
  title: string
  items: MyAssignment[]
  empty?: string
  tone?: 'late'
}) {
  return (
    <section>
      <h2 className={cn('mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground', tone === 'late' && 'text-orange-600')}>
        {title} {items.length > 0 && `(${items.length})`}
      </h2>
      {items.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{empty}</p>
      ) : (
        <ul className='space-y-2'>
          {items.map((a) => (
            <li key={a.id}>
              <WorkCard a={a} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Icon({ a }: { a: MyAssignment }) {
  if (a.kind === 'test') return <ClipboardCheck className='size-5' />
  if (a.answerTypes.includes('checklist')) return <NotebookPen className='size-5' />
  if (a.answerTypes.includes('mcq')) return <ListChecks className='size-5' />
  return <Camera className='size-5' />
}

export function WorkCard({ a }: { a: MyAssignment }) {
  const s = standing(a)
  const score = scoreText(a)
  const due = new Date(a.dueAt)
  const ticked = a.answerTypes.includes('checklist') && s !== 'done' && a.tasksDone > 0
  return (
    <Link
      to='/homework/$assignmentId'
      params={{ assignmentId: a.id }}
      className='flex items-center gap-3 rounded-2xl border border-s-4 bg-card p-3 active:bg-accent'
      style={{ borderInlineStartColor: subjectHue(a.subjectName).solid }}
    >
      <div
        className='flex size-10 shrink-0 items-center justify-center rounded-xl'
        style={{ background: subjectHue(a.subjectName).soft, color: subjectHue(a.subjectName).solid }}
      >
        <Icon a={a} />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='text-xs text-muted-foreground'>
          {kindLabel(a)} · {a.subjectName}
        </p>
        <p className='truncate font-medium'>{a.title}</p>
        <p className={cn('text-xs', s === 'overdue' ? 'text-orange-600' : 'text-muted-foreground')}>
          {s === 'done'
            ? `Due ${format(due, 'd MMM')}`
            : s === 'overdue'
              ? `Was due ${formatDistanceToNowStrict(due, { addSuffix: true })}`
              : `Due ${formatDistanceToNowStrict(due, { addSuffix: true })} · ${format(due, 'd MMM, h:mm a')}`}
          {ticked && ` · ${a.tasksDone} of ${a.tasksTotal} ticked`}
        </p>
      </div>
      {a.teacherStatus === 'checked' && s !== 'done' && <Badge variant='outline'>Checked</Badge>}
      {s === 'done' &&
        (score ? (
          <Badge variant='secondary' className='tabular-nums'>{score}</Badge>
        ) : (
          <Badge variant='outline'>
            {a.teacherStatus === 'checked' ? 'Checked ✓' : a.kind === 'test' && !a.resultsReleased ? 'Handed in' : 'Done'}
          </Badge>
        ))}
      <ChevronRight className='size-4 shrink-0 text-muted-foreground' />
    </Link>
  )
}
